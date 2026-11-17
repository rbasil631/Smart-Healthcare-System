#!/usr/bin/env python3
"""SmartHeart multi-user server (FastAPI + SQLite).

    python app/server.py                    # http://127.0.0.1:8000
    python app/server.py --seed-demo        # also create two demo patients with past assessments
    python app/server.py --reset-admin      # print a new admin password and exit

Roles
    admin    everything: all patients, doctors, assessments, assignments, accounts
    doctor   the patients assigned to them: view history, run new assessments
    patient  registers themselves; own history over time; chooses their doctors

Database: data/smartheart.db (schema in app/schema.sql). API docs: /api/docs
"""
import argparse
import csv
import io
import json
import re
import sys
import warnings
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import List, Optional

ROOT = Path(__file__).resolve().parents[1]
APP_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(APP_DIR))

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from db import DEMO_DOCTOR_PASSWORD, Database, age_on, hash_password, now, verify_password
from smartheart_ml.config import FEATURES, LABELS
from smartheart_ml.evaluation import conformal_sets, decision
from smartheart_ml.explain import ShapExplainer
from smartheart_ml.inference import SmartHeartPredictor

STATIC = APP_DIR / "static"
COOKIE = "smartheart_session"
SESSION_DAYS = 7
USERNAME_RE = re.compile(r"^[A-Za-z0-9._-]{3,40}$")

EXTERNAL_VALIDATION = {  # from scripts/loso.py, soft-voting ensemble, regression imputation
    "description": "Leave-one-hospital-out: trained on three hospitals, tested on the fourth.",
    "mean_auc": 0.870, "pooled_auc": 0.894,
    "per_site": {"Hungary": 0.950, "VA Long Beach": 0.879, "Cleveland": 0.834, "Switzerland": 0.817},
}


# ============================================================================ request bodies
def dump(m):
    return m.model_dump() if hasattr(m, "model_dump") else m.dict()


class LoginIn(BaseModel):
    username: str = Field(..., max_length=40)
    password: str = Field(..., max_length=200)


class RegisterIn(BaseModel):
    username: str = Field(..., min_length=3, max_length=40)
    password: str = Field(..., min_length=8, max_length=200)
    full_name: str = Field(..., min_length=2, max_length=80)
    sex: int = Field(..., ge=0, le=1)
    date_of_birth: str
    email: Optional[str] = Field(None, max_length=120)
    phone: Optional[str] = Field(None, max_length=30)
    doctor_ids: List[int] = []


class PasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=8, max_length=200)


class AssessmentIn(BaseModel):
    age: float = Field(..., ge=1, le=120)
    sex: int = Field(..., ge=0, le=1)
    chest_pain_type: int = Field(..., ge=1, le=4)
    resting_bp_s: Optional[float] = Field(None, ge=0, le=300)
    cholesterol: Optional[float] = Field(None, ge=0, le=1000)
    fasting_blood_sugar: int = Field(..., ge=0, le=1)
    resting_ecg: int = Field(..., ge=0, le=2)
    max_heart_rate: float = Field(..., ge=30, le=250)
    exercise_angina: int = Field(..., ge=0, le=1)
    oldpeak: float = Field(..., ge=-5, le=10)
    ST_slope: int = Field(..., ge=0, le=3)
    notes: Optional[str] = Field(None, max_length=1000)


class DoctorIn(BaseModel):
    username: str = Field(..., min_length=3, max_length=40)
    password: str = Field(..., min_length=8, max_length=200)
    full_name: str = Field(..., min_length=2, max_length=80)
    specialty: str = Field(..., min_length=2, max_length=80)
    hospital: str = Field(..., min_length=2, max_length=120)
    email: Optional[str] = Field(None, max_length=120)
    phone: Optional[str] = Field(None, max_length=30)
    registration_no: Optional[str] = Field(None, max_length=40)


class ProfileIn(BaseModel):
    """Edit an account's details. Which of the optional fields are required depends on
    the role of the account being edited (see update_profile)."""
    full_name: str = Field(..., min_length=2, max_length=80)
    email: Optional[str] = Field(None, max_length=120)
    phone: Optional[str] = Field(None, max_length=30)
    sex: Optional[int] = Field(None, ge=0, le=1)          # patients
    date_of_birth: Optional[str] = None                   # patients
    specialty: Optional[str] = Field(None, max_length=80)  # doctors
    hospital: Optional[str] = Field(None, max_length=120)  # doctors
    registration_no: Optional[str] = Field(None, max_length=40)
    bio: Optional[str] = Field(None, max_length=600)


class ActiveIn(BaseModel):
    is_active: bool


class ResetIn(BaseModel):
    new_password: str = Field(..., min_length=8, max_length=200)


class AssignIn(BaseModel):
    patient_id: int
    doctor_id: int


# ============================================================================ app
def create_app(model_path: Path, db_path: Path, seed_demo: bool = False) -> FastAPI:
    db = Database(db_path)
    admin_pw = db.seed()
    if admin_pw:
        print("\n" + "=" * 64)
        print(" First run: administrator account created")
        print(f"   username: admin    password: {admin_pw}")
        print(" Save this password now. Lost it? python app/server.py --reset-admin")
        print(f" Demo doctors (dr.ayesha, dr.rohan, ...) use password: {DEMO_DOCTOR_PASSWORD}")
        print("=" * 64 + "\n", flush=True)

    predictor = SmartHeartPredictor(model_path)
    explainer = ShapExplainer(predictor.proba_prepared)
    info = predictor.info()
    q = predictor.q
    band = {"refer_low": round(1 - q, 4), "refer_high": round(q, 4)}

    # ------------------------------------------------------------------ helpers
    def assess(record: dict) -> dict:
        rec = dict(record)
        for k in ["cholesterol", "resting_bp_s"]:
            if rec.get(k) is None:
                rec[k] = 0  # model treats 0 as "not measured"
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            try:
                X = predictor.prepare(rec)
            except ValueError as e:
                raise HTTPException(422, str(e))
            prob = float(predictor.proba_prepared(X)[0])
        sets = conformal_sets([prob], q)[0]
        return {
            "probability": prob, "prediction": LABELS[int(prob >= predictor.threshold)],
            "threshold": predictor.threshold, "conformal_set": [LABELS[c] for c in (0, 1) if sets[c]],
            "decision": decision(sets), "band": band, "warnings": [str(w.message) for w in caught],
            "explanation": explainer.explain(X),
        }

    def save_assessment(patient_id, created_by, inputs, result, notes, created_at=None):
        cur = db.run("INSERT INTO assessments (patient_id, created_by, created_at, probability, prediction, decision,"
                     " model_name, notes, inputs, result) VALUES (?,?,?,?,?,?,?,?,?,?)",
                     (patient_id, created_by, created_at or now(), result["probability"], result["prediction"],
                      result["decision"], info.get("model_name"), notes, json.dumps(inputs), json.dumps(result)))
        return cur.lastrowid

    def user_json(u):
        d = {"id": u["id"], "username": u["username"], "role": u["role"], "full_name": u["full_name"],
             "email": u["email"], "phone": u["phone"], "is_active": bool(u["is_active"]),
             "created_at": u["created_at"], "last_login": u["last_login"]}
        if u["role"] == "patient":
            p = db.one("SELECT sex, date_of_birth FROM patient_profiles WHERE user_id = ?", (u["id"],))
            if p:
                d.update(sex=p["sex"], date_of_birth=p["date_of_birth"], age=age_on(p["date_of_birth"]))
        elif u["role"] == "doctor":
            p = db.one("SELECT specialty, hospital, registration_no, bio FROM doctor_profiles WHERE user_id = ?",
                       (u["id"],))
            if p:
                d.update(dict(p))
        return d

    DOCTOR_SQL = ("SELECT u.id, u.full_name, u.username, u.email, u.phone, u.is_active, d.specialty, d.hospital,"
                  " d.registration_no, d.bio FROM users u JOIN doctor_profiles d ON d.user_id = u.id")

    def doctors_of(pid):
        rows = db.q(DOCTOR_SQL + " JOIN patient_doctors pd ON pd.doctor_id = u.id WHERE pd.patient_id = ?"
                    " ORDER BY u.full_name", (pid,))
        return [dict(r) | {"is_active": bool(r["is_active"])} for r in rows]

    PATIENT_SQL = """
        SELECT u.id, u.username, u.full_name, u.email, u.phone, u.is_active, u.created_at,
               p.sex, p.date_of_birth,
               (SELECT COUNT(*) FROM assessments a WHERE a.patient_id = u.id) AS n_assessments,
               (SELECT a.probability FROM assessments a WHERE a.patient_id = u.id
                    ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS last_probability,
               (SELECT a.decision FROM assessments a WHERE a.patient_id = u.id
                    ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS last_decision,
               (SELECT a.created_at FROM assessments a WHERE a.patient_id = u.id
                    ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS last_assessed
        FROM users u JOIN patient_profiles p ON p.user_id = u.id"""

    def patient_row_json(r):
        d = dict(r)
        d["is_active"] = bool(d["is_active"])
        d["age"] = age_on(d["date_of_birth"])
        d["doctors"] = [{"id": x["id"], "full_name": x["full_name"]} for x in doctors_of(r["id"])]
        return d

    def assessment_summary(r):
        return {"id": r["id"], "patient_id": r["patient_id"], "created_at": r["created_at"],
                "probability": r["probability"], "prediction": r["prediction"], "decision": r["decision"],
                "notes": r["notes"], "created_by": r["created_by"], "created_by_name": r["created_by_name"],
                "created_by_role": r["created_by_role"], "inputs": json.loads(r["inputs"])}

    ASSESS_SQL = ("SELECT a.*, c.full_name AS created_by_name, c.role AS created_by_role, pu.full_name AS patient_name"
                  " FROM assessments a JOIN users c ON c.id = a.created_by JOIN users pu ON pu.id = a.patient_id")

    # ------------------------------------------------------------------ auth dependencies
    def current_user(request: Request):
        u = db.session_user(request.cookies.get(COOKIE))
        if not u:
            raise HTTPException(401, "Please sign in")
        return u

    def require(*roles):
        def dep(u=Depends(current_user)):
            if u["role"] not in roles:
                raise HTTPException(403, "You do not have access to this")
            return u
        return dep

    def get_patient(pid: int):
        r = db.one(PATIENT_SQL + " WHERE u.id = ?", (pid,))
        if not r:
            raise HTTPException(404, "Patient not found")
        return r

    def check_patient_access(u, pid: int):
        if u["role"] == "admin" or (u["role"] == "patient" and u["id"] == pid):
            return
        if u["role"] == "doctor" and db.is_assigned(pid, u["id"]):
            return
        raise HTTPException(403, "You do not have access to this patient")

    def editable_user(u, uid: int):
        """An administrator edits anybody; everyone else only their own details."""
        target = db.one("SELECT * FROM users WHERE id = ?", (uid,))
        if not target:
            raise HTTPException(404, "User not found")
        if u["role"] != "admin" and u["id"] != uid:
            raise HTTPException(403, "You can only edit your own details")
        return target

    def set_session(response: Response, uid: int):
        token = db.new_session(uid, SESSION_DAYS)
        response.set_cookie(COOKIE, token, httponly=True, samesite="lax", max_age=SESSION_DAYS * 86400, path="/")

    def valid_dob(s: str):
        try:
            d = date.fromisoformat(s)
        except ValueError:
            raise HTTPException(422, "Date of birth must be YYYY-MM-DD")
        a = age_on(s)
        if d > date.today() or not 18 <= a <= 110:
            raise HTTPException(422, "Patients must be between 18 and 110 years old")

    def valid_username(name: str):
        if not USERNAME_RE.match(name):
            raise HTTPException(422, "Username: 3 to 40 letters, digits, dots, dashes or underscores")
        if db.one("SELECT 1 FROM users WHERE username = ?", (name,)):
            raise HTTPException(409, "That username is taken")

    def active_doctor(did: int):
        if not db.one("SELECT 1 FROM users WHERE id = ? AND role = 'doctor' AND is_active = 1", (did,)):
            raise HTTPException(404, "Doctor not found")

    # ------------------------------------------------------------------ demo data
    if seed_demo and not db.one("SELECT 1 FROM users WHERE username = 'demo.imran'"):
        demos = [
            ("demo.imran", "Imran Ahmed", 1, "1968-03-14", ["dr.ayesha", "dr.farhan"],
             [dict(age=56, sex=1, chest_pain_type=4, resting_bp_s=150, cholesterol=268, fasting_blood_sugar=1,
                   resting_ecg=1, max_heart_rate=118, exercise_angina=1, oldpeak=2.2, ST_slope=2),
              dict(age=57, sex=1, chest_pain_type=4, resting_bp_s=142, cholesterol=241, fasting_blood_sugar=1,
                   resting_ecg=1, max_heart_rate=126, exercise_angina=1, oldpeak=1.6, ST_slope=2),
              dict(age=58, sex=1, chest_pain_type=3, resting_bp_s=134, cholesterol=212, fasting_blood_sugar=0,
                   resting_ecg=0, max_heart_rate=138, exercise_angina=0, oldpeak=0.8, ST_slope=2)]),
            ("demo.sana", "Sana Fatima", 0, "1979-09-02", ["dr.priya"],
             [dict(age=45, sex=0, chest_pain_type=2, resting_bp_s=128, cholesterol=230, fasting_blood_sugar=0,
                   resting_ecg=0, max_heart_rate=158, exercise_angina=0, oldpeak=0.4, ST_slope=1),
              dict(age=46, sex=0, chest_pain_type=2, resting_bp_s=124, cholesterol=214, fasting_blood_sugar=0,
                   resting_ecg=0, max_heart_rate=162, exercise_angina=0, oldpeak=0.0, ST_slope=1)]),
        ]
        for username, name, sex, dob, docs, visits in demos:
            pid = db.create_patient(username, "Patient@123", name, sex, dob)
            for d in docs:
                did = db.one("SELECT id FROM users WHERE username = ?", (d,))["id"]
                db.assign(pid, did, pid)
            for i, inp in enumerate(visits):
                when = (datetime.now() - timedelta(days=150 * (len(visits) - 1 - i) + 3)).isoformat(timespec="seconds")
                save_assessment(pid, pid, inp, assess(inp), "Demo visit", when)
        print("Demo patients created: demo.imran and demo.sana (password Patient@123)", flush=True)

    # ------------------------------------------------------------------ app + pages
    app = FastAPI(title="SmartHeart", docs_url="/api/docs")
    app.mount("/static", StaticFiles(directory=STATIC), name="static")

    @app.get("/")
    def index():
        return FileResponse(STATIC / "index.html")

    # ------------------------------------------------------------------ auth
    @app.post("/api/auth/register")
    def register(body: RegisterIn, response: Response):
        b = dump(body)
        valid_username(b["username"])
        valid_dob(b["date_of_birth"])
        for did in b["doctor_ids"]:
            active_doctor(did)
        pid = db.create_patient(b["username"], b["password"], b["full_name"], b["sex"], b["date_of_birth"],
                                b.get("email") or None, b.get("phone") or None)
        for did in b["doctor_ids"]:
            db.assign(pid, did, pid)
        set_session(response, pid)
        return user_json(db.one("SELECT * FROM users WHERE id = ?", (pid,)))

    @app.post("/api/auth/login")
    def login(body: LoginIn, response: Response):
        u = db.one("SELECT * FROM users WHERE username = ?", (body.username.strip(),))
        if not u or not verify_password(body.password, u["password_hash"]):
            raise HTTPException(401, "Wrong username or password")
        if not u["is_active"]:
            raise HTTPException(403, "This account has been deactivated. Contact the administrator.")
        set_session(response, u["id"])
        return user_json(u)

    @app.post("/api/auth/logout")
    def logout(request: Request, response: Response):
        db.end_session(request.cookies.get(COOKIE))
        response.delete_cookie(COOKIE, path="/")
        return {"ok": True}

    @app.get("/api/auth/me")
    def me(u=Depends(current_user)):
        return user_json(u)

    @app.post("/api/auth/password")
    def change_password(body: PasswordIn, u=Depends(current_user)):
        if not verify_password(body.current_password, u["password_hash"]):
            raise HTTPException(400, "Current password is wrong")
        db.run("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(body.new_password), u["id"]))
        return {"ok": True}

    @app.patch("/api/users/{uid}")
    def update_profile(uid: int, body: ProfileIn, u=Depends(current_user)):
        """Edit the details of one account. Administrators may edit anybody; a doctor or a
        patient may edit their own. Username, role and password are changed elsewhere, and
        past assessments keep the age and sex that were recorded with them."""
        target = editable_user(u, uid)
        b = dump(body)
        name = b["full_name"].strip()
        if len(name) < 2:
            raise HTTPException(422, "Full name is required")
        email = (b.get("email") or "").strip() or None
        phone = (b.get("phone") or "").strip() or None

        if target["role"] == "patient":
            if b.get("sex") is None or not b.get("date_of_birth"):
                raise HTTPException(422, "Sex and date of birth are required for a patient")
            valid_dob(b["date_of_birth"])
            db.run("UPDATE patient_profiles SET sex = ?, date_of_birth = ? WHERE user_id = ?",
                   (int(b["sex"]), b["date_of_birth"], uid))
        elif target["role"] == "doctor":
            specialty = (b.get("specialty") or "").strip()
            hospital = (b.get("hospital") or "").strip()
            if len(specialty) < 2 or len(hospital) < 2:
                raise HTTPException(422, "Specialty and hospital are required for a doctor")
            db.run("UPDATE doctor_profiles SET specialty = ?, hospital = ?, registration_no = ?, bio = ?"
                   " WHERE user_id = ?", (specialty, hospital, (b.get("registration_no") or "").strip() or None,
                                          (b.get("bio") or "").strip() or None, uid))

        db.run("UPDATE users SET full_name = ?, email = ?, phone = ? WHERE id = ?", (name, email, phone, uid))
        return user_json(db.one("SELECT * FROM users WHERE id = ?", (uid,)))

    @app.get("/api/public/doctors")
    def public_doctors():
        """Doctor names for the registration form (no contact details)."""
        rows = db.q(DOCTOR_SQL + " WHERE u.is_active = 1 ORDER BY u.full_name")
        return [{"id": r["id"], "full_name": r["full_name"], "specialty": r["specialty"], "hospital": r["hospital"]}
                for r in rows]

    # ------------------------------------------------------------------ model
    @app.get("/api/model")
    def model_info(u=Depends(current_user)):
        m = info.get("test_metrics", {}) or {}
        return {"model_name": info.get("model_name"), "trained_on": info.get("trained_on"),
                "impute": info.get("impute"), "threshold": predictor.threshold, "alpha": predictor.alpha,
                "band": band, "conformal": m.get("conformal"), "external_validation": EXTERNAL_VALIDATION,
                "test_metrics": {k: m.get(k) for k in ["accuracy", "auc", "auc_95ci", "sensitivity", "specificity",
                                                        "precision", "f1", "brier"]}}

    # ------------------------------------------------------------------ doctors
    @app.get("/api/doctors")
    def list_doctors(u=Depends(current_user)):
        where = "" if u["role"] == "admin" else " WHERE u.is_active = 1"
        rows = db.q(DOCTOR_SQL + where + " ORDER BY u.full_name")
        out = []
        for r in rows:
            d = dict(r) | {"is_active": bool(r["is_active"])}
            d["n_patients"] = db.one("SELECT COUNT(*) AS n FROM patient_doctors WHERE doctor_id = ?", (r["id"],))["n"]
            out.append(d)
        return out

    @app.get("/api/me/doctors")
    def my_doctors(u=Depends(require("patient"))):
        return doctors_of(u["id"])

    @app.post("/api/me/doctors/{doctor_id}")
    def add_my_doctor(doctor_id: int, u=Depends(require("patient"))):
        active_doctor(doctor_id)
        db.assign(u["id"], doctor_id, u["id"])
        return doctors_of(u["id"])

    @app.delete("/api/me/doctors/{doctor_id}")
    def remove_my_doctor(doctor_id: int, u=Depends(require("patient"))):
        db.unassign(u["id"], doctor_id)
        return doctors_of(u["id"])

    # ------------------------------------------------------------------ patients
    @app.get("/api/patients")
    def list_patients(u=Depends(current_user)):
        if u["role"] == "admin":
            rows = db.q(PATIENT_SQL + " ORDER BY u.full_name")
        elif u["role"] == "doctor":
            rows = db.q(PATIENT_SQL + " JOIN patient_doctors pd ON pd.patient_id = u.id WHERE pd.doctor_id = ?"
                        " AND u.is_active = 1 ORDER BY u.full_name", (u["id"],))
        else:
            rows = db.q(PATIENT_SQL + " WHERE u.id = ?", (u["id"],))
        return [patient_row_json(r) for r in rows]

    @app.get("/api/patients/{pid}")
    def patient_detail(pid: int, u=Depends(current_user)):
        check_patient_access(u, pid)
        d = patient_row_json(get_patient(pid))
        d["doctors"] = doctors_of(pid)
        return d

    @app.get("/api/patients/{pid}/assessments")
    def patient_assessments(pid: int, u=Depends(current_user)):
        check_patient_access(u, pid)
        rows = db.q(ASSESS_SQL + " WHERE a.patient_id = ? ORDER BY a.created_at, a.id", (pid,))
        return [assessment_summary(r) for r in rows]

    @app.post("/api/patients/{pid}/assessments")
    def new_assessment(pid: int, body: AssessmentIn, u=Depends(current_user)):
        check_patient_access(u, pid)
        p = get_patient(pid)
        if not p["is_active"]:
            raise HTTPException(409, "This patient account is deactivated")
        data = dump(body)
        inputs = {k: data[k] for k in FEATURES}
        result = assess(inputs)
        aid = save_assessment(pid, u["id"], inputs, result, data.get("notes"))
        r = db.one(ASSESS_SQL + " WHERE a.id = ?", (aid,))
        return {**assessment_summary(r), "result": result, "patient_name": r["patient_name"]}

    @app.get("/api/patients/{pid}/export.csv")
    def patient_export(pid: int, u=Depends(current_user)):
        check_patient_access(u, pid)
        return csv_response(db.q(ASSESS_SQL + " WHERE a.patient_id = ? ORDER BY a.created_at", (pid,)),
                            f"smartheart_patient_{pid}.csv")

    # ------------------------------------------------------------------ assessments
    @app.get("/api/assessments/{aid}")
    def assessment_detail(aid: int, u=Depends(current_user)):
        r = db.one(ASSESS_SQL + " WHERE a.id = ?", (aid,))
        if not r:
            raise HTTPException(404, "Assessment not found")
        check_patient_access(u, r["patient_id"])
        return {**assessment_summary(r), "result": json.loads(r["result"]), "patient_name": r["patient_name"]}

    @app.delete("/api/assessments/{aid}")
    def assessment_delete(aid: int, u=Depends(current_user)):
        r = db.one("SELECT patient_id FROM assessments WHERE id = ?", (aid,))
        if not r:
            raise HTTPException(404, "Assessment not found")
        if not (u["role"] == "admin" or (u["role"] == "patient" and u["id"] == r["patient_id"])):
            raise HTTPException(403, "Only the patient or an administrator can delete an assessment")
        db.run("DELETE FROM assessments WHERE id = ?", (aid,))
        return {"deleted": aid}

    def csv_response(rows, filename):
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["assessment_id", "created_at", "patient_id", "patient_name", "entered_by", *FEATURES,
                    "probability", "prediction", "decision", "notes"])
        for r in rows:
            inp = json.loads(r["inputs"])
            w.writerow([r["id"], r["created_at"], r["patient_id"], r["patient_name"], r["created_by_name"],
                        *[inp.get(f) for f in FEATURES], round(r["probability"], 4), r["prediction"],
                        r["decision"], r["notes"]])
        return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                                 headers={"Content-Disposition": f"attachment; filename={filename}"})

    # ------------------------------------------------------------------ admin
    @app.get("/api/admin/stats")
    def admin_stats(u=Depends(require("admin"))):
        count = lambda sql, a=(): db.one(sql, a)[0]
        latest = db.q("SELECT a.decision FROM assessments a WHERE a.id = (SELECT b.id FROM assessments b"
                      " WHERE b.patient_id = a.patient_id ORDER BY b.created_at DESC, b.id DESC LIMIT 1)")
        mix = {"Disease likely": 0, "No disease likely": 0, "Refer": 0}
        for r in latest:
            key = "Refer" if r["decision"].startswith(("Uncertain", "Atypical")) else r["decision"]
            mix[key] = mix.get(key, 0) + 1
        recent = db.q(ASSESS_SQL + " ORDER BY a.created_at DESC, a.id DESC LIMIT 8")
        return {
            "patients": count("SELECT COUNT(*) FROM users WHERE role = 'patient'"),
            "active_patients": count("SELECT COUNT(*) FROM users WHERE role = 'patient' AND is_active = 1"),
            "doctors": count("SELECT COUNT(*) FROM users WHERE role = 'doctor' AND is_active = 1"),
            "assessments": count("SELECT COUNT(*) FROM assessments"),
            "assessments_30d": count("SELECT COUNT(*) FROM assessments WHERE created_at >= ?",
                                     ((datetime.now() - timedelta(days=30)).isoformat(timespec="seconds"),)),
            "unassigned_patients": count("SELECT COUNT(*) FROM users u WHERE role = 'patient' AND NOT EXISTS"
                                         " (SELECT 1 FROM patient_doctors pd WHERE pd.patient_id = u.id)"),
            "latest_decision_mix": mix,
            "recent": [assessment_summary(r) | {"patient_name": r["patient_name"]} for r in recent],
        }

    @app.get("/api/admin/users")
    def admin_users(role: Optional[str] = None, u=Depends(require("admin"))):
        rows = db.q("SELECT * FROM users" + (" WHERE role = ?" if role else "") + " ORDER BY role, full_name",
                    (role,) if role else ())
        return [user_json(r) for r in rows]

    @app.post("/api/admin/doctors")
    def admin_create_doctor(body: DoctorIn, u=Depends(require("admin"))):
        b = dump(body)
        valid_username(b["username"])
        did = db.create_doctor(b["username"], b["password"], b["full_name"], b["specialty"], b["hospital"],
                               b.get("email") or None, b.get("phone") or None, b.get("registration_no") or None)
        return user_json(db.one("SELECT * FROM users WHERE id = ?", (did,)))

    @app.patch("/api/admin/users/{uid}")
    def admin_set_active(uid: int, body: ActiveIn, u=Depends(require("admin"))):
        if uid == u["id"]:
            raise HTTPException(400, "You cannot deactivate your own account")
        if not db.one("SELECT 1 FROM users WHERE id = ?", (uid,)):
            raise HTTPException(404, "User not found")
        db.run("UPDATE users SET is_active = ? WHERE id = ?", (int(body.is_active), uid))
        if not body.is_active:
            db.run("DELETE FROM sessions WHERE user_id = ?", (uid,))
        return user_json(db.one("SELECT * FROM users WHERE id = ?", (uid,)))

    @app.post("/api/admin/users/{uid}/password")
    def admin_reset_password(uid: int, body: ResetIn, u=Depends(require("admin"))):
        if not db.one("SELECT 1 FROM users WHERE id = ?", (uid,)):
            raise HTTPException(404, "User not found")
        db.run("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(body.new_password), uid))
        db.run("DELETE FROM sessions WHERE user_id = ?", (uid,))
        return {"ok": True}

    @app.post("/api/admin/assignments")
    def admin_assign(body: AssignIn, u=Depends(require("admin"))):
        get_patient(body.patient_id)
        active_doctor(body.doctor_id)
        db.assign(body.patient_id, body.doctor_id, u["id"])
        return doctors_of(body.patient_id)

    @app.delete("/api/admin/assignments")
    def admin_unassign(patient_id: int, doctor_id: int, u=Depends(require("admin"))):
        db.unassign(patient_id, doctor_id)
        return doctors_of(patient_id)

    @app.get("/api/admin/assessments")
    def admin_assessments(limit: int = 500, u=Depends(require("admin"))):
        rows = db.q(ASSESS_SQL + " ORDER BY a.created_at DESC, a.id DESC LIMIT ?", (limit,))
        return [assessment_summary(r) | {"patient_name": r["patient_name"]} for r in rows]

    @app.get("/api/admin/export.csv")
    def admin_export(u=Depends(require("admin"))):
        return csv_response(db.q(ASSESS_SQL + " ORDER BY a.created_at"), "smartheart_all_assessments.csv")

    return app


def main():
    import uvicorn
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=str(ROOT / "models" / "smartheart_ensemble.pth"))
    ap.add_argument("--db", default=str(ROOT / "data" / "smartheart.db"))
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--seed-demo", action="store_true", help="create two demo patients with past assessments")
    ap.add_argument("--reset-admin", action="store_true", help="print a new admin password and exit")
    a = ap.parse_args()
    if a.reset_admin:
        pw = Database(a.db).reset_admin()
        print(f"Admin password reset.  username: admin   password: {pw}")
        return
    print("Loading model and SHAP background ...", flush=True)
    app = create_app(Path(a.model), Path(a.db), a.seed_demo)
    print(f"SmartHeart running at http://{a.host}:{a.port}", flush=True)
    uvicorn.run(app, host=a.host, port=a.port, log_level="warning")


if __name__ == "__main__":
    main()
