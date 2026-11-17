"""Knowledge distillation: ensemble teacher -> small PyTorch MLP student.

Soft targets are CROSS-FITTED: every training patient (and its jittered copies) is labelled
by a teacher that never saw that patient. A teacher scoring its own training rows is
over-confident (RF/ET memorise them), which would teach the student over-confident outputs.

The student and its encoder (incl. the regression imputer) are stored as plain tensors /
lists, so the .pth loads with torch.load(weights_only=True) and needs no scikit-learn."""
import numpy as np
import pandas as pd
import torch
from sklearn.base import clone
from sklearn.model_selection import StratifiedKFold
from torch import nn

from .config import BINARY, CATEGORY_LEVELS, NOMINAL, NUM
from .features import ClinicalImputer, num_cols


class TabularEncoder:
    """ClinicalImputer -> standardise numerics -> one-hot nominal codes -> binaries."""

    def __init__(self, mode="regress"):
        self.mode = mode

    def fit(self, X: pd.DataFrame):
        self.imputer = ClinicalImputer(self.mode).fit(X)
        Xn = self.imputer.transform(X)[num_cols(self.mode)].astype(float)
        self.medians = {c: float(v) for c, v in Xn.median().items()}
        filled = Xn.fillna(self.medians)
        self.means = {c: float(v) for c, v in filled.mean().items()}
        self.stds = {c: (float(v) if v > 0 else 1.0) for c, v in filled.std(ddof=0).items()}
        return self

    def transform(self, X: pd.DataFrame) -> np.ndarray:
        Xi = self.imputer.transform(X)
        cols = []
        for c in num_cols(self.mode):
            v = Xi[c].astype(float).fillna(self.medians[c])
            cols.append(((v - self.means[c]) / self.stds[c]).to_numpy())
        for c in NOMINAL:
            for lvl in CATEGORY_LEVELS[c]:
                cols.append((Xi[c].to_numpy() == lvl).astype(float))
        for c in BINARY:
            cols.append(Xi[c].astype(float).to_numpy())
        return np.column_stack(cols).astype(np.float32)

    def to_dict(self):
        return {"mode": self.mode, "imputer": self.imputer.to_dict(),
                "medians": self.medians, "means": self.means, "stds": self.stds}

    @classmethod
    def from_dict(cls, d):
        enc = cls(d.get("mode", "median"))
        enc.imputer = ClinicalImputer.from_dict(d["imputer"]) if "imputer" in d else ClinicalImputer("median").fit(
            pd.DataFrame({c: [0.0] for c in NUM}))
        enc.medians, enc.means, enc.stds = dict(d["medians"]), dict(d["means"]), dict(d["stds"])
        return enc


class StudentMLP(nn.Module):
    def __init__(self, in_features, hidden=(32, 16), dropout=0.1):
        super().__init__()
        layers, d = [], in_features
        for h in hidden:
            layers += [nn.Linear(d, h), nn.ReLU(), nn.Dropout(dropout)]
            d = h
        layers.append(nn.Linear(d, 1))
        self.net = nn.Sequential(*layers)

    def forward(self, x):
        return self.net(x).squeeze(-1)  # logits


def make_transfer_set(X, n_copies, noise, rng, stds):
    """Original rows + jittered copies (numeric features only; NaN stays NaN)."""
    parts = [X]
    for _ in range(n_copies):
        Xc = X.copy()
        for c in NUM:
            Xc[c] = Xc[c] + rng.normal(0, noise * stds[c], len(Xc))
        parts.append(Xc)
    return pd.concat(parts, ignore_index=True)


def cross_fitted_targets(teacher_template, X_tr, y_tr, n_copies, noise, seed, n_folds=5):
    rng = np.random.default_rng(seed)
    stds = X_tr[NUM].std()
    X_parts, p_parts, y_parts = [], [], []
    skf = StratifiedKFold(n_folds, shuffle=True, random_state=seed)
    for tr, va in skf.split(X_tr, y_tr):
        teacher = clone(teacher_template).fit(X_tr.iloc[tr], y_tr.iloc[tr])
        Xv = make_transfer_set(X_tr.iloc[va].reset_index(drop=True), n_copies, noise, rng, stds)
        X_parts.append(Xv)
        p_parts.append(teacher.predict_proba(Xv)[:, 1])
        y_parts.append(np.tile(y_tr.iloc[va].to_numpy(), n_copies + 1))
    return pd.concat(X_parts, ignore_index=True), np.concatenate(p_parts), np.concatenate(y_parts)


def distill(teacher_template, X_tr, y_tr, impute="regress", seed=42, hidden=(32, 16), dropout=0.1,
            epochs=400, lr=5e-3, weight_decay=1e-4, alpha=0.7, temperature=2.0, n_copies=5, noise=0.05):
    """loss = alpha * T^2 * BCE(student/T, teacher_soft) + (1 - alpha) * BCE(student, y)."""
    torch.manual_seed(seed)
    Xt, p_teacher, yt = cross_fitted_targets(teacher_template, X_tr, y_tr, n_copies, noise, seed)
    p_teacher = np.clip(p_teacher, 1e-4, 1 - 1e-4).astype(np.float32)

    enc = TabularEncoder(impute).fit(X_tr)
    Z = torch.from_numpy(enc.transform(Xt))
    soft = torch.sigmoid(torch.logit(torch.from_numpy(p_teacher)) / temperature)
    hard = torch.from_numpy(yt.astype(np.float32))

    model = StudentMLP(Z.shape[1], hidden, dropout)
    opt = torch.optim.Adam(model.parameters(), lr=lr, weight_decay=weight_decay)
    bce = nn.BCEWithLogitsLoss()
    for _ in range(epochs):
        model.train()
        opt.zero_grad()
        z = model(Z)
        loss = alpha * temperature ** 2 * bce(z / temperature, soft) + (1 - alpha) * bce(z, hard)
        loss.backward()
        opt.step()
    model.eval()
    arch = {"in_features": int(Z.shape[1]), "hidden": list(hidden), "dropout": float(dropout)}
    return model, enc, arch


@torch.no_grad()
def student_proba(model, enc, X):
    model.eval()
    return torch.sigmoid(model(torch.from_numpy(enc.transform(X)))).numpy()
