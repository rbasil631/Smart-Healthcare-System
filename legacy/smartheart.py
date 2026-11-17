#!/usr/bin/env python3
"""
SmartHeart — clean, runnable version of the KrishnaMridha/SmartHealth notebooks
(20_July.ipynb + 7_September.ipynb), as one script for VS Code.

Run:
    python smartheart.py            # full run
    python smartheart.py --fast     # quick run (fewer seeds / bootstraps)

Everything (figures, CSV tables, SHAP/LIME HTML) is written to ./outputs/
"""
import argparse
import os
import random
import warnings
from itertools import combinations

import matplotlib
matplotlib.use("Agg")  # save figures to disk instead of blocking on plt.show()
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
from scipy import stats
from sklearn.base import clone
from sklearn.calibration import CalibratedClassifierCV, calibration_curve
from sklearn.decomposition import PCA
from sklearn.ensemble import AdaBoostClassifier, ExtraTreesClassifier, RandomForestClassifier
from sklearn.manifold import TSNE
from sklearn.metrics import (accuracy_score, auc, brier_score_loss, confusion_matrix, f1_score,
                             make_scorer, precision_recall_curve, precision_score, recall_score,
                             roc_auc_score, roc_curve)
from sklearn.model_selection import (GridSearchCV, StratifiedKFold, cross_validate,
                                     learning_curve, train_test_split)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC
from statsmodels.graphics.mosaicplot import mosaic
from xgboost import XGBClassifier
from catboost import CatBoostClassifier

warnings.filterwarnings("ignore")

SEED = 42
NUMERIC = ["age", "resting_bp_s", "cholesterol", "max_heart_rate", "oldpeak"]
CATEGORICAL = ["sex", "chest_pain_type", "fasting_blood_sugar", "resting_ecg",
               "exercise_angina", "ST_slope"]
FEATURES = ["age", "sex", "chest_pain_type", "resting_bp_s", "cholesterol",
            "fasting_blood_sugar", "resting_ecg", "max_heart_rate",
            "exercise_angina", "oldpeak", "ST_slope"]
LABEL_MAPS = {
    "sex": {0: "Female", 1: "Male"},
    "chest_pain_type": {1: "Typical Angina", 2: "Atypical Angina",
                        3: "Non-Anginal Pain", 4: "Asymptomatic"},
    "fasting_blood_sugar": {0: "<= 120 mg/dL", 1: "> 120 mg/dL"},
    "resting_ecg": {0: "Normal", 1: "Abnormal", 2: "LVH"},
    "exercise_angina": {0: "No", 1: "Yes"},
    "ST_slope": {0: "Normal", 1: "Upsloping", 2: "Flat", 3: "Downsloping"},
    "target": {0: "No Disease", 1: "Disease"},
}


# ----------------------------------------------------------------------------- utils
def set_seed(seed=SEED):
    random.seed(seed)
    np.random.seed(seed)


def mkdir(*parts):
    path = os.path.join(*parts)
    os.makedirs(path, exist_ok=True)
    return path


def savefig(path, dpi=300):
    plt.tight_layout()
    plt.savefig(path, dpi=dpi, bbox_inches="tight")
    plt.close("all")


def specificity(y_true, y_pred):
    tn, fp, _, _ = confusion_matrix(y_true, y_pred, labels=[0, 1]).ravel()
    return tn / (tn + fp + 1e-12)


def binary_metrics(y_true, y_pred, y_prob):
    return {
        "Accuracy": accuracy_score(y_true, y_pred),
        "Precision": precision_score(y_true, y_pred),
        "Sensitivity (Recall)": recall_score(y_true, y_pred),
        "Specificity": specificity(y_true, y_pred),
        "F1-Score": f1_score(y_true, y_pred),
        "AUC": roc_auc_score(y_true, y_prob),
    }


def get_models(seed=SEED):
    """Six models + grids from the notebooks. Scaling lives inside the Pipeline (no leakage)."""
    return {
        "SVC": (SVC(probability=True, random_state=seed),
                {"clf__C": [0.1, 1, 10], "clf__kernel": ["rbf", "linear"]}),
        "Random Forest": (RandomForestClassifier(random_state=seed),
                          {"clf__n_estimators": [100, 200], "clf__max_depth": [None, 10]}),
        "XGBoost": (XGBClassifier(eval_metric="logloss", random_state=seed, n_jobs=1),
                    {"clf__n_estimators": [100, 200], "clf__max_depth": [3, 5]}),
        "Extra Trees": (ExtraTreesClassifier(random_state=seed),
                        {"clf__n_estimators": [100, 200], "clf__max_depth": [None, 10]}),
        "AdaBoost": (AdaBoostClassifier(random_state=seed),
                     {"clf__n_estimators": [50, 100]}),
        "CatBoost": (CatBoostClassifier(verbose=0, random_state=seed, thread_count=1,
                                        allow_writing_files=False),
                     {"clf__depth": [4, 6], "clf__iterations": [100, 200]}),
    }


def make_pipe(model):
    return Pipeline([("scaler", StandardScaler()), ("clf", clone(model))])


# ----------------------------------------------------------------------------- 1. EDA
def run_eda(df, out):
    d = mkdir(out, "01_eda")
    print("\n[1] EDA ->", d)
    print("Shape:", df.shape)
    df.describe(include="all").to_csv(f"{d}/describe.csv")

    for v in NUMERIC:
        plt.figure(figsize=(8, 6))
        sns.histplot(df[v], kde=True, bins=30, color="skyblue")
        plt.title(f"Distribution of {v}")
        savefig(f"{d}/hist_{v}.png")

        plt.figure(figsize=(8, 6))
        sns.boxplot(x="target", y=v, data=df)
        plt.title(f"{v} by Heart Disease Status")
        savefig(f"{d}/box_{v}_by_target.png")

    for v in CATEGORICAL:
        pd.crosstab(df[v], df["target"]).plot(kind="bar", stacked=True, figsize=(8, 6))
        plt.title(f"{v} by Heart Disease Status")
        plt.ylabel("Count")
        savefig(f"{d}/bar_{v}_by_target.png")

    plt.figure(figsize=(8, 6))
    sns.heatmap(df[NUMERIC].corr(), annot=True, cmap="coolwarm", fmt=".2f")
    plt.title("Correlation Matrix of Numeric Variables")
    savefig(f"{d}/correlation_matrix.png")

    # Readable labels for grouped bars / mosaics / crosstabs
    viz = df.copy()
    for col, m in LABEL_MAPS.items():
        viz[col] = viz[col].map(m).fillna("Other")

    for col in CATEGORICAL:
        plt.figure(figsize=(7, 4))
        sns.countplot(data=viz, x=col, hue="target")
        plt.xticks(rotation=30, ha="right")
        plt.title(f"{col} vs Target")
        savefig(f"{d}/count_{col}.png")

        fig, ax = plt.subplots(figsize=(7, 7))
        mosaic(viz, [col, "target"], ax=ax, labelizer=lambda k: "")
        ax.set_title(f"Mosaic Plot: {col} vs Target")
        savefig(f"{d}/mosaic_{col}.png")

    ct = pd.crosstab(viz["chest_pain_type"], viz["target"], margins=True)
    print("\nChest pain type vs target:\n", ct)
    ct.to_csv(f"{d}/crosstab_chestpain_target.csv")
    by_sex = viz.groupby("sex")[NUMERIC].mean().round(2)
    print("\nMean numeric variables by sex:\n", by_sex)
    by_sex.to_csv(f"{d}/means_by_sex.csv")

    # PCA + t-SNE
    Z = StandardScaler().fit_transform(df[FEATURES])
    pcs = PCA(n_components=2, random_state=SEED).fit_transform(Z)
    plt.figure(figsize=(7, 5))
    sns.scatterplot(x=pcs[:, 0], y=pcs[:, 1], hue=df["target"], palette="Set1")
    plt.title("PCA: 2D Projection of Features")
    savefig(f"{d}/pca.png")

    emb = TSNE(n_components=2, perplexity=30, max_iter=1000, random_state=SEED).fit_transform(Z)
    plt.figure(figsize=(7, 5))
    sns.scatterplot(x=emb[:, 0], y=emb[:, 1], hue=df["target"], palette="Set2")
    plt.title("t-SNE: 2D Projection of Features")
    savefig(f"{d}/tsne.png")


# ----------------------------------------------------------------------------- 2. Stats
def run_stats(df, out):
    d = mkdir(out, "02_stats")
    print("\n[2] Statistical tests ->", d)
    rows = []
    for v in NUMERIC:
        a, b = df.loc[df.target == 0, v], df.loc[df.target == 1, v]
        t, p = stats.ttest_ind(a, b)
        rows.append({"Variable": v, "Test": "t-test", "Statistic": round(t, 2),
                     "p-value": p, "Significant (p<0.05)": p < 0.05})
    for v in CATEGORICAL:
        chi2, p, dof, _ = stats.chi2_contingency(pd.crosstab(df[v], df["target"]))
        rows.append({"Variable": v, "Test": f"Chi-squared (dof={dof})", "Statistic": round(chi2, 1),
                     "p-value": p, "Significant (p<0.05)": p < 0.05})
    res = pd.DataFrame(rows)
    print(res.to_string(index=False))
    res.to_csv(f"{d}/statistical_tests.csv", index=False)


# ----------------------------------------------------------------------------- 3. Hold-out
def run_holdout(X_tr, X_te, y_tr, y_te, out):
    d = mkdir(out, "03_holdout_default_params")
    print("\n[3] Hold-out comparison (default params) ->", d)
    rows, fitted = [], {}
    for name, (model, _) in get_models().items():
        pipe = make_pipe(model).fit(X_tr, y_tr)
        prob = pipe.predict_proba(X_te)[:, 1]
        pred = (prob >= 0.5).astype(int)
        fitted[name] = (pipe, pred, prob)
        rows.append({"Model": name, **{k: round(v, 4) for k, v in binary_metrics(y_te, pred, prob).items()}})
    res = pd.DataFrame(rows)
    print(res.to_string(index=False))
    res.to_csv(f"{d}/holdout_results.csv", index=False)

    fig, axes = plt.subplots(2, 3, figsize=(18, 10))
    for ax, (name, (_, pred, _)) in zip(axes.flat, fitted.items()):
        sns.heatmap(confusion_matrix(y_te, pred), annot=True, fmt="d", cmap="Blues", ax=ax)
        ax.set(title=f"{name} - Confusion Matrix", xlabel="Predicted", ylabel="Actual")
    savefig(f"{d}/confusion_matrices.png")

    fig, axes = plt.subplots(2, 3, figsize=(18, 10))
    for ax, (name, (_, _, prob)) in zip(axes.flat, fitted.items()):
        fpr, tpr, _ = roc_curve(y_te, prob)
        ax.plot(fpr, tpr, color="darkblue", label=f"AUC = {roc_auc_score(y_te, prob):.3f}")
        ax.plot([0, 1], [0, 1], "k--", label="Random")
        ax.set(title=f"ROC Curve: {name}", xlabel="False Positive Rate", ylabel="True Positive Rate")
        ax.legend(loc="lower right")
        ax.grid(True)
    savefig(f"{d}/roc_curves.png")


# ----------------------------------------------------------------------------- 4. Nested CV
def run_nested_cv(X_tr, X_te, y_tr, y_te, out):
    """Nested CV on the training split, then refit best params on all training data
    and evaluate once on the held-out test split."""
    d = mkdir(out, "04_nested_cv")
    print("\n[4] Nested CV (5 outer x 3 inner) + held-out test ->", d)
    outer = StratifiedKFold(5, shuffle=True, random_state=SEED)
    inner = StratifiedKFold(3, shuffle=True, random_state=SEED)
    rows, final_models = [], {}

    for name, (model, grid) in get_models().items():
        print(f"  {name} ...")
        cv_scores = {k: [] for k in ["Accuracy", "Precision", "Sensitivity (Recall)",
                                     "Specificity", "F1-Score", "AUC"]}
        for tr_idx, va_idx in outer.split(X_tr, y_tr):
            gs = GridSearchCV(make_pipe(model), grid, scoring="accuracy", cv=inner, n_jobs=-1)
            gs.fit(X_tr.iloc[tr_idx], y_tr.iloc[tr_idx])
            prob = gs.predict_proba(X_tr.iloc[va_idx])[:, 1]
            m = binary_metrics(y_tr.iloc[va_idx], (prob >= 0.5).astype(int), prob)
            for k, v in m.items():
                cv_scores[k].append(v)

        # Final model: tune on full training split, evaluate on untouched test split
        gs = GridSearchCV(make_pipe(model), grid, scoring="accuracy", cv=inner, n_jobs=-1)
        gs.fit(X_tr, y_tr)
        best = gs.best_estimator_
        prob = best.predict_proba(X_te)[:, 1]
        test_m = binary_metrics(y_te, (prob >= 0.5).astype(int), prob)
        final_models[name] = best

        rows.append({"Model": name,
                     **{f"CV_{k}": round(np.mean(v), 4) for k, v in cv_scores.items()},
                     **{f"Test_{k}": round(v, 4) for k, v in test_m.items()},
                     "Best_Params": {k.replace("clf__", ""): v for k, v in gs.best_params_.items()}})

    res = pd.DataFrame(rows).sort_values("Test_AUC", ascending=False)
    print(res.drop(columns="Best_Params").to_string(index=False))
    res.to_csv(f"{d}/nested_cv_results.csv", index=False)

    fig, axes = plt.subplots(2, 3, figsize=(15, 9))
    for ax, (name, m) in zip(axes.flat, final_models.items()):
        sns.heatmap(confusion_matrix(y_te, m.predict(X_te)), annot=True, fmt="d", cmap="Blues", ax=ax)
        ax.set(title=name, xlabel="Predicted", ylabel="Actual")
    plt.suptitle("Confusion Matrices for Test Set (tuned models)", fontsize=16)
    savefig(f"{d}/confusion_matrices_tuned.png")
    return final_models


# ----------------------------------------------------------------------------- 5. 10-fold CV
def run_10fold(X, y, out):
    d = mkdir(out, "05_10fold_cv")
    print("\n[5] 10-fold CV on full dataset + 95% CI + paired t-tests ->", d)
    cv = StratifiedKFold(10, shuffle=True, random_state=SEED)
    scoring = {"accuracy": "accuracy", "precision": "precision", "recall": "recall",
               "specificity": make_scorer(recall_score, pos_label=0),
               "f1": "f1", "auc": "roc_auc"}
    rows, ci_rows, fold_acc = [], [], {}
    for name, (model, _) in get_models().items():
        print(f"  {name} ...")
        s = cross_validate(make_pipe(model), X, y, cv=cv, scoring=scoring, n_jobs=-1)
        fold_acc[name] = s["test_accuracy"]
        rows.append({"Model": name, **{f"CV {k}": round(s[f"test_{k}"].mean(), 4) for k in scoring}})
        acc = s["test_accuracy"]
        lo, hi = stats.t.interval(0.95, df=len(acc) - 1, loc=acc.mean(), scale=stats.sem(acc))
        ci_rows.append({"Model": name, "Mean Accuracy": round(acc.mean(), 4),
                        "95% CI Lower": round(lo, 4), "95% CI Upper": round(hi, 4)})

    res, ci = pd.DataFrame(rows), pd.DataFrame(ci_rows)
    tt = pd.DataFrame([{"Model 1": a, "Model 2": b,
                        "T-statistic": round(stats.ttest_rel(fold_acc[a], fold_acc[b])[0], 4),
                        "P-value": round(stats.ttest_rel(fold_acc[a], fold_acc[b])[1], 4)}
                       for a, b in combinations(fold_acc, 2)])
    print(res.to_string(index=False), "\n\n95% CI:\n", ci.to_string(index=False),
          "\n\nPaired t-tests:\n", tt.to_string(index=False))
    res.to_csv(f"{d}/cv10_results.csv", index=False)
    ci.to_csv(f"{d}/cv10_accuracy_ci.csv", index=False)
    tt.to_csv(f"{d}/cv10_paired_ttests.csv", index=False)

    rf = RandomForestClassifier(random_state=SEED).fit(X, y)
    imp = pd.Series(rf.feature_importances_, index=X.columns).sort_values()
    plt.figure(figsize=(10, 6))
    imp.plot(kind="barh")
    plt.title("Feature Importance - Random Forest")
    savefig(f"{d}/rf_feature_importance.png")


# ----------------------------------------------------------------------------- 6. Learning curves
def run_learning_curves(X, y, out, n_seeds):
    d = mkdir(out, "06_learning_curves")
    print(f"\n[6] Learning curves (ROC-AUC, {n_seeds} seed(s)) ->", d)
    models = {
        "RandomForest": RandomForestClassifier(n_estimators=300, random_state=SEED),
        "ExtraTrees": ExtraTreesClassifier(n_estimators=500, random_state=SEED),
        "XGBoost": XGBClassifier(n_estimators=300, max_depth=5, learning_rate=0.08, subsample=0.9,
                                 colsample_bytree=0.9, eval_metric="logloss", tree_method="hist",
                                 random_state=SEED, n_jobs=1),
        "CatBoost": CatBoostClassifier(iterations=600, depth=6, learning_rate=0.06, verbose=0,
                                       random_state=SEED, thread_count=1, allow_writing_files=False),
        "AdaBoost": AdaBoostClassifier(n_estimators=300, learning_rate=0.5, random_state=SEED),
        "SVC": SVC(C=1.0, kernel="rbf", probability=True, random_state=SEED),
    }
    sizes = np.linspace(0.1, 1.0, 8)
    fig, axes = plt.subplots(2, 3, figsize=(18, 10))
    for ax, (name, model) in zip(axes.flat, models.items()):
        print(f"  {name} ...")
        tr_all, va_all = [], []
        for s in range(n_seeds):
            cv = StratifiedKFold(5, shuffle=True, random_state=SEED + s)
            n, tr, va = learning_curve(make_pipe(model), X, y, train_sizes=sizes, cv=cv,
                                       scoring="roc_auc", shuffle=True, random_state=SEED + s, n_jobs=-1)
            tr_all.append(tr.mean(1))
            va_all.append(va.mean(1))
        tr_m, tr_s = np.mean(tr_all, 0), np.std(tr_all, 0)
        va_m, va_s = np.mean(va_all, 0), np.std(va_all, 0)
        print(f"    @100%: train AUC={tr_m[-1]:.3f}, CV AUC={va_m[-1]:.3f}, gap={tr_m[-1]-va_m[-1]:.3f}")
        ax.plot(n, tr_m, label="Train AUC")
        ax.fill_between(n, tr_m - tr_s, tr_m + tr_s, alpha=0.2)
        ax.plot(n, va_m, label="CV AUC")
        ax.fill_between(n, va_m - va_s, va_m + va_s, alpha=0.2)
        ax.set(title=f"Learning Curve — {name}", xlabel="Training samples", ylabel="ROC-AUC", ylim=(0.5, 1.05))
        ax.legend(loc="lower right")
    savefig(f"{d}/learning_curves_all_models.png", dpi=200)


# ----------------------------------------------------------------------------- 7. Calibration
def run_calibration(final_models, X_tr, X_te, y_tr, y_te, out):
    """Brier, PR-AUC, isotonic calibration (fitted with CV on TRAIN, evaluated on TEST)."""
    d = mkdir(out, "07_calibration")
    print("\n[7] Calibration & PR-AUC ->", d)
    rows = []
    fig, axes = plt.subplots(2, 3, figsize=(18, 10))
    for ax, (name, model) in zip(axes.flat, final_models.items()):
        prob = model.predict_proba(X_te)[:, 1]
        cal = CalibratedClassifierCV(clone(model), method="isotonic", cv=5).fit(X_tr, y_tr)
        prob_cal = cal.predict_proba(X_te)[:, 1]
        p, r, _ = precision_recall_curve(y_te, prob)
        b, b_cal = brier_score_loss(y_te, prob), brier_score_loss(y_te, prob_cal)
        rows.append({"Model": name, "Brier": round(b, 4), "PR-AUC": round(auc(r, p), 4),
                     "Brier (Isotonic)": round(b_cal, 4), "Improvement": round(b - b_cal, 4)})
        fp, mp = calibration_curve(y_te, prob, n_bins=10)
        fpc, mpc = calibration_curve(y_te, prob_cal, n_bins=10)
        ax.plot(mp, fp, "s-", label=f"Uncalibrated (Brier={b:.3f})")
        ax.plot(mpc, fpc, "o-", alpha=0.7, label=f"Isotonic (Brier={b_cal:.3f})")
        ax.plot([0, 1], [0, 1], "--", color="gray", label="Perfect")
        ax.set(title=f"Reliability — {name}", xlabel="Mean predicted probability",
               ylabel="Fraction of positives")
        ax.legend(fontsize="small")
        ax.grid(True, ls="--", alpha=0.5)
    savefig(f"{d}/reliability_curves.png")
    res = pd.DataFrame(rows)
    print(res.to_string(index=False))
    res.to_csv(f"{d}/calibration_results.csv", index=False)


# ----------------------------------------------------------------------------- 8. Fairness
def _group_metrics(y, yhat, g):
    rows = []
    for k, idx in pd.Series(g).groupby(g, observed=False).groups.items():
        yt, yp = np.asarray(y)[list(idx)], np.asarray(yhat)[list(idx)]
        tp, fp = int(((yp == 1) & (yt == 1)).sum()), int(((yp == 1) & (yt == 0)).sum())
        tn, fn = int(((yp == 0) & (yt == 0)).sum()), int(((yp == 0) & (yt == 1)).sum())
        rows.append({"group": k, "n": len(yt), "n_pos": int(yt.sum()),
                     "TPR": tp / (tp + fn) if tp + fn else np.nan,
                     "FPR": fp / (fp + tn) if fp + tn else np.nan,
                     "PPV": tp / (tp + fp) if tp + fp else np.nan})
    return pd.DataFrame(rows).set_index("group")


def _thr_for_tpr(y, p, target):
    """Threshold with TPR >= target and highest PPV (fallback: highest TPR)."""
    best = (-1, -1, 0.5)  # (meets_target, ppv/tpr score, thr)
    for t in np.linspace(0, 1, 1001):
        yhat = (p >= t).astype(int)
        tp, fn = ((yhat == 1) & (y == 1)).sum(), ((yhat == 0) & (y == 1)).sum()
        fp = ((yhat == 1) & (y == 0)).sum()
        if tp + fn == 0:
            continue
        tpr, ppv = tp / (tp + fn), tp / (tp + fp) if tp + fp else 0
        cand = (1, ppv, t) if tpr >= target else (0, tpr, t)
        if cand[:2] > best[:2]:
            best = cand
    return best[2]


def run_fairness(model, X_te, y_te, out, n_boot, target_tpr=0.90):
    d = mkdir(out, "08_fairness")
    print(f"\n[8] Subgroup fairness (sex, age) + equal-opportunity thresholds ->", d)
    y = y_te.to_numpy()
    p = model.predict_proba(X_te)[:, 1]
    yhat = (p >= 0.5).astype(int)
    sex = X_te["sex"].map({0: "Female", 1: "Male"}).to_numpy()

    rank = X_te["age"].rank(method="first")
    age = pd.qcut(rank, 10, labels=[f"D{i}" for i in range(1, 11)])
    ok = all((y[age == g] == 1).sum() >= 10 and (y[age == g] == 0).sum() >= 10 for g in age.cat.categories)
    if not ok:
        age = pd.qcut(rank, 5, labels=[f"Q{i}" for i in range(1, 6)])
    age = age.astype(str).to_numpy()

    rng = np.random.default_rng(SEED)
    tables = []
    for label, g in [("sex", sex), ("age", age)]:
        base = _group_metrics(y, yhat, g)
        thr = {k: _thr_for_tpr(y[g == k], p[g == k], target_tpr) for k in np.unique(g)}
        yhat_eo = np.array([int(pi >= thr[gi]) for pi, gi in zip(p, g)])
        eo = _group_metrics(y, yhat_eo, g)

        gaps = []
        for _ in range(n_boot):
            i = rng.integers(0, len(y), len(y))
            m = _group_metrics(y[i], yhat[i], g[i])["TPR"]
            if not m.isna().any():
                gaps.append(m.max() - m.min())
        lo, hi = np.quantile(gaps, [0.025, 0.975]) if gaps else (np.nan, np.nan)

        print(f"\n  {label.upper()} baseline @0.50:\n{base.round(3)}")
        print(f"  ΔTPR={base.TPR.max()-base.TPR.min():.3f}  (95% CI {lo:.3f}–{hi:.3f})")
        print(f"  {label.upper()} equal-opportunity thresholds: { {k: round(v, 3) for k, v in thr.items()} }")
        print(f"{eo.round(3)}\n  ΔTPR after mitigation={eo.TPR.max()-eo.TPR.min():.3f}")
        tables += [base.assign(Attribute=label, Phase="Baseline"), eo.assign(Attribute=label, Phase="EqOpp")]

        plt.figure(figsize=(10, 5))
        x = np.arange(len(base))
        plt.bar(x - 0.19, base.TPR, 0.38, label="Baseline (0.50)")
        plt.bar(x + 0.19, eo.TPR, 0.38, label="Equal Opportunity")
        plt.axhline(target_tpr, ls=":", lw=1)
        plt.xticks(x, base.index)
        plt.ylim(0, 1.05)
        plt.ylabel("TPR")
        plt.title(f"Subgroup Sensitivity by {label} — before/after mitigation")
        plt.legend()
        savefig(f"{d}/tpr_{label}.png")

    pd.concat(tables).to_csv(f"{d}/fairness_metrics.csv")


# ----------------------------------------------------------------------------- 9. Baselines
def run_baselines(model, X_te, y_te, out):
    d = mkdir(out, "09_rule_baselines")
    print("\n[9] Rule-based baselines vs model ->", d)
    b1 = ((X_te.exercise_angina == 1) & X_te.ST_slope.isin([2, 3])).astype(int)
    score = ((X_te.age > 50).astype(int) + (X_te.sex == 1).astype(int)
             + (X_te.exercise_angina == 1).astype(int) + (X_te.oldpeak >= 1.0).astype(int)
             + (X_te.fasting_blood_sugar == 1).astype(int))
    b2 = (score >= 3).astype(int)
    ev = lambda yp: {"Accuracy": accuracy_score(y_te, yp), "Precision": precision_score(y_te, yp),
                     "Recall": recall_score(y_te, yp), "F1": f1_score(y_te, yp)}
    res = pd.DataFrame({"Baseline 1 (Angina + ST_slope)": ev(b1),
                        "Baseline 2 (Framingham-like)": ev(b2),
                        "Random Forest (tuned)": ev(model.predict(X_te))}).T.round(4)
    print(res)
    res.to_csv(f"{d}/baselines.csv")


# ----------------------------------------------------------------------------- 10. XAI
def run_xai(X_tr, X_te, y_tr, y_te, out, patients=(5, 7)):
    import shap
    import lime.lime_tabular

    d = mkdir(out, "10_xai")
    print("\n[10] SHAP + LIME (Random Forest on unscaled features) ->", d)
    model = RandomForestClassifier(n_estimators=200, random_state=SEED).fit(X_tr, y_tr)

    explainer = shap.TreeExplainer(model)
    sv = explainer.shap_values(X_te)
    if isinstance(sv, list):          # older shap: [class0, class1]
        sv = sv[1]
    elif np.ndim(sv) == 3:            # newer shap: (n, features, classes)
        sv = sv[:, :, 1]
    ev = explainer.expected_value
    ev = ev[1] if np.ndim(ev) > 0 else ev

    shap.summary_plot(sv, X_te, show=False)
    savefig(f"{d}/shap_summary.png")
    shap.summary_plot(sv, X_te, plot_type="bar", show=False)
    savefig(f"{d}/shap_summary_bar.png")

    lime_exp = lime.lime_tabular.LimeTabularExplainer(
        training_data=X_tr.to_numpy(), feature_names=list(X_tr.columns),
        class_names=["No Disease", "Disease"], mode="classification", random_state=SEED)

    for i in patients:
        row = X_te.iloc[[i]]
        prob = model.predict_proba(row)[0]
        print(f"\n  Patient {i}: actual={LABEL_MAPS['target'][int(y_te.iloc[i])]}, "
              f"P(No Disease)={prob[0]:.4f}, P(Disease)={prob[1]:.4f}")

        shap.save_html(f"{d}/shap_force_patient_{i}.html",
                       shap.force_plot(ev, sv[i], X_te.iloc[i], feature_names=list(X_te.columns)))
        shap.plots.bar(shap.Explanation(values=sv[i], base_values=ev, data=X_te.iloc[i].values,
                                        feature_names=list(X_te.columns)), max_display=12, show=False)
        savefig(f"{d}/shap_bar_patient_{i}.png")
        tbl = pd.DataFrame({"Feature": X_te.columns, "Value": X_te.iloc[i].values,
                            "SHAP Value": sv[i]}).sort_values("SHAP Value", ascending=False)
        print(tbl.to_string(index=False), f"\n  sum(SHAP)={sv[i].sum():.4f}, base={ev:.4f}")
        tbl.to_csv(f"{d}/shap_values_patient_{i}.csv", index=False)

        exp = lime_exp.explain_instance(X_te.iloc[i].to_numpy(),
                                        lambda a: model.predict_proba(pd.DataFrame(a, columns=X_te.columns)),
                                        num_features=len(X_te.columns))
        exp.save_to_file(f"{d}/lime_patient_{i}.html")
        pd.DataFrame(exp.as_list(), columns=["Feature", "Contribution"]).round(4) \
            .to_csv(f"{d}/lime_patient_{i}.csv", index=False)


# ----------------------------------------------------------------------------- main
STEPS = ["eda", "stats", "holdout", "nested", "cv10", "learning", "calibration",
         "fairness", "baselines", "xai"]


def main():
    ap = argparse.ArgumentParser(description="SmartHeart pipeline")
    ap.add_argument("--data", default="C:\\Users\\rbasi\\Desktop\\BCODERS\\major project\\phase2\\merge.csv")
    ap.add_argument("--out", default="outputs")
    ap.add_argument("--fast", action="store_true", help="1 learning-curve seed, 200 bootstraps")
    ap.add_argument("--only", nargs="+", choices=STEPS, help="run only these steps")
    args = ap.parse_args()
    steps = set(args.only or STEPS)

    set_seed()
    mkdir(args.out)
    df = pd.read_csv(args.data).dropna()
    X, y = df[FEATURES], df["target"].astype(int)
    print("Class balance:\n", y.value_counts())
    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2, stratify=y, random_state=SEED)
    print(f"Train: {len(y_tr)}  Test: {len(y_te)}")

    if "eda" in steps:
        run_eda(df, args.out)
    if "stats" in steps:
        run_stats(df, args.out)
    if "holdout" in steps:
        run_holdout(X_tr, X_te, y_tr, y_te, args.out)

    final_models = None
    if steps & {"nested", "calibration", "fairness", "baselines"}:
        final_models = run_nested_cv(X_tr, X_te, y_tr, y_te, args.out)
    if "cv10" in steps:
        run_10fold(X, y, args.out)
    if "learning" in steps:
        run_learning_curves(X, y, args.out, n_seeds=1 if args.fast else 5)
    if "calibration" in steps:
        run_calibration(final_models, X_tr, X_te, y_tr, y_te, args.out)
    if "fairness" in steps:
        run_fairness(final_models["Random Forest"], X_te, y_te, args.out,
                     n_boot=200 if args.fast else 2000)
    if "baselines" in steps:
        run_baselines(final_models["Random Forest"], X_te, y_te, args.out)
    if "xai" in steps:
        run_xai(X_tr, X_te, y_tr, y_te, args.out)

    print(f"\nDone. All results in ./{args.out}/")


if __name__ == "__main__":
    main()
