#!/usr/bin/env python3
"""Sensitivity analysis for the cholesterol-missingness shortcut.

    python scripts/ablation.py              # repeated 5x5 CV on all 918 clean patients
    python scripts/ablation.py --train-only # same, but only on the 80% train split
    python scripts/ablation.py --fast

[1] Re-identification probe: can a Random Forest tell which patients HAD missing cholesterol
    from the features after imputation?  AUC ~1.0 = shortcut fully available to the models.
    The 'drop' row is the floor: how much the other features alone reveal the source site.
[2] Performance of RF / LogReg / soft vote under each imputation mode, plus a complete-case
    analysis (patients with measured cholesterol only).
"""
import argparse
import sys
import warnings
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import RepeatedStratifiedKFold, StratifiedKFold, cross_val_score, cross_validate
from sklearn.pipeline import Pipeline

from smartheart_ml.config import OUTPUTS_DIR, SEED
from smartheart_ml.data import clean, load_raw, split, xy
from smartheart_ml.evaluation import corrected_ttest
from smartheart_ml.features import ClinicalImputer, tree_prep
from smartheart_ml.models import candidates

warnings.filterwarnings("ignore")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--train-only", action="store_true")
    ap.add_argument("--fast", action="store_true")
    a = ap.parse_args()
    n_rep = 2 if a.fast else 5
    out = OUTPUTS_DIR / "ablation"
    out.mkdir(parents=True, exist_ok=True)

    X, y = xy(clean(load_raw()))
    if a.train_only:
        X, _, y, _ = split(X, y)
    X, y = X.reset_index(drop=True), y.reset_index(drop=True)
    missing = X["cholesterol"].isna().astype(int)
    print(f"patients={len(y)}  missing cholesterol={missing.sum()}")

    print("\n[1] Re-identification probe (RF predicting 'cholesterol was missing')")
    probe_rows = []
    for mode in ["median", "regress", "drop"]:
        pipe = Pipeline([("impute", ClinicalImputer(mode)), ("prep", tree_prep(mode)),
                         ("clf", RandomForestClassifier(n_estimators=300, random_state=SEED, n_jobs=-1))])
        auc = cross_val_score(pipe, X, missing, cv=StratifiedKFold(5, shuffle=True, random_state=SEED),
                              scoring="roc_auc")
        probe_rows.append({"impute": mode, "reidentification_auc": auc.mean(), "sd": auc.std(ddof=1)})
        print(f"    {mode:8s} AUC={auc.mean():.3f}")
    pd.DataFrame(probe_rows).round(4).to_csv(out / "reidentification_probe.csv", index=False)

    print("\n[2] Performance by imputation mode (repeated 5-fold CV)")
    cv = RepeatedStratifiedKFold(n_splits=5, n_repeats=n_rep, random_state=SEED)
    scoring = {"auc": "roc_auc", "acc": "accuracy", "brier": "neg_brier_score"}
    settings = [(m, X, y, m) for m in ["median", "regress", "drop"]]
    cc = X["cholesterol"].notna()
    settings.append(("complete-case", X[cc].reset_index(drop=True), y[cc].reset_index(drop=True), "median"))
    rows, ref = [], {}
    for label, Xs, ys, mode in settings:
        for key in ["rf", "logreg", "soft_vote"]:
            print(f"    {label:13s} {key} ...")
            s = cross_validate(candidates(impute=mode)[key], Xs, ys, cv=cv, scoring=scoring, n_jobs=-1)
            auc = s["test_auc"]
            if label == "median":
                ref[key] = auc
            p = corrected_ttest(auc, ref[key])[1] if label in ("regress", "drop") else np.nan
            rows.append({"setting": label, "n": len(ys), "model": key, "auc": auc.mean(), "auc_sd": auc.std(ddof=1),
                         "acc": s["test_acc"].mean(), "brier": -s["test_brier"].mean(),
                         "auc_delta_vs_median": auc.mean() - ref[key].mean() if label in ("regress", "drop") else np.nan,
                         "corrected_p_vs_median": p})
    res = pd.DataFrame(rows).round(4)
    print(res.to_string(index=False))
    res.to_csv(out / "imputation_ablation.csv", index=False)
    print(f"\nSaved to {out}")


if __name__ == "__main__":
    main()
