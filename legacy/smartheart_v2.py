#!/usr/bin/env python3
"""
SmartHeart v2 — leakage audit, leak-free re-evaluation, and a diversity-driven ensemble.
Put next to smartheart.py and merge.csv, then run:

    python smartheart_v2.py            # full run
    python smartheart_v2.py --fast     # fewer CV repeats / bootstraps

Steps (outputs/12_v2/):
  [A] audit        duplicates, test rows memorised from train, cholesterol=0 shortcut
  [B] variants     repeated 5x5 CV: raw 1190 (paper) vs dedup 918 vs dedup + zeros->missing
  [C] heldout      7 diverse base learners + soft vote + stacking + greedy (Caruana) ensemble,
                   thresholds chosen on train OOF (not 0.5), Brier/log-loss, bootstrap ΔAUC vs RF
  [D] zoo_cv       same models, repeated CV, Nadeau–Bengio corrected t-test vs RF
  [E] conformal    split + Mondrian(sex) conformal prediction sets (calibrated on TRAIN only)
  [F] dca          decision-curve analysis (clinical net benefit)
"""
import argparse
import os
import warnings

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
from scipy import stats
from sklearn.base import BaseEstimator, ClassifierMixin, clone
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import (ExtraTreesClassifier, RandomForestClassifier,
                              StackingClassifier, VotingClassifier)
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, brier_score_loss, log_loss, roc_auc_score
from sklearn.model_selection import (RepeatedStratifiedKFold, StratifiedKFold,
                                     cross_val_predict, cross_validate, train_test_split)
from sklearn.neighbors import KNeighborsClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.svm import SVC
from xgboost import XGBClassifier
from catboost import CatBoostClassifier

from smartheart import FEATURES, SEED, binary_metrics, set_seed

warnings.filterwarnings("ignore")
NUM = ["age", "resting_bp_s", "cholesterol", "max_heart_rate", "oldpeak"]
NOMINAL = ["chest_pain_type", "resting_ecg", "ST_slope"]
BINARY = ["sex", "fasting_blood_sugar", "exercise_angina"]


# ----------------------------------------------------------------------------- data
def load(path, dedup=False, zeros_as_missing=False):
    df = pd.read_csv(path).dropna()
    if dedup:
        df = df.drop_duplicates().reset_index(drop=True)
    if zeros_as_missing:  # 0 mg/dL cholesterol / 0 mmHg BP are physiologically impossible = missing
        df = df.copy()
        df.loc[df.cholesterol == 0, "cholesterol"] = np.nan
        df.loc[df.resting_bp_s == 0, "resting_bp_s"] = np.nan
    return df[FEATURES], df["target"].astype(int)


def split(X, y):
    return train_test_split(X, y, test_size=0.2, stratify=y, random_state=SEED)


# ----------------------------------------------------------------------------- models
def tree_prep():
    return ColumnTransformer([("num", SimpleImputer(strategy="median"), NUM)],
                             remainder="passthrough")


def linear_prep():
    return ColumnTransformer([
        ("num", Pipeline([("imp", SimpleImputer(strategy="median")), ("sc", StandardScaler())]), NUM),
        ("nom", OneHotEncoder(handle_unknown="ignore"), NOMINAL),   # no fake ordinal order
        ("bin", "passthrough", BINARY)])


def base_learners(seed=SEED):
    """Deliberately DIVERSE learners: bagged trees, boosted trees, a linear model,
    a kernel model and a local (instance-based) model. Diversity is what ensembles need."""
    T, L = tree_prep, linear_prep
    return {
        "RF": Pipeline([("prep", T()), ("clf", RandomForestClassifier(
            n_estimators=300, random_state=seed, n_jobs=1))]),
        "ET": Pipeline([("prep", T()), ("clf", ExtraTreesClassifier(
            n_estimators=300, min_samples_leaf=2, random_state=seed, n_jobs=1))]),
        "XGB": Pipeline([("prep", T()), ("clf", XGBClassifier(
            n_estimators=300, max_depth=3, learning_rate=0.05, subsample=0.9, colsample_bytree=0.8,
            eval_metric="logloss", random_state=seed, n_jobs=1))]),
        "CatBoost": Pipeline([("prep", T()), ("clf", CatBoostClassifier(
            iterations=400, depth=5, learning_rate=0.05, verbose=0, random_seed=seed,
            thread_count=1, allow_writing_files=False))]),
        "LogReg": Pipeline([("prep", L()), ("clf", LogisticRegression(C=1.0, max_iter=2000))]),
        "SVC": Pipeline([("prep", L()), ("clf", SVC(C=1.0, probability=True, random_state=seed))]),
        "kNN": Pipeline([("prep", L()), ("clf", KNeighborsClassifier(n_neighbors=15, weights="distance"))]),
    }


class GreedyEnsemble(ClassifierMixin, BaseEstimator):
    """Caruana et al. (2004) ensemble selection with replacement.
    Weights are learned on internal out-of-fold probabilities by greedily minimising log-loss,
    so the ensemble can never be fitted on predictions the base models have already seen."""

    def __init__(self, estimators, n_rounds=30, cv=5, random_state=SEED):
        self.estimators = estimators
        self.n_rounds = n_rounds
        self.cv = cv
        self.random_state = random_state

    def fit(self, X, y):
        y = np.asarray(y)
        cv = StratifiedKFold(self.cv, shuffle=True, random_state=self.random_state)
        self.names_ = [n for n, _ in self.estimators]
        oof = np.column_stack([cross_val_predict(clone(e), X, y, cv=cv, method="predict_proba")[:, 1]
                               for _, e in self.estimators])
        counts, cur = np.zeros(oof.shape[1]), np.zeros(len(y))
        for r in range(self.n_rounds):
            cand = [(cur * r + oof[:, j]) / (r + 1) for j in range(oof.shape[1])]
            j = int(np.argmin([log_loss(y, np.clip(c, 1e-6, 1 - 1e-6)) for c in cand]))
            counts[j] += 1
            cur = cand[j]
        self.weights_ = counts / counts.sum()
        self.fitted_ = [(w, clone(e).fit(X, y))
                        for w, (_, e) in zip(self.weights_, self.estimators) if w > 0]
        self.classes_ = np.array([0, 1])
        return self

    def predict_proba(self, X):
        p = sum(w * m.predict_proba(X)[:, 1] for w, m in self.fitted_)
        return np.column_stack([1 - p, p])

    def predict(self, X):
        return (self.predict_proba(X)[:, 1] >= 0.5).astype(int)


def all_models():
    base = base_learners()
    est = list(base.items())
    return {
        **base,
        "Soft vote (7)": VotingClassifier(est, voting="soft"),
        "Stacking (LR meta)": StackingClassifier(
            est, final_estimator=LogisticRegression(max_iter=2000),
            cv=StratifiedKFold(5, shuffle=True, random_state=SEED), stack_method="predict_proba"),
        "Greedy ensemble": GreedyEnsemble(est),
    }


# ----------------------------------------------------------------------------- helpers
def corrected_ttest(a, b, test_frac=0.2):
    """Nadeau & Bengio (2003) corrected resampled t-test. CV folds overlap, so the plain
    paired t-test (used in the paper) underestimates variance and over-reports significance."""
    d = np.asarray(a) - np.asarray(b)
    k, var = len(d), d.var(ddof=1)
    if var == 0:
        return 0.0, 1.0
    t = d.mean() / np.sqrt((1 / k + test_frac / (1 - test_frac)) * var)
    return t, 2 * stats.t.sf(abs(t), df=k - 1)


def pick_threshold(y, p):
    ts = np.linspace(0.05, 0.95, 181)
    return float(ts[int(np.argmax([accuracy_score(y, (p >= t).astype(int)) for t in ts]))])


def repeated_cv(models, X, y, n_rep):
    cv = RepeatedStratifiedKFold(n_splits=5, n_repeats=n_rep, random_state=SEED)
    scoring = {"auc": "roc_auc", "acc": "accuracy", "brier": "neg_brier_score", "logloss": "neg_log_loss"}
    res = {}
    for name, m in models.items():
        print(f"    {name} ...")
        s = cross_validate(m, X, y, cv=cv, scoring=scoring, n_jobs=-1)
        res[name] = {"auc": s["test_auc"], "acc": s["test_acc"],
                     "brier": -s["test_brier"], "logloss": -s["test_logloss"]}
    return res


def cv_table(res, ref="RF"):
    rows = []
    for name, r in res.items():
        row = {"Model": name}
        for k, v in r.items():
            row[f"{k} mean"], row[f"{k} sd"] = round(v.mean(), 4), round(v.std(ddof=1), 4)
        if ref in res and name != ref:
            for k in ["auc", "acc"]:
                t, p = corrected_ttest(r[k], res[ref][k])
                row[f"{k} Δ vs {ref}"] = round((r[k] - res[ref][k]).mean(), 4)
                row[f"{k} corrected p"] = round(p, 4)
        rows.append(row)
    return pd.DataFrame(rows)


# ----------------------------------------------------------------------------- [A] audit
def run_audit(path, d):
    print("\n[A] Leakage audit")
    df = pd.read_csv(path).dropna()
    X, y = df[FEATURES], df["target"].astype(int)
    X_tr, X_te, y_tr, y_te = split(X, y)
    train_rows = set(map(tuple, X_tr.to_numpy()))
    seen = np.array([tuple(r) in train_rows for r in X_te.to_numpy()])
    facts = {
        "rows": len(df), "exact duplicate rows": int(df.duplicated().sum()),
        "unique rows": int(len(df.drop_duplicates())),
        "test rows with exact copy in train": f"{seen.sum()} / {len(seen)}",
        "cholesterol == 0 rows": int((df.cholesterol == 0).sum()),
        "P(disease | cholesterol==0)": round(df.loc[df.cholesterol == 0, "target"].mean(), 3),
        "P(disease | cholesterol>0)": round(df.loc[df.cholesterol > 0, "target"].mean(), 3),
    }
    for k, v in facts.items():
        print(f"  {k:38s} {v}")
    pd.Series(facts).to_csv(f"{d}/A_audit_facts.csv")

    # Memorisation probe: accuracy on test rows the model has literally seen vs genuinely new rows
    probes = {
        "RF (paper setting)": RandomForestClassifier(random_state=SEED),
        "XGB (depth 5)": XGBClassifier(n_estimators=100, max_depth=5, eval_metric="logloss",
                                       random_state=SEED, n_jobs=1),
        "LogReg": Pipeline([("prep", linear_prep()), ("clf", LogisticRegression(max_iter=2000))]),
    }
    rows = []
    yt = y_te.to_numpy()
    for name, m in probes.items():
        pred = m.fit(X_tr, y_tr).predict(X_te)
        rows.append({"Model": name, "Test acc (all)": accuracy_score(yt, pred),
                     f"Acc on seen rows (n={seen.sum()})": accuracy_score(yt[seen], pred[seen]),
                     f"Acc on unseen rows (n={(~seen).sum()})": accuracy_score(yt[~seen], pred[~seen])})
    probe = pd.DataFrame(rows).round(4)
    print(probe.to_string(index=False))
    probe.to_csv(f"{d}/A_memorisation_probe.csv", index=False)


# ----------------------------------------------------------------------------- [B] variants
def run_variants(path, d, n_rep):
    print("\n[B] Dataset variants (repeated 5-fold CV)")
    subset = {k: v for k, v in base_learners().items() if k in ["RF", "XGB", "LogReg"]}
    out = []
    for label, kw in [("raw 1190 (paper)", {}),
                      ("dedup 918", {"dedup": True}),
                      ("dedup + zeros->NaN", {"dedup": True, "zeros_as_missing": True})]:
        print(f"  variant: {label}")
        X, y = load(path, **kw)
        out.append(cv_table(repeated_cv(subset, X, y, n_rep)).assign(Variant=label, n=len(y)))
    res = pd.concat(out)
    print(res[["Variant", "n", "Model", "auc mean", "acc mean", "brier mean"]].to_string(index=False))
    res.to_csv(f"{d}/B_variants.csv", index=False)


# ----------------------------------------------------------------------------- [C] held-out
def run_heldout(X, y, d, n_boot):
    print("\n[C] Held-out test, clean data (dedup + zeros->NaN)")
    X_tr, X_te, y_tr, y_te = split(X, y)
    ytr, yte = y_tr.to_numpy(), y_te.to_numpy()
    inner = StratifiedKFold(5, shuffle=True, random_state=SEED)
    rows, test_p, oofs = [], {}, {}
    for name, m in all_models().items():
        print(f"    {name} ...")
        oof = cross_val_predict(clone(m), X_tr, y_tr, cv=inner, method="predict_proba", n_jobs=-1)[:, 1]
        thr = pick_threshold(ytr, oof)
        fitted = clone(m).fit(X_tr, y_tr)
        p = fitted.predict_proba(X_te)[:, 1]
        oofs[name], test_p[name] = oof, p
        met = binary_metrics(y_te, (p >= thr).astype(int), p)
        rows.append({"Model": name, "Threshold (from train OOF)": round(thr, 3),
                     **{k: round(v, 4) for k, v in met.items()},
                     "Acc @0.50": round(accuracy_score(yte, (p >= 0.5).astype(int)), 4),
                     "Brier": round(brier_score_loss(yte, p), 4),
                     "LogLoss": round(log_loss(yte, np.clip(p, 1e-6, 1 - 1e-6)), 4),
                     "OOF AUC (train)": round(roc_auc_score(ytr, oof), 4)})
        if name == "Greedy ensemble":
            w = pd.Series(fitted.weights_, index=fitted.names_).round(3)
            print("    greedy weights:", w[w > 0].to_dict())
            w.to_csv(f"{d}/C_greedy_weights.csv")
    res = pd.DataFrame(rows)
    print(res.to_string(index=False))
    res.to_csv(f"{d}/C_heldout.csv", index=False)

    # Paired bootstrap: ΔAUC vs RF on the same resampled patients
    rng = np.random.default_rng(SEED)
    idx = [rng.integers(0, len(yte), len(yte)) for _ in range(n_boot)]
    idx = [i for i in idx if 0 < yte[i].sum() < len(i)]
    brow = []
    for name, p in test_p.items():
        if name == "RF":
            continue
        diffs = np.array([roc_auc_score(yte[i], p[i]) - roc_auc_score(yte[i], test_p["RF"][i]) for i in idx])
        brow.append({"Model": name, "ΔAUC vs RF": round(roc_auc_score(yte, p) - roc_auc_score(yte, test_p["RF"]), 4),
                     "95% CI low": round(np.quantile(diffs, 0.025), 4),
                     "95% CI high": round(np.quantile(diffs, 0.975), 4),
                     "P(Δ>0)": round((diffs > 0).mean(), 3)})
    bdf = pd.DataFrame(brow)
    print(bdf.to_string(index=False))
    bdf.to_csv(f"{d}/C_bootstrap_dAUC_vs_RF.csv", index=False)

    # Diversity of base learners (train OOF): low error correlation = room for ensembling
    base = [n for n in base_learners()]
    err = pd.DataFrame({n: ((oofs[n] >= 0.5).astype(int) != ytr).astype(int) for n in base})
    plt.figure(figsize=(8, 6))
    sns.heatmap(err.corr(), annot=True, fmt=".2f", cmap="viridis", vmin=0, vmax=1)
    plt.title("Error correlation of base learners (train OOF) — lower = more diverse")
    plt.tight_layout()
    plt.savefig(f"{d}/C_error_correlation.png", dpi=200)
    plt.close("all")
    err.corr().round(3).to_csv(f"{d}/C_error_correlation.csv")
    return test_p, yte


# ----------------------------------------------------------------------------- [D] zoo CV
def run_zoo_cv(X, y, d, n_rep):
    print("\n[D] All models, repeated 5-fold CV on clean data, corrected t-test vs RF")
    res = cv_table(repeated_cv(all_models(), X, y, n_rep))
    print(res.to_string(index=False))
    res.to_csv(f"{d}/D_zoo_repeated_cv.csv", index=False)


# ----------------------------------------------------------------------------- [E] conformal
def run_conformal(X, y, d, alpha=0.10):
    print(f"\n[E] Conformal prediction (target coverage {1 - alpha:.0%}), calibrated on TRAIN only")
    X_tr, X_te, y_tr, y_te = split(X, y)
    X_fit, X_cal, y_fit, y_cal = train_test_split(X_tr, y_tr, test_size=0.25, stratify=y_tr,
                                                  random_state=SEED)
    model = all_models()["Greedy ensemble"].fit(X_fit, y_fit)
    ycal, yte = y_cal.to_numpy(), y_te.to_numpy()
    s_cal = 1 - model.predict_proba(X_cal)[np.arange(len(ycal)), ycal]
    P_te = model.predict_proba(X_te)
    sex_cal, sex_te = X_cal["sex"].to_numpy(), X_te["sex"].to_numpy()
    rows = []
    for mode in ["marginal", "Mondrian by sex"]:
        g_cal = sex_cal if mode != "marginal" else np.zeros(len(ycal))
        g_te = sex_te if mode != "marginal" else np.zeros(len(yte))
        sets = np.zeros((len(yte), 2), bool)
        for g in np.unique(g_cal):
            sc = s_cal[g_cal == g]
            n = len(sc)
            q = np.quantile(sc, min(1.0, np.ceil((n + 1) * (1 - alpha)) / n), method="higher")
            sets[g_te == g] = (1 - P_te[g_te == g]) <= q
        covered = sets[np.arange(len(yte)), yte]
        single = sets.sum(1) == 1
        for sv, lab in [(None, "All"), (0, "Female"), (1, "Male")]:
            m = np.ones(len(yte), bool) if sv is None else sex_te == sv
            ds = m & single
            rows.append({"Mode": mode, "Group": lab, "n": int(m.sum()),
                         "Coverage": round(covered[m].mean(), 3),
                         "Avg set size": round(sets[m].sum(1).mean(), 3),
                         "Decisive (single label) %": round(single[m].mean(), 3),
                         "Acc on decisive": round((sets[ds].argmax(1) == yte[ds]).mean(), 3) if ds.any() else np.nan,
                         "Referred (both labels) %": round((sets[m].sum(1) == 2).mean(), 3)})
    res = pd.DataFrame(rows)
    print(res.to_string(index=False))
    res.to_csv(f"{d}/E_conformal.csv", index=False)


# ----------------------------------------------------------------------------- [F] DCA
def run_dca(test_p, y, d):
    print("\n[F] Decision-curve analysis")
    ts = np.linspace(0.05, 0.80, 76)
    n, prev = len(y), y.mean()
    plt.figure(figsize=(8, 5))
    rows = {"threshold": ts, "Treat all": prev - (1 - prev) * ts / (1 - ts)}
    for name in ["RF", "LogReg", "Greedy ensemble", "Stacking (LR meta)"]:
        p = test_p[name]
        rows[name] = [((p >= t) & (y == 1)).sum() / n - ((p >= t) & (y == 0)).sum() / n * t / (1 - t) for t in ts]
    for k, v in rows.items():
        if k != "threshold":
            plt.plot(ts, v, label=k, ls="--" if k == "Treat all" else "-")
    plt.axhline(0, color="k", lw=0.8, label="Treat none")
    plt.ylim(-0.05, prev + 0.05)
    plt.xlabel("Threshold probability")
    plt.ylabel("Net benefit")
    plt.title("Decision curve (held-out test, clean data)")
    plt.legend()
    plt.tight_layout()
    plt.savefig(f"{d}/F_decision_curve.png", dpi=200)
    plt.close("all")
    pd.DataFrame(rows).round(4).to_csv(f"{d}/F_decision_curve.csv", index=False)


# ----------------------------------------------------------------------------- main
STEPS = ["audit", "variants", "heldout", "zoo_cv", "conformal", "dca"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="merge.csv")
    ap.add_argument("--out", default=os.path.join("outputs", "12_v2"))
    ap.add_argument("--fast", action="store_true")
    ap.add_argument("--only", nargs="+", choices=STEPS)
    a = ap.parse_args()
    steps = set(a.only or STEPS)
    n_rep, n_boot = (2, 300) if a.fast else (5, 2000)
    set_seed()
    os.makedirs(a.out, exist_ok=True)

    if "audit" in steps:
        run_audit(a.data, a.out)
    if "variants" in steps:
        run_variants(a.data, a.out, n_rep)
    X, y = load(a.data, dedup=True, zeros_as_missing=True)
    test_p = yte = None
    if steps & {"heldout", "dca"}:
        test_p, yte = run_heldout(X, y, a.out, n_boot)
    if "zoo_cv" in steps:
        run_zoo_cv(X, y, a.out, n_rep)
    if "conformal" in steps:
        run_conformal(X, y, a.out)
    if "dca" in steps:
        run_dca(test_p, yte, a.out)
    print(f"\nDone. Results in ./{a.out}/")


if __name__ == "__main__":
    main()
