#!/usr/bin/env python3
"""Leave-one-site-out (LOSO) external validation.

Each of the four source hospitals is held out in turn; models are trained on the other three
and tested on the unseen hospital. This is the cross-site validation the SmartHeart paper lists
as future work, made possible by recovering the site of every row (data.recover_sites).

    python scripts/loso.py                    # impute modes regress + drop, 5 models
    python scripts/loso.py --fast             # 3 models, fewer bootstraps
    python scripts/loso.py --impute drop

Outputs (outputs/loso/):
    sites.csv                   patients / prevalence / missing cholesterol per site
    site_probe.csv              how identifiable the site is from the features (confounding)
    internal_cv.csv             random-split CV on the same 918 patients (the optimistic reference)
    loso_per_site.csv           AUC (+CI), Brier, sens/spec, calibration, conformal coverage per site
    loso_summary.csv            internal vs external AUC per model -> the generalisation gap
    loso_softvote_vs_rf.csv     paired bootstrap ΔAUC per held-out site
    loso_auc_heatmap_<mode>.png, loso_calibration_<mode>.png
"""
import argparse
import sys
import warnings
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy.optimize import brentq
from scipy.special import expit, logit
from sklearn.base import clone
from sklearn.calibration import calibration_curve
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, roc_auc_score
from sklearn.model_selection import (RepeatedStratifiedKFold, StratifiedKFold, cross_val_predict,
                                     cross_validate)
from sklearn.pipeline import Pipeline

from smartheart_ml.config import FEATURES, OUTPUTS_DIR, SEED, TARGET
from smartheart_ml.data import load_with_sites
from smartheart_ml.evaluation import (binary_metrics, bootstrap_auc_ci, conformal_quantile,
                                      conformal_report, pick_threshold)
from smartheart_ml.features import ClinicalImputer, tree_prep
from smartheart_ml.models import DISPLAY, candidates

warnings.filterwarnings("ignore")


def log(msg=""):
    print(msg, flush=True)


# ------------------------------------------------------------------------- calibration helpers
def calibration_slope(y, p):
    """Slope of logit(p) in a logistic recalibration model. 1 = ideal, <1 = over-confident."""
    z = logit(np.clip(p, 1e-6, 1 - 1e-6)).reshape(-1, 1)
    if len(np.unique(y)) < 2:
        return np.nan
    return float(LogisticRegression(C=1e6, max_iter=1000).fit(z, y).coef_[0, 0])


def recalibrate_to_prevalence(p, prevalence):
    """Shift the logit so the mean prediction equals a known local prevalence (one number a
    hospital would know). Shows how much of the error is calibration-in-the-large only."""
    z = logit(np.clip(p, 1e-6, 1 - 1e-6))
    if not 0 < prevalence < 1:
        return p
    delta = brentq(lambda d: expit(z + d).mean() - prevalence, -20, 20)
    return expit(z + delta)


def paired_delta_auc(y, pa, pb, n_boot, seed=SEED):
    rng = np.random.default_rng(seed)
    d = []
    for _ in range(n_boot):
        i = rng.integers(0, len(y), len(y))
        if 0 < y[i].sum() < len(i):
            d.append(roc_auc_score(y[i], pa[i]) - roc_auc_score(y[i], pb[i]))
    d = np.array(d)
    return float(np.quantile(d, 0.025)), float(np.quantile(d, 0.975)), float((d > 0).mean())


# ------------------------------------------------------------------------- steps
def site_probe(X, site, modes):
    """Multiclass RF predicting the hospital from the 11 features (macro one-vs-rest AUC).
    High values mean site and features are entangled: a model can learn site habits."""
    rows = []
    cv = StratifiedKFold(5, shuffle=True, random_state=SEED)
    for mode in modes:
        pipe = Pipeline([("impute", ClinicalImputer(mode)), ("prep", tree_prep(mode)),
                         ("clf", RandomForestClassifier(n_estimators=300, random_state=SEED, n_jobs=-1))])
        P = cross_val_predict(pipe, X, site, cv=cv, method="predict_proba")
        classes = np.sort(site.unique())
        per = {f"AUC {c} vs rest": roc_auc_score((site == c).astype(int), P[:, k]) for k, c in enumerate(classes)}
        rows.append({"impute": mode, "macro_ovr_auc": roc_auc_score(site, P, multi_class="ovr", average="macro"),
                     **per})
        log(f"    {mode:8s} macro AUC={rows[-1]['macro_ovr_auc']:.3f}  " +
            "  ".join(f"{k.split()[1]}={v:.2f}" for k, v in per.items()))
    return pd.DataFrame(rows)


def internal_cv(X, y, mode, keys, n_rep):
    cv = RepeatedStratifiedKFold(n_splits=5, n_repeats=n_rep, random_state=SEED)
    out = {}
    for key in keys:
        s = cross_validate(candidates(impute=mode)[key], X, y, cv=cv, scoring="roc_auc", n_jobs=-1)
        out[key] = float(s["test_score"].mean())
    return out


def run_loso(df, mode, keys, alpha, n_boot):
    X, y, site = df[FEATURES], df[TARGET].astype(int), df["site"]
    rows, preds = [], {k: np.full(len(df), np.nan) for k in keys}
    for held in sorted(site.unique()):
        tr, te = (site != held).to_numpy(), (site == held).to_numpy()
        Xtr, ytr, Xte, yte = X[tr], y[tr], X[te], y[te].to_numpy()
        log(f"    held-out {held:14s} (train n={tr.sum()}, test n={te.sum()}, prevalence {yte.mean():.2f})")
        inner = StratifiedKFold(5, shuffle=True, random_state=SEED)
        for key in keys:
            model = candidates(impute=mode)[key]
            oof = cross_val_predict(clone(model), Xtr, ytr, cv=inner, method="predict_proba", n_jobs=-1)[:, 1]
            thr = pick_threshold(ytr.to_numpy(), oof)
            q = conformal_quantile(ytr.to_numpy(), oof, alpha)
            p = clone(model).fit(Xtr, ytr).predict_proba(Xte)[:, 1]
            preds[key][te] = p
            m = binary_metrics(yte, p, thr)
            lo, hi = bootstrap_auc_ci(yte, p, n_boot)
            c = conformal_report(yte, p, q)
            p_rc = recalibrate_to_prevalence(p, yte.mean())
            rows.append({
                "impute": mode, "model": key, "held_out_site": held, "n": int(te.sum()),
                "n_negative": int((yte == 0).sum()), "prevalence": yte.mean(),
                "auc": m["auc"], "auc_ci_low": lo, "auc_ci_high": hi,
                "accuracy": m["accuracy"], "sensitivity": m["sensitivity"], "specificity": m["specificity"],
                "threshold": thr, "brier": m["brier"],
                "brier_recalibrated_to_local_prevalence": brier_score_loss(yte, p_rc),
                "calibration_in_the_large": float(p.mean() - yte.mean()),
                "calibration_slope": calibration_slope(yte, p),
                "conformal_coverage": c["coverage"], "conformal_decisive": c["decisive_rate"],
            })
            log(f"        {DISPLAY[key]:36s} AUC={m['auc']:.3f} [{lo:.3f},{hi:.3f}]  Brier={m['brier']:.3f}  "
                f"CITL={p.mean() - yte.mean():+.3f}  coverage={c['coverage']:.2f}")
    return pd.DataFrame(rows), preds


def plots(per_site, df, preds, mode, keys, out):
    t = per_site[per_site.impute == mode].pivot(index="model", columns="held_out_site", values="auc")
    t = t.loc[[k for k in keys if k in t.index]]
    fig, ax = plt.subplots(figsize=(8, 0.6 * len(t) + 2))
    im = ax.imshow(t.values, cmap="viridis", vmin=0.5, vmax=1.0, aspect="auto")
    ax.set_xticks(range(t.shape[1]), t.columns)
    ax.set_yticks(range(t.shape[0]), [DISPLAY[k] for k in t.index])
    for i in range(t.shape[0]):
        for j in range(t.shape[1]):
            ax.text(j, i, f"{t.values[i, j]:.3f}", ha="center", va="center",
                    color="white" if t.values[i, j] < 0.8 else "black")
    fig.colorbar(im, ax=ax, label="AUC on unseen hospital")
    ax.set_title(f"Leave-one-site-out AUC (impute={mode})")
    plt.tight_layout()
    plt.savefig(out / f"loso_auc_heatmap_{mode}.png", dpi=200)
    plt.close("all")

    key = "soft_vote" if "soft_vote" in keys else keys[0]
    fig, ax = plt.subplots(figsize=(6, 6))
    for s in sorted(df.site.unique()):
        mask = (df.site == s).to_numpy()
        y, p = df.loc[mask, TARGET].to_numpy(), preds[key][mask]
        fp, mp = calibration_curve(y, p, n_bins=5, strategy="quantile")
        ax.plot(mp, fp, "o-", label=f"{s} (prev {y.mean():.2f})")
    ax.plot([0, 1], [0, 1], "k--", lw=0.8)
    ax.set(xlabel="Mean predicted probability", ylabel="Observed fraction with disease",
           title=f"Calibration on unseen hospitals — {DISPLAY[key]} ({mode})")
    ax.legend(fontsize="small")
    ax.grid(alpha=0.3)
    plt.tight_layout()
    plt.savefig(out / f"loso_calibration_{mode}.png", dpi=200)
    plt.close("all")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--impute", nargs="+", default=["regress", "drop"], choices=["regress", "median", "drop"])
    ap.add_argument("--models", nargs="+", default=["rf", "catboost", "logreg", "soft_vote", "stacking"],
                    choices=["rf", "catboost", "logreg", "soft_vote", "stacking", "greedy"])
    ap.add_argument("--alpha", type=float, default=0.10)
    ap.add_argument("--fast", action="store_true")
    a = ap.parse_args()
    keys = ["rf", "logreg", "soft_vote"] if a.fast else a.models
    n_boot, n_rep = (300, 1) if a.fast else (1000, 2)
    out = OUTPUTS_DIR / "loso"
    out.mkdir(parents=True, exist_ok=True)

    df = load_with_sites()
    X, y, site = df[FEATURES], df[TARGET].astype(int), df["site"]
    sites = df.groupby("site").agg(n=(TARGET, "size"), prevalence=(TARGET, "mean"),
                                   cholesterol_missing=("cholesterol", lambda s: int(s.isna().sum())),
                                   age_mean=("age", "mean")).round(3)
    sites.to_csv(out / "sites.csv")
    log("[0] Recovered sites (918 de-duplicated patients; Statlog merged into Cleveland)")
    log(sites.to_string())

    log("\n[1] Site identifiability probe (RF predicting the hospital from the features)")
    site_probe(X, site, a.impute).round(4).to_csv(out / "site_probe.csv", index=False)

    all_rows, summary, deltas = [], [], []
    for mode in a.impute:
        log(f"\n[2] impute={mode}: internal random-split CV (reference)")
        ref = internal_cv(X, y, mode, keys, n_rep)
        for k, v in ref.items():
            log(f"    {DISPLAY[k]:36s} AUC={v:.3f}")

        log(f"\n[3] impute={mode}: leave-one-site-out")
        per_site, preds = run_loso(df, mode, keys, a.alpha, n_boot)
        all_rows.append(per_site)
        plots(per_site, df, preds, mode, keys, out)

        for k in keys:
            r = per_site[per_site.model == k]
            summary.append({
                "impute": mode, "model": k, "internal_cv_auc": ref[k],
                "loso_mean_site_auc": r.auc.mean(), "loso_worst_site_auc": r.auc.min(),
                "loso_pooled_auc": roc_auc_score(y, preds[k]),
                "gap_internal_minus_loso_mean": ref[k] - r.auc.mean(),
                "mean_abs_calibration_in_the_large": r.calibration_in_the_large.abs().mean(),
                "mean_brier": r.brier.mean(), "mean_brier_recalibrated": r.brier_recalibrated_to_local_prevalence.mean(),
                "min_conformal_coverage": r.conformal_coverage.min(),
            })
        if {"soft_vote", "rf"} <= set(keys):
            for s in sorted(site.unique()):
                mask = (site == s).to_numpy()
                ys = y[mask].to_numpy()
                lo, hi, pp = paired_delta_auc(ys, preds["soft_vote"][mask], preds["rf"][mask], n_boot)
                deltas.append({"impute": mode, "held_out_site": s,
                               "delta_auc_softvote_minus_rf": roc_auc_score(ys, preds["soft_vote"][mask]) -
                               roc_auc_score(ys, preds["rf"][mask]),
                               "ci_low": lo, "ci_high": hi, "P(delta>0)": pp})

    pd.concat(all_rows).round(4).to_csv(out / "loso_per_site.csv", index=False)
    summ = pd.DataFrame(summary).round(4)
    summ.to_csv(out / "loso_summary.csv", index=False)
    log("\n[4] Summary: internal (random-split) vs external (leave-one-site-out) AUC")
    log(summ.to_string(index=False))
    if deltas:
        d = pd.DataFrame(deltas).round(4)
        d.to_csv(out / "loso_softvote_vs_rf.csv", index=False)
        log("\n[5] Soft vote minus RF on each unseen hospital (paired bootstrap)")
        log(d.to_string(index=False))
    log(f"\nDone. Results in {out}")


if __name__ == "__main__":
    main()
