"""Inference API for both .pth bundles.

    from smartheart_ml.inference import SmartHeartPredictor
    clf = SmartHeartPredictor("models/smartheart_ensemble.pth")
    clf.predict({"age": 56, "sex": 1, ...})
"""
import warnings

import numpy as np
import pandas as pd
import torch

from .config import CATEGORY_LEVELS, FEATURES, LABELS, VALID_RANGES
from .distill import StudentMLP, TabularEncoder, student_proba
from .evaluation import conformal_sets, decision
from .persistence import ENSEMBLE_FORMAT, STUDENT_FORMAT, load_bundle


class SmartHeartPredictor:
    def __init__(self, path):
        b = load_bundle(path)
        self.bundle, self.kind = b, b.get("format")
        self.threshold = float(b["threshold"])
        self.q = float(b["conformal_q"])
        self.alpha = float(b["alpha"])
        if self.kind == ENSEMBLE_FORMAT:
            self.model = b["model"]
        elif self.kind == STUDENT_FORMAT:
            a = b["arch"]
            self.model = StudentMLP(a["in_features"], tuple(a["hidden"]), a["dropout"])
            self.model.load_state_dict(b["state_dict"])
            self.model.eval()
            self.encoder = TabularEncoder.from_dict(b["encoder"])
        else:
            raise ValueError(f"Unknown model format: {self.kind}")

    # ------------------------------------------------------------------ input handling
    @staticmethod
    def prepare(data) -> pd.DataFrame:
        if isinstance(data, dict):
            df = pd.DataFrame([data])
        elif isinstance(data, list):
            df = pd.DataFrame(data)
        else:
            df = pd.DataFrame(data).copy()
        missing = [f for f in FEATURES if f not in df.columns]
        if missing:
            raise ValueError(f"Missing required features: {missing}")
        df = df[FEATURES].apply(pd.to_numeric, errors="coerce").reset_index(drop=True)
        # same cleaning as training: impossible zeros are missing values
        df.loc[df["cholesterol"] == 0, "cholesterol"] = np.nan
        df.loc[df["resting_bp_s"] == 0, "resting_bp_s"] = np.nan
        for c, (lo, hi) in VALID_RANGES.items():
            bad = df[c].notna() & ~df[c].between(lo, hi)
            if bad.any():
                warnings.warn(f"{c}: {int(bad.sum())} value(s) outside plausible range [{lo}, {hi}]")
        for c, lv in CATEGORY_LEVELS.items():
            bad = ~df[c].isin(lv)
            if bad.any():
                warnings.warn(f"{c}: unknown code(s) {df.loc[bad, c].unique().tolist()} (expected {lv})")
        for c in ["sex", "fasting_blood_sugar", "exercise_angina"]:
            if (~df[c].isin([0, 1])).any():
                raise ValueError(f"{c} must be 0 or 1")
        return df

    # ------------------------------------------------------------------ prediction
    def predict_proba(self, data) -> np.ndarray:
        return self.proba_prepared(self.prepare(data))

    def proba_prepared(self, X: pd.DataFrame) -> np.ndarray:
        """Probability for rows already validated by prepare() (used by the SHAP explainer)."""
        X = X[FEATURES]
        if self.kind == ENSEMBLE_FORMAT:
            return self.model.predict_proba(X)[:, 1]
        return student_proba(self.model, self.encoder, X)

    def predict(self, data) -> pd.DataFrame:
        p = self.predict_proba(data)
        sets = conformal_sets(p, self.q)
        return pd.DataFrame({
            "prob_disease": np.round(p, 4),
            "prediction": [LABELS[int(v)] for v in (p >= self.threshold)],
            "conformal_set": ["{" + ", ".join(LABELS[c] for c in (0, 1) if s[c]) + "}" for s in sets],
            "decision": [decision(s) for s in sets],
        })

    def info(self) -> dict:
        keep = ["format", "model_name", "created", "versions", "threshold", "alpha", "conformal_q", "impute",
                "test_metrics", "trained_on"]
        return {k: self.bundle.get(k) for k in keep if k in self.bundle}
