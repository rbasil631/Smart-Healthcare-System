"""Preprocessing (always fitted inside each CV fold / pipeline -> no leakage).

Imputation modes for the impossible-zero cholesterol / resting BP values:
  regress  (default) ridge-regression imputation from the other features. Imputed values vary
           per patient, so trees cannot re-identify "was missing" rows from one repeated value.
  median   single-value imputation. NOT recommended: 129 imputed training rows share the
           exact value 238 (only 3 genuine rows do), so trees can recover the missingness
           shortcut. Kept for ablation.
  drop     remove cholesterol entirely (strictest shortcut test).
"""
import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from .config import BINARY, CATEGORY_LEVELS, NOMINAL, NUM

IMPUTE_MODES = ("regress", "median", "drop")
IMPUTE_TARGETS = ["cholesterol", "resting_bp_s"]
REG_NUM = ["age", "max_heart_rate", "oldpeak"]
REG_BIN = ["sex", "fasting_blood_sugar", "exercise_angina"]


def _design(X, medians):
    cols = [np.ones(len(X))]
    for c in REG_NUM + REG_BIN:
        cols.append(X[c].astype(float).fillna(medians[c]).to_numpy())
    for c in NOMINAL:
        for lvl in CATEGORY_LEVELS[c][1:]:          # first level = reference
            cols.append((X[c].to_numpy() == lvl).astype(float))
    return np.column_stack(cols)


class ClinicalImputer(TransformerMixin, BaseEstimator):
    def __init__(self, mode="regress", ridge=1.0):
        self.mode = mode
        self.ridge = ridge

    def fit(self, X, y=None):
        if self.mode not in IMPUTE_MODES:
            raise ValueError(f"mode must be one of {IMPUTE_MODES}")
        X = pd.DataFrame(X)
        self.medians_, self.coefs_, self.bounds_ = {}, {}, {}
        if self.mode == "regress":
            self.medians_ = {c: float(X[c].median()) for c in REG_NUM + REG_BIN}
            D = _design(X, self.medians_)
            pen = np.eye(D.shape[1])
            pen[0, 0] = 0.0                              # do not shrink the intercept
            for t in IMPUTE_TARGETS:
                obs = X[t].notna().to_numpy()
                A, b = D[obs], X.loc[obs, t].astype(float).to_numpy()
                self.coefs_[t] = np.linalg.solve(A.T @ A + self.ridge * pen, A.T @ b).tolist()
                self.bounds_[t] = [float(b.min()), float(b.max())]
        return self

    def transform(self, X):
        X = pd.DataFrame(X).copy()
        if self.mode == "drop":
            return X.drop(columns=["cholesterol"])
        if self.mode == "regress":
            D = _design(X, self.medians_)
            for t in IMPUTE_TARGETS:
                miss = X[t].isna().to_numpy()
                if miss.any():
                    lo, hi = self.bounds_[t]
                    X.loc[miss, t] = np.clip(D[miss] @ np.asarray(self.coefs_[t]), lo, hi)
        return X                                          # "median": left to SimpleImputer below

    def to_dict(self):
        return {"mode": self.mode, "ridge": float(self.ridge), "medians": self.medians_,
                "coefs": self.coefs_, "bounds": self.bounds_}

    @classmethod
    def from_dict(cls, d):
        imp = cls(d["mode"], d.get("ridge", 1.0))
        imp.medians_, imp.coefs_, imp.bounds_ = dict(d["medians"]), dict(d["coefs"]), dict(d["bounds"])
        return imp


def num_cols(mode):
    return [c for c in NUM if not (mode == "drop" and c == "cholesterol")]


def tree_prep(mode="regress"):
    """Trees: impute numerics (safety net), keep integer codes."""
    return ColumnTransformer([("num", SimpleImputer(strategy="median"), num_cols(mode))],
                             remainder="passthrough")


def linear_prep(mode="regress"):
    """Linear / kernel / distance models: impute + scale numerics, one-hot nominal codes."""
    return ColumnTransformer([
        ("num", Pipeline([("imp", SimpleImputer(strategy="median")), ("sc", StandardScaler())]), num_cols(mode)),
        ("nom", OneHotEncoder(handle_unknown="ignore"), NOMINAL),
        ("bin", "passthrough", BINARY),
    ])
