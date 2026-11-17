"""Per-patient SHAP explanations over the 11 clinical inputs, on the probability scale.

Method: SHAP permutation explainer (model-agnostic, exact additivity:
base value + sum of contributions = predicted probability). Background = 50 training
patients. Missing cholesterol / BP are first filled by the same regression imputer the
model uses, so the explanation is computed on exactly what the model sees."""
import numpy as np
import pandas as pd
import shap

from .config import FEATURES, SEED
from .data import clean, load_raw, split, xy
from .features import ClinicalImputer

LABELS = {
    "age": "Age", "sex": "Sex", "chest_pain_type": "Chest pain type", "resting_bp_s": "Resting blood pressure",
    "cholesterol": "Cholesterol", "fasting_blood_sugar": "Fasting blood sugar", "resting_ecg": "Resting ECG",
    "max_heart_rate": "Maximum heart rate", "exercise_angina": "Exercise-induced angina",
    "oldpeak": "ST depression (oldpeak)", "ST_slope": "ST segment slope",
}
CODES = {
    "sex": {0: "Female", 1: "Male"},
    "chest_pain_type": {1: "Typical angina", 2: "Atypical angina", 3: "Non-anginal pain", 4: "Asymptomatic"},
    "fasting_blood_sugar": {0: "120 mg/dl or below", 1: "Above 120 mg/dl"},
    "resting_ecg": {0: "Normal", 1: "ST-T wave abnormality", 2: "Left ventricular hypertrophy"},
    "exercise_angina": {0: "No", 1: "Yes"},
    "ST_slope": {0: "Not recorded", 1: "Upsloping", 2: "Flat", 3: "Downsloping"},
}
UNITS = {"age": "years", "resting_bp_s": "mmHg", "cholesterol": "mg/dl", "max_heart_rate": "bpm", "oldpeak": "mm"}


def display_value(feature, value):
    if feature in CODES:
        return CODES[feature].get(int(round(value)), str(value))
    v = round(float(value), 1) if feature == "oldpeak" else int(round(float(value)))
    return f"{v} {UNITS[feature]}"


class ShapExplainer:
    def __init__(self, proba_fn, n_background=50, max_evals=600, seed=SEED, data_path=None):
        X, y = xy(clean(load_raw(data_path) if data_path else load_raw()))
        X_tr, _, _, _ = split(X, y)
        self.imputer = ClinicalImputer("regress").fit(X_tr)
        bg = self.imputer.transform(X_tr)[FEATURES].sample(n_background, random_state=seed)
        self.proba_fn = proba_fn
        self.max_evals = max_evals
        masker = shap.maskers.Independent(bg.to_numpy(dtype=float), max_samples=n_background)
        try:
            self.explainer = shap.PermutationExplainer(self._f, masker, feature_names=FEATURES, seed=seed)
        except TypeError:  # older shap without seed=
            self.explainer = shap.PermutationExplainer(self._f, masker, feature_names=FEATURES)

    def _f(self, Z):
        return np.asarray(self.proba_fn(pd.DataFrame(np.asarray(Z, dtype=float), columns=FEATURES)), dtype=float)

    def explain(self, X_prepared: pd.DataFrame) -> dict:
        """X_prepared: ONE row, already passed through SmartHeartPredictor.prepare()."""
        row = X_prepared[FEATURES].iloc[[0]]
        filled = self.imputer.transform(row)[FEATURES]
        estimated = {c: round(float(filled[c].iloc[0]), 1) for c in ["cholesterol", "resting_bp_s"]
                     if pd.isna(row[c].iloc[0])}
        exp = self.explainer(filled.to_numpy(dtype=float), max_evals=self.max_evals, silent=True)
        values = np.asarray(exp.values[0], dtype=float)
        base = float(np.ravel(exp.base_values)[0])
        prob = float(self._f(filled.to_numpy(dtype=float))[0])
        contributions = []
        for f, s in zip(FEATURES, values):
            v = float(filled[f].iloc[0])
            text = display_value(f, v)
            if f in estimated:
                text += " (estimated, not measured)"
            contributions.append({"feature": f, "label": LABELS[f], "value": v, "display": text,
                                  "shap": float(s)})
        contributions.sort(key=lambda c: abs(c["shap"]), reverse=True)
        return {"method": "SHAP permutation explainer (probability scale)", "base_value": base,
                "prediction": prob, "additivity_error": float(base + values.sum() - prob),
                "estimated_inputs": estimated, "contributions": contributions}
