#!/usr/bin/env python3
"""
Ensemble of the top-3 SmartHeart models (Random Forest, XGBoost, Extra Trees).
Put this file next to smartheart.py and merge.csv, then run:

    python ensemble.py

Builds two ensembles from the tuned base models:
  * Soft voting  - averages the three predicted probabilities
  * Stacking     - logistic regression learns how to combine them (5-fold out-of-fold)
Evaluates on the same 238-patient test split, runs 10-fold CV, and tests
whether each ensemble is significantly better than Random Forest alone.
Results go to outputs/11_ensemble/
"""
import os
import warnings

import numpy as np
import pandas as pd
from scipy import stats
from sklearn.base import clone
from sklearn.ensemble import StackingClassifier, VotingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import make_scorer, recall_score
from sklearn.model_selection import GridSearchCV, StratifiedKFold, cross_validate, train_test_split

from smartheart import FEATURES, SEED, binary_metrics, get_models, make_pipe, set_seed

warnings.filterwarnings("ignore")
TOP3 = ["Random Forest", "XGBoost", "Extra Trees"]
OUT = os.path.join("outputs", "11_ensemble")


def mcnemar(y, pred_a, pred_b):
    """Exact McNemar test: do two models make different errors on the same patients?"""
    a_right_b_wrong = int(((pred_a == y) & (pred_b != y)).sum())
    b_right_a_wrong = int(((pred_b == y) & (pred_a != y)).sum())
    n = a_right_b_wrong + b_right_a_wrong
    p = 1.0 if n == 0 else stats.binomtest(min(a_right_b_wrong, b_right_a_wrong), n, 0.5).pvalue
    return a_right_b_wrong, b_right_a_wrong, p


def main():
    set_seed()
    os.makedirs(OUT, exist_ok=True)
    df = pd.read_csv("merge.csv").dropna()
    X, y = df[FEATURES], df["target"].astype(int)
    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2, stratify=y, random_state=SEED)

    # 1. Tune each base model on the training split only (same grids as smartheart.py)
    inner = StratifiedKFold(3, shuffle=True, random_state=SEED)
    all_models = get_models()
    tuned = {}
    for name in TOP3:
        model, grid = all_models[name]
        gs = GridSearchCV(make_pipe(model), grid, scoring="accuracy", cv=inner, n_jobs=-1).fit(X_tr, y_tr)
        tuned[name] = gs.best_estimator_
        print(f"{name:14s} best params: { {k.replace('clf__', ''): v for k, v in gs.best_params_.items()} }")

    # 2. Build the ensembles from fresh (unfitted) copies of the tuned pipelines
    estimators = [(n.replace(" ", "_"), clone(tuned[n])) for n in TOP3]
    candidates = {
        **{n: clone(tuned[n]) for n in TOP3},
        "Soft Voting (RF+XGB+ET)": VotingClassifier(estimators, voting="soft", n_jobs=1),
        "Stacking (LogReg meta)": StackingClassifier(
            estimators, final_estimator=LogisticRegression(max_iter=1000),
            cv=StratifiedKFold(5, shuffle=True, random_state=SEED), stack_method="predict_proba", n_jobs=1),
    }

    # 3. Held-out test (238 patients)
    rows, preds = [], {}
    for name, model in candidates.items():
        model.fit(X_tr, y_tr)
        prob = model.predict_proba(X_te)[:, 1]
        pred = (prob >= 0.5).astype(int)
        preds[name] = pred
        rows.append({"Model": name, **{k: round(v, 4) for k, v in binary_metrics(y_te, pred, prob).items()}})
        if name.startswith("Stacking"):
            w = model.final_estimator_.coef_[0]
            print("Stacking weights (higher = trusted more):",
                  dict(zip(TOP3, np.round(w, 3))))
    test_res = pd.DataFrame(rows)
    print("\n=== Held-out test (238 patients) ===\n", test_res.to_string(index=False))
    test_res.to_csv(f"{OUT}/ensemble_test_results.csv", index=False)

    # 4. McNemar: are ensembles really different from Random Forest on the test set?
    yt = y_te.to_numpy()
    mc = []
    for name in ["Soft Voting (RF+XGB+ET)", "Stacking (LogReg meta)"]:
        a, b, p = mcnemar(yt, preds[name], preds["Random Forest"])
        mc.append({"Comparison": f"{name} vs Random Forest", "Ensemble right / RF wrong": a,
                   "RF right / Ensemble wrong": b, "p-value": round(p, 4)})
    mc = pd.DataFrame(mc)
    print("\n=== McNemar test vs Random Forest ===\n", mc.to_string(index=False))
    mc.to_csv(f"{OUT}/mcnemar_vs_rf.csv", index=False)

    # 5. 10-fold CV on all data + paired t-test vs Random Forest
    cv = StratifiedKFold(10, shuffle=True, random_state=SEED)
    scoring = {"accuracy": "accuracy", "recall": "recall",
               "specificity": make_scorer(recall_score, pos_label=0), "f1": "f1", "auc": "roc_auc"}
    cv_rows, fold_acc = [], {}
    for name, model in candidates.items():
        print(f"10-fold CV: {name} ...")
        s = cross_validate(clone(model), X, y, cv=cv, scoring=scoring, n_jobs=-1)
        acc = s["test_accuracy"]
        fold_acc[name] = acc
        lo, hi = stats.t.interval(0.95, len(acc) - 1, loc=acc.mean(), scale=stats.sem(acc))
        cv_rows.append({"Model": name, **{f"CV {k}": round(s[f'test_{k}'].mean(), 4) for k in scoring},
                        "95% CI": f"{lo:.4f} - {hi:.4f}"})
    cv_res = pd.DataFrame(cv_rows)
    print("\n=== 10-fold CV ===\n", cv_res.to_string(index=False))
    cv_res.to_csv(f"{OUT}/ensemble_cv10_results.csv", index=False)

    tt = []
    for name in ["Soft Voting (RF+XGB+ET)", "Stacking (LogReg meta)"]:
        t, p = stats.ttest_rel(fold_acc[name], fold_acc["Random Forest"])
        tt.append({"Comparison": f"{name} vs Random Forest", "Mean diff": round((fold_acc[name] - fold_acc["Random Forest"]).mean(), 4),
                   "t": round(t, 3), "p-value": round(p, 4)})
    tt = pd.DataFrame(tt)
    print("\n=== Paired t-test (10 folds) vs Random Forest ===\n", tt.to_string(index=False))
    tt.to_csv(f"{OUT}/cv10_ttest_vs_rf.csv", index=False)
    print(f"\nDone. Results in ./{OUT}/")


if __name__ == "__main__":
    main()