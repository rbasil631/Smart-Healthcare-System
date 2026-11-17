"""Diverse base learners and ensemble strategies."""
import numpy as np
from sklearn.base import BaseEstimator, ClassifierMixin, clone
from sklearn.ensemble import (ExtraTreesClassifier, RandomForestClassifier,
                              StackingClassifier, VotingClassifier)
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.neighbors import KNeighborsClassifier
from sklearn.pipeline import Pipeline
from sklearn.svm import SVC
from xgboost import XGBClassifier
from catboost import CatBoostClassifier

from .config import SEED
from .features import ClinicalImputer, linear_prep, tree_prep


def base_learners(seed=SEED, impute="regress"):
    def T():
        return [("impute", ClinicalImputer(impute)), ("prep", tree_prep(impute))]

    def L():
        return [("impute", ClinicalImputer(impute)), ("prep", linear_prep(impute))]

    return {
        "RF": Pipeline([*T(), ("clf", RandomForestClassifier(
            n_estimators=300, random_state=seed, n_jobs=1))]),
        "ET": Pipeline([*T(), ("clf", ExtraTreesClassifier(
            n_estimators=300, min_samples_leaf=2, random_state=seed, n_jobs=1))]),
        "XGB": Pipeline([*T(), ("clf", XGBClassifier(
            n_estimators=300, max_depth=3, learning_rate=0.05, subsample=0.9, colsample_bytree=0.8,
            eval_metric="logloss", random_state=seed, n_jobs=1))]),
        "CatBoost": Pipeline([*T(), ("clf", CatBoostClassifier(
            iterations=400, depth=5, learning_rate=0.05, verbose=0, random_seed=seed,
            thread_count=1, allow_writing_files=False))]),
        "LogReg": Pipeline([*L(), ("clf", LogisticRegression(C=1.0, max_iter=2000))]),
        "SVC": Pipeline([*L(), ("clf", SVC(C=1.0, probability=True, random_state=seed))]),
        # uniform weights: distance weighting produced 0/1 probabilities (log-loss 0.77 in v2)
        "kNN": Pipeline([*L(), ("clf", KNeighborsClassifier(n_neighbors=25, weights="uniform"))]),
    }


class GreedyEnsemble(ClassifierMixin, BaseEstimator):
    """Caruana et al. (2004) ensemble selection with replacement; weights learned on internal OOF
    probabilities by greedily minimising log-loss."""

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


DISPLAY = {"rf": "Random Forest", "catboost": "CatBoost", "logreg": "Logistic Regression",
           "soft_vote": "Soft-voting ensemble (7 learners)",
           "stacking": "Stacking ensemble (LogReg meta)", "greedy": "Greedy (Caruana) ensemble"}


def candidates(seed=SEED, impute="regress"):
    base = base_learners(seed, impute)
    est = list(base.items())
    return {
        "rf": base["RF"],
        "catboost": base["CatBoost"],
        "logreg": base["LogReg"],
        "soft_vote": VotingClassifier(est, voting="soft"),
        "stacking": StackingClassifier(
            est, final_estimator=LogisticRegression(max_iter=2000),
            cv=StratifiedKFold(5, shuffle=True, random_state=seed), stack_method="predict_proba"),
        "greedy": GreedyEnsemble(est, random_state=seed),
    }
