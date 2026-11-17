"""Metrics, statistics, threshold choice, conformal prediction, decision curves."""
import numpy as np
from scipy import stats
from sklearn.metrics import (accuracy_score, brier_score_loss, confusion_matrix, f1_score,
                             log_loss, precision_score, recall_score, roc_auc_score)


def binary_metrics(y, p, thr=0.5):
    y = np.asarray(y)
    pred = (p >= thr).astype(int)
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    return {
        "threshold": float(thr),
        "accuracy": float(accuracy_score(y, pred)),
        "precision": float(precision_score(y, pred, zero_division=0)),
        "sensitivity": float(recall_score(y, pred)),
        "specificity": float(tn / (tn + fp)) if tn + fp else float("nan"),
        "f1": float(f1_score(y, pred)),
        "auc": float(roc_auc_score(y, p)),
        "brier": float(brier_score_loss(y, p)),
        "log_loss": float(log_loss(y, np.clip(p, 1e-6, 1 - 1e-6))),
        "confusion": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
    }


def pick_threshold(y, p):
    """Accuracy-maximising threshold chosen on TRAINING out-of-fold predictions only.
    Accuracy is flat over a range of thresholds; argmax would always return the LOWEST tied
    threshold (silently biasing towards sensitivity), so the median of the tied plateau is used."""
    ts = np.linspace(0.05, 0.95, 181)
    acc = np.array([accuracy_score(y, (p >= t).astype(int)) for t in ts])
    return float(np.median(ts[acc >= acc.max() - 1e-12]))


def corrected_ttest(a, b, test_frac=0.2):
    """Nadeau & Bengio (2003) corrected resampled t-test."""
    d = np.asarray(a) - np.asarray(b)
    k, var = len(d), d.var(ddof=1)
    if var == 0:
        return 0.0, 1.0
    t = d.mean() / np.sqrt((1 / k + test_frac / (1 - test_frac)) * var)
    return float(t), float(2 * stats.t.sf(abs(t), df=k - 1))


def bootstrap_auc_ci(y, p, n_boot=2000, seed=42):
    y, rng, vals = np.asarray(y), np.random.default_rng(seed), []
    for _ in range(n_boot):
        i = rng.integers(0, len(y), len(y))
        if 0 < y[i].sum() < len(i):
            vals.append(roc_auc_score(y[i], p[i]))
    return float(np.quantile(vals, 0.025)), float(np.quantile(vals, 0.975))


# ---------------------------------------------------------------- conformal (binary, LAC score)
def conformal_quantile(y, p, alpha=0.10):
    """Score = 1 - P(true class). Computed on OUT-OF-FOLD predictions (cross-conformal)."""
    y = np.asarray(y)
    s = np.where(y == 1, 1 - p, p)
    n = len(s)
    level = min(1.0, np.ceil((n + 1) * (1 - alpha)) / n)
    return float(np.quantile(s, level, method="higher"))


def conformal_sets(p, q):
    """Returns boolean array (n, 2): column c is True if class c is in the prediction set."""
    p = np.asarray(p)
    return np.column_stack([p <= q, (1 - p) <= q])


def conformal_report(y, p, q):
    y = np.asarray(y)
    sets = conformal_sets(p, q)
    single = sets.sum(1) == 1
    return {
        "coverage": float(sets[np.arange(len(y)), y].mean()),
        "avg_set_size": float(sets.sum(1).mean()),
        "decisive_rate": float(single.mean()),
        "accuracy_on_decisive": float((sets[single].argmax(1) == y[single]).mean()) if single.any() else float("nan"),
        "referred_rate": float((sets.sum(1) == 2).mean()),
        "empty_rate": float((sets.sum(1) == 0).mean()),
    }


def decision(set_row):
    has0, has1 = bool(set_row[0]), bool(set_row[1])
    if has1 and not has0:
        return "Disease likely"
    if has0 and not has1:
        return "No disease likely"
    if has0 and has1:
        return "Uncertain - refer to clinician"
    return "Atypical input - refer to clinician"


def net_benefit(y, p, thresholds):
    y, n = np.asarray(y), len(y)
    return np.array([((p >= t) & (y == 1)).sum() / n - ((p >= t) & (y == 0)).sum() / n * t / (1 - t)
                     for t in thresholds])
