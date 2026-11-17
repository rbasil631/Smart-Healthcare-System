#!/usr/bin/env python3
"""Train, select, evaluate and export SmartHeart models (v2.1).

    python scripts/train.py                     # auto-select best model by repeated CV (train split only)
    python scripts/train.py --model soft_vote   # skip selection
    python scripts/train.py --refit-all         # after evaluation, refit the ensemble on all clean data
    python scripts/train.py --fast              # 2 CV repeats, 300 bootstraps

Exports:
    models/smartheart_ensemble.pth   best scikit-learn model (+ threshold, conformal q, metrics)
    models/smartheart_student.pth    distilled PyTorch MLP (pure tensors, no sklearn needed)
    outputs/train/*                  audit, model selection, test metrics, plots, model card
"""
import argparse
import json
import sys
import time
import warnings
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.calibration import calibration_curve
from sklearn.metrics import roc_curve
from sklearn.model_selection import RepeatedStratifiedKFold, StratifiedKFold, cross_val_predict, cross_validate

from smartheart_ml.config import DATA_PATH, MODELS_DIR, OUTPUTS_DIR, SEED
from smartheart_ml.data import audit, clean, load_raw, split, xy
from smartheart_ml.distill import distill, student_proba
from smartheart_ml.evaluation import (binary_metrics, bootstrap_auc_ci, conformal_quantile,
                                      conformal_report, corrected_ttest, net_benefit, pick_threshold)
from smartheart_ml.models import DISPLAY, candidates
from smartheart_ml.persistence import save_ensemble, save_student

warnings.filterwarnings("ignore")


def log(msg):
    print(msg, flush=True)


def select_model(X_tr, y_tr, n_rep, out, impute):
    log(f"\n[2] Model selection: repeated 5-fold CV x{n_rep} on the TRAIN split only")
    cv = RepeatedStratifiedKFold(n_splits=5, n_repeats=n_rep, random_state=SEED)
    scores = {}
    for key, model in candidates(impute=impute).items():
        log(f"    {DISPLAY[key]} ...")
        s = cross_validate(model, X_tr, y_tr, cv=cv, n_jobs=-1,
                           scoring={"auc": "roc_auc", "ll": "neg_log_loss", "acc": "accuracy"})
        scores[key] = {"auc": s["test_auc"], "log_loss": -s["test_ll"], "accuracy": s["test_acc"]}
    rows = []
    for k, s in scores.items():
        t, p = corrected_ttest(s["auc"], scores["rf"]["auc"]) if k != "rf" else (np.nan, np.nan)
        rows.append({"model": k, "auc_mean": s["auc"].mean(), "auc_sd": s["auc"].std(ddof=1),
                     "log_loss_mean": s["log_loss"].mean(), "accuracy_mean": s["accuracy"].mean(),
                     "auc_delta_vs_rf": s["auc"].mean() - scores["rf"]["auc"].mean(),
                     "auc_corrected_p_vs_rf": p})
    table = pd.DataFrame(rows).sort_values(["auc_mean", "log_loss_mean"], ascending=[False, True])
    table.round(4).to_csv(out / "model_selection_cv.csv", index=False)
    log(table.round(4).to_string(index=False))
    best = table.iloc[0]["model"]
    log(f"    -> selected: {DISPLAY[best]}")
    return best


def plots(y_te, curves, thr, out):
    fig, ax = plt.subplots(1, 3, figsize=(18, 5))
    for name, p in curves.items():
        fpr, tpr, _ = roc_curve(y_te, p)
        ax[0].plot(fpr, tpr, label=name)
        fp, mp = calibration_curve(y_te, p, n_bins=8)
        ax[1].plot(mp, fp, "o-", label=name)
    ax[0].plot([0, 1], [0, 1], "k--", lw=0.8)
    ax[0].set(title="ROC (held-out test)", xlabel="FPR", ylabel="TPR")
    ax[1].plot([0, 1], [0, 1], "k--", lw=0.8)
    ax[1].set(title="Reliability (held-out test)", xlabel="Mean predicted", ylabel="Observed")
    ts = np.linspace(0.05, 0.8, 76)
    prev = np.mean(y_te)
    for name, p in curves.items():
        ax[2].plot(ts, net_benefit(y_te, p, ts), label=name)
    ax[2].plot(ts, prev - (1 - prev) * ts / (1 - ts), "--", label="Treat all")
    ax[2].axhline(0, color="k", lw=0.8, label="Treat none")
    ax[2].axvline(thr, color="grey", ls=":", lw=0.8)
    ax[2].set(title="Decision curve", xlabel="Threshold probability", ylabel="Net benefit", ylim=(-0.05, prev + 0.05))
    for a in ax:
        a.legend(fontsize="small")
        a.grid(alpha=0.3)
    plt.tight_layout()
    plt.savefig(out / "test_roc_calibration_dca.png", dpi=200)
    plt.close("all")


def latency_ms(fn, X, n=100):
    row = X.iloc[[0]]
    fn(row)  # warm-up
    t0 = time.perf_counter()
    for _ in range(n):
        fn(row)
    return 1000 * (time.perf_counter() - t0) / n


def jsonable(d):
    return json.loads(json.dumps(d, default=float))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=str(DATA_PATH))
    ap.add_argument("--model", default="auto", choices=["auto", "rf", "catboost", "logreg", "soft_vote", "stacking", "greedy"])
    ap.add_argument("--impute", default="regress", choices=["regress", "median", "drop"],
                    help="how missing cholesterol/BP are handled (see features.py)")
    ap.add_argument("--alpha", type=float, default=0.10, help="conformal miscoverage (0.10 -> 90%% target)")
    ap.add_argument("--cv-repeats", type=int, default=3)
    ap.add_argument("--refit-all", action="store_true", help="refit final ensemble on train+test before export")
    ap.add_argument("--no-distill", action="store_true")
    ap.add_argument("--fast", action="store_true")
    a = ap.parse_args()
    n_rep, n_boot = (2, 300) if a.fast else (a.cv_repeats, 2000)
    np.random.seed(SEED)

    out = OUTPUTS_DIR / "train"
    out.mkdir(parents=True, exist_ok=True)
    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    # 1. data
    raw = load_raw(a.data)
    facts = audit(raw)
    (out / "audit.json").write_text(json.dumps(facts, indent=2))
    log("[1] Audit: " + json.dumps(facts))
    X, y = xy(clean(raw))
    X_tr, X_te, y_tr, y_te = split(X, y)
    ytr, yte = y_tr.to_numpy(), y_te.to_numpy()
    log(f"    imputation mode: {a.impute}")
    log(f"    clean data: {len(y)} patients -> train {len(y_tr)}, test {len(y_te)}")

    # 2. selection
    key = select_model(X_tr, y_tr, n_rep, out, a.impute) if a.model == "auto" else a.model
    name = DISPLAY[key]

    # 3. threshold + conformal quantile from TRAIN out-of-fold predictions
    log(f"\n[3] Out-of-fold predictions on train for threshold + conformal calibration ({name})")
    inner = StratifiedKFold(5, shuffle=True, random_state=SEED)
    oof = cross_val_predict(clone(candidates(impute=a.impute)[key]), X_tr, y_tr, cv=inner, method="predict_proba", n_jobs=-1)[:, 1]
    thr = pick_threshold(ytr, oof)
    q = conformal_quantile(ytr, oof, a.alpha)
    log(f"    threshold={thr:.3f}  conformal q={q:.4f}  (alpha={a.alpha})")

    # 4. fit on train, evaluate once on test
    log("\n[4] Fit on train, evaluate on held-out test")
    model = clone(candidates(impute=a.impute)[key]).fit(X_tr, y_tr)
    p_te = model.predict_proba(X_te)[:, 1]
    m = binary_metrics(yte, p_te, thr)
    m["auc_95ci"] = bootstrap_auc_ci(yte, p_te, n_boot)
    m["conformal"] = conformal_report(yte, p_te, q)
    m["latency_ms_per_patient"] = latency_ms(lambda r: model.predict_proba(r), X_te)
    log(json.dumps(jsonable(m), indent=2))
    curves = {name: p_te}
    results = {"selected_model": key, "impute": a.impute, "ensemble_test": m}
    if hasattr(model, "weights_"):
        results["greedy_weights"] = dict(zip(model.names_, map(float, model.weights_)))

    # 5. distillation (teacher = train-only model, so the student's test score stays honest)
    if not a.no_distill:
        log("\n[5] Distilling into a PyTorch MLP student")
        student, enc, arch = distill(candidates(impute=a.impute)[key], X_tr, y_tr, impute=a.impute, seed=SEED)
        p_st = student_proba(student, enc, X_te)
        ms = binary_metrics(yte, p_st, thr)
        ms["auc_95ci"] = bootstrap_auc_ci(yte, p_st, n_boot)
        ms["conformal"] = conformal_report(yte, p_st, q)
        ms["agreement_with_teacher"] = float(((p_st >= thr) == (p_te >= thr)).mean())
        ms["latency_ms_per_patient"] = latency_ms(lambda r: student_proba(student, enc, r), X_te)
        ms["n_parameters"] = int(sum(p.numel() for p in student.parameters()))
        log(json.dumps(jsonable(ms), indent=2))
        results["student_test"] = ms
        curves["Distilled MLP student"] = p_st
        save_student(MODELS_DIR / "smartheart_student.pth", student, enc, arch, jsonable({
            "model_name": f"MLP student distilled from {name}", "threshold": thr, "alpha": a.alpha,
            "conformal_q": q, "impute": a.impute, "test_metrics": ms, "trained_on": "train split (dedup + zeros->NaN)"}))
        log("    saved models/smartheart_student.pth")

    plots(yte, curves, thr, out)

    # 6. export ensemble
    trained_on = "train split (dedup + zeros->NaN)"
    if a.refit_all:
        log("\n[6] Refitting ensemble on ALL clean data for deployment (test metrics above remain the estimate)")
        model = clone(candidates(impute=a.impute)[key]).fit(X, y)
        trained_on = "all clean data (train+test); reported metrics are from the held-out evaluation"
    save_ensemble(MODELS_DIR / "smartheart_ensemble.pth", model, jsonable({
        "model_name": name, "threshold": thr, "alpha": a.alpha, "conformal_q": q, "impute": a.impute,
        "test_metrics": m, "trained_on": trained_on, "features": list(X.columns)}))
    log("    saved models/smartheart_ensemble.pth")

    results["trained_on"] = trained_on
    (out / "results.json").write_text(json.dumps(jsonable(results), indent=2))
    write_model_card(out, facts, name, thr, q, a.alpha, results)
    log(f"\nDone. See {out} and {MODELS_DIR}")


def write_model_card(out, facts, name, thr, q, alpha, r):
    e = r["ensemble_test"]
    lines = [
        "# SmartHeart model card", "",
        f"**Model:** {name}  ", f"**Trained on:** {r['trained_on']}  ",
        f"**Decision threshold:** {thr:.3f} (chosen on train out-of-fold predictions)  ",
        f"**Missing cholesterol/BP handling:** {r['impute']}  ",
        f"**Conformal:** alpha={alpha}, q={q:.4f} (cross-conformal on train OOF)", "",
        "## Data audit", "", *[f"- {k}: {v}" for k, v in facts.items()], "",
        "## Held-out test (clean data)", "",
        "| Model | AUC (95% CI) | Acc | Sens | Spec | Brier | Coverage | Decisive | Acc on decisive | ms/patient |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]

    def row(label, m):
        c = m["conformal"]
        return (f"| {label} | {m['auc']:.3f} ({m['auc_95ci'][0]:.3f}-{m['auc_95ci'][1]:.3f}) | {m['accuracy']:.3f} | "
                f"{m['sensitivity']:.3f} | {m['specificity']:.3f} | {m['brier']:.4f} | {c['coverage']:.3f} | "
                f"{c['decisive_rate']:.3f} | {c['accuracy_on_decisive']:.3f} | {m['latency_ms_per_patient']:.2f} |")

    lines.append(row(name, e))
    if "student_test" in r:
        lines.append(row("Distilled MLP student", r["student_test"]))
        lines += ["", f"Student parameters: {r['student_test']['n_parameters']}, "
                      f"agreement with teacher: {r['student_test']['agreement_with_teacher']:.3f}"]
    lines += ["", "## Intended use", "",
              "Research / educational decision-support prototype. Not a medical device and not validated "
              "for clinical diagnosis. Trained on a retrospective, pre-merged public dataset without "
              "external (cross-site) validation."]
    (out / "model_card.md").write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
