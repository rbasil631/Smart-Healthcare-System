"""Deploy SmartHeart on Modal: the browser app at / and a key-protected JSON API.

    uv run scripts/deploy_modal.py  # easiest: logs in, creates the API-key secret, deploys

Or with the modal CLI directly:
    modal secret create smartheart-api-key SMARTHEART_API_KEY=<long-random-string>
    modal run modal_app.py          # one-off test: runs both models on examples/patients.csv in the cloud
    modal serve modal_app.py        # temporary dev URL, hot-reloads on save
    modal deploy modal_app.py       # persistent URL

The browser app (app/server.py -- patient / doctor / admin logins, assessment history,
SHAP explanations) is served at / with its own routes: /static/*, /api/*, /api/docs.
It has its own logins, so it needs no API key. Its SQLite database lives on the Modal
Volume "smartheart-db", so accounts and assessments survive restarts and redeploys.
The administrator password is printed once, by the container that creates the database:

    uv run --with modal modal app logs smartheart            # read it there, or
    uv run --with modal modal run modal_app.py::reset_admin  # set a new one

The machine-to-machine JSON API keeps its own routes, each needing the header
x-api-key: <SMARTHEART_API_KEY>:
    GET  /health
    GET  /info?model=ensemble|student
    POST /predict?model=ensemble|student         body: one patient (11 features)
    POST /predict/batch?model=ensemble|student   body: {"patients": [ ... ]}
Interactive docs for it: <url>/docs
"""
import os
from pathlib import Path

import modal

ROOT = Path(__file__).parent
REMOTE_ROOT = "/root/smartheart"  # config.py resolves ROOT as parents[2] of src/smartheart_ml/config.py
DB_DIR = "/data"  # a Volume, not the image: containers are thrown away, the database must not be
DB_PATH = f"{DB_DIR}/smartheart.db"

# Same versions as requirements-app.txt: the ensemble .pth is a scikit-learn pickle, so
# scikit-learn / catboost / xgboost must match the training environment.
image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("libgomp1")  # OpenMP runtime for xgboost / catboost
    .pip_install("torch==2.6.0", index_url="https://download.pytorch.org/whl/cpu")  # CPU wheel, no CUDA
    .pip_install(
        "numpy>=1.26,<2.2",
        "pandas>=2.1",
        "scipy>=1.11",
        "scikit-learn==1.5.2",
        "xgboost>=2.0,<3.0",
        "catboost==1.2.10",
        "shap>=0.45",  # per-patient explanations in the browser app
        "fastapi[standard]>=0.115",
    )
    .env({"PYTHONPATH": f"{REMOTE_ROOT}/src", "PYTHONWARNINGS": "default"})
    # add_local_* must come last: these files are mounted at container start, not baked into the image
    .add_local_dir(ROOT / "src", f"{REMOTE_ROOT}/src", ignore=["**/__pycache__", "**/*.pyc"])
    .add_local_dir(ROOT / "app", f"{REMOTE_ROOT}/app", ignore=["**/__pycache__", "**/*.pyc"])
    .add_local_dir(ROOT / "models", f"{REMOTE_ROOT}/models")
    .add_local_file(ROOT / "data" / "merge.csv", f"{REMOTE_ROOT}/data/merge.csv")  # SHAP background set
)

app = modal.App("smartheart", image=image)

# Accounts, assessments and sessions. Created on the first deploy, kept across redeploys.
db_volume = modal.Volume.from_name("smartheart-db", create_if_missing=True)

MODEL_FILES = {
    "ensemble": f"{REMOTE_ROOT}/models/smartheart_ensemble.pth",
    "student": f"{REMOTE_ROOT}/models/smartheart_student.pth",
}


@app.cls(
    cpu=2.0,
    memory=4096,  # both model bundles plus the SHAP background set
    scaledown_window=300,  # keep a warm container for 5 min after the last request
    max_containers=1,  # one SQLite writer: the database is a single file shared over the Volume
    volumes={DB_DIR: db_volume},
    secrets=[modal.Secret.from_name("smartheart-api-key")],
)
@modal.concurrent(max_inputs=8)  # a page load fires several /api calls; don't serialise them
class SmartHeart:
    @modal.enter()
    def load(self):
        """Runs once per container: load both bundles so requests don't pay the load cost."""
        import sys

        from smartheart_ml.inference import SmartHeartPredictor

        self.predictors = {name: SmartHeartPredictor(path) for name, path in MODEL_FILES.items()}

        # The browser app. server.py puts src/ and app/ on sys.path itself, but only once
        # it is imported, so app/ has to be reachable first.
        sys.path.insert(0, f"{REMOTE_ROOT}/app")
        from server import create_app

        self.ui = create_app(Path(MODEL_FILES["ensemble"]), Path(DB_PATH))
        db_volume.commit()  # the first container seeds the database -- keep that work

    @modal.exit()
    def save(self):
        db_volume.commit()

    def _run(self, records, model):
        import warnings

        if model not in self.predictors:
            raise ValueError(f"model must be one of {list(self.predictors)}")
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            out = self.predictors[model].predict(records)
        return {
            "model": model,
            "predictions": out.to_dict(orient="records"),
            "warnings": sorted({str(w.message) for w in caught}),
        }

    @modal.method()
    def predict(self, records: list[dict], model: str = "ensemble") -> dict:
        """Callable from Python: modal.Cls.from_name("smartheart", "SmartHeart")().predict.remote([...])"""
        return self._run(records, model)

    @modal.asgi_app()
    def web(self):
        import secrets
        from typing import Literal

        from fastapi import Depends, FastAPI, Header, HTTPException, Query
        from pydantic import BaseModel, Field
        from starlette.concurrency import run_in_threadpool

        expected_key = os.environ["SMARTHEART_API_KEY"]

        def check_key(x_api_key: str = Header(default="")):
            if not secrets.compare_digest(x_api_key, expected_key):
                raise HTTPException(status_code=401, detail="Invalid or missing x-api-key header")

        class Patient(BaseModel):
            age: float
            sex: int = Field(description="0 = female, 1 = male")
            chest_pain_type: int = Field(description="1-4")
            resting_bp_s: float = Field(description="0 is treated as missing")
            cholesterol: float = Field(description="0 is treated as missing")
            fasting_blood_sugar: int = Field(description="0 or 1")
            resting_ecg: int = Field(description="0-2")
            max_heart_rate: float
            exercise_angina: int = Field(description="0 or 1")
            oldpeak: float
            ST_slope: int = Field(description="0-3")

            model_config = {"json_schema_extra": {"example": {
                "age": 56, "sex": 1, "chest_pain_type": 4, "resting_bp_s": 128, "cholesterol": 223,
                "fasting_blood_sugar": 0, "resting_ecg": 1, "max_heart_rate": 119,
                "exercise_angina": 1, "oldpeak": 2.0, "ST_slope": 3}}}

        class Batch(BaseModel):
            patients: list[Patient] = Field(min_length=1, max_length=1000)

        ModelName = Literal["ensemble", "student"]
        api = FastAPI(title="SmartHeart API", version="2.1.0", dependencies=[Depends(check_key)])

        @api.middleware("http")
        async def persist(request, call_next):
            """A container can be reclaimed at any time, so write-through to the Volume.
            Only the browser app's routes touch the database; /predict does not."""
            response = await call_next(request)
            if request.method != "GET" and request.url.path.startswith("/api/") and response.status_code < 400:
                await run_in_threadpool(db_volume.commit)
            return response

        def run(records, model):
            try:
                return self._run(records, model)
            except ValueError as e:
                raise HTTPException(status_code=422, detail=str(e))

        @api.get("/health")
        def health():
            return {"status": "ok", "models": list(self.predictors)}

        @api.get("/info")
        def info(model: ModelName = Query("ensemble")):
            return self.predictors[model].info()

        @api.post("/predict")
        def predict(patient: Patient, model: ModelName = Query("ensemble")):
            res = run([patient.model_dump()], model)
            return {"model": res["model"], **res["predictions"][0], "warnings": res["warnings"]}

        @api.post("/predict/batch")
        def predict_batch(batch: Batch, model: ModelName = Query("ensemble")):
            return run([p.model_dump() for p in batch.patients], model)

        # The browser app takes every path the JSON API above does not claim: /, /static/*,
        # /api/*. Mounted last, so those routes still win, and as a mount rather than a
        # route so the app-level x-api-key check does not apply -- it has its own logins.
        api.mount("/", self.ui)
        return api


@app.function(volumes={DB_DIR: db_volume})
def reset_admin():
    """`modal run modal_app.py::reset_admin` -- new admin password, printed in your terminal.

    Use it when the first-run password has scrolled out of the app logs."""
    import sys

    sys.path.insert(0, f"{REMOTE_ROOT}/app")
    from db import Database

    password = Database(DB_PATH).reset_admin()
    db_volume.commit()
    print(f"\n  username: admin    password: {password}\n", flush=True)


@app.local_entrypoint()
def main(csv: str = "examples/patients.csv"):
    """`modal run modal_app.py` -- send the example patients to both models in the cloud."""
    import csv as csvlib

    with open(ROOT / csv, newline="") as f:
        records = [{k: float(v) for k, v in row.items()} for row in csvlib.DictReader(f)]
    model = SmartHeart()
    for name in MODEL_FILES:
        res = model.predict.remote(records, name)
        print(f"\n== {name}")
        for rec, pred in zip(records, res["predictions"]):
            print(f"  age {rec['age']:>4.0f}  ->  {pred}")
        for w in res["warnings"]:
            print(f"  warning: {w}")
