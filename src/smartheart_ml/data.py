"""Loading, auditing and cleaning the merged 1190-row Kaggle dataset."""
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split

from .config import DATA_PATH, FEATURES, SEED, TARGET, TEST_SIZE


def load_raw(path=DATA_PATH) -> pd.DataFrame:
    return pd.read_csv(path).dropna().reset_index(drop=True)


def audit(df: pd.DataFrame) -> dict:
    """Facts that motivate the cleaning step (duplicates, impossible zeros, leakage)."""
    X, y = df[FEATURES], df[TARGET].astype(int)
    X_tr, X_te, _, _ = train_test_split(X, y, test_size=TEST_SIZE, stratify=y, random_state=SEED)
    train_rows = set(map(tuple, X_tr.to_numpy()))
    seen = int(sum(tuple(r) in train_rows for r in X_te.to_numpy()))
    return {
        "rows": int(len(df)),
        "exact_duplicate_rows": int(df.duplicated().sum()),
        "unique_rows": int(len(df.drop_duplicates())),
        "raw_split_test_rows_with_copy_in_train": f"{seen}/{len(X_te)}",
        "cholesterol_zero_rows": int((df.cholesterol == 0).sum()),
        "resting_bp_zero_rows": int((df.resting_bp_s == 0).sum()),
        "p_disease_if_cholesterol_zero": round(float(df.loc[df.cholesterol == 0, TARGET].mean()), 3),
        "p_disease_if_cholesterol_positive": round(float(df.loc[df.cholesterol > 0, TARGET].mean()), 3),
    }


def clean(df: pd.DataFrame) -> pd.DataFrame:
    """Drop exact duplicates; physiologically impossible zeros become missing (imputed in-pipeline)."""
    df = df.drop_duplicates().reset_index(drop=True).copy()
    df.loc[df.cholesterol == 0, "cholesterol"] = np.nan
    df.loc[df.resting_bp_s == 0, "resting_bp_s"] = np.nan
    return df


def xy(df: pd.DataFrame):
    return df[FEATURES].copy(), df[TARGET].astype(int)


def split(X, y):
    return train_test_split(X, y, test_size=TEST_SIZE, stratify=y, random_state=SEED)


# ---------------------------------------------------------------------------- source sites
# The 1190-row Kaggle file is a row-wise concatenation of five UCI sources. Block boundaries were
# recovered from the row order and verified against the published UCI counts: row totals,
# number of diseased patients (106 / 115 / 149 / 120 / 139), Switzerland's cholesterol recorded as 0
# for every patient, and all 270 Statlog rows being exact copies of Cleveland rows.
SITE_BLOCKS = [  # (site, start, stop, n_disease, n_cholesterol_zero)
    ("Hungary", 0, 294, 106, 0),
    ("Switzerland", 294, 417, 115, 123),
    ("VA Long Beach", 417, 617, 149, 49),
    ("Statlog", 617, 887, 120, 0),
    ("Cleveland", 887, 1190, 139, 0),
]


def recover_sites(raw: pd.DataFrame) -> pd.Series:
    """Site label per raw row; raises if the file does not match the expected signature
    (e.g. the CSV was re-ordered or filtered), because then row order means nothing."""
    if len(raw) != 1190:
        raise ValueError(f"expected the original 1190-row file, got {len(raw)} rows")
    site = pd.Series(index=raw.index, dtype=object)
    for name, a, b, n_dis, n_chol0 in SITE_BLOCKS:
        blk = raw.iloc[a:b]
        if int(blk[TARGET].sum()) != n_dis or int((blk.cholesterol == 0).sum()) != n_chol0:
            raise ValueError(f"site signature mismatch for {name}: row order of merge.csv has changed")
        site.iloc[a:b] = name
    return site


def load_with_sites(path=DATA_PATH) -> pd.DataFrame:
    """Clean data (918 patients) with a 'site' column. Statlog is a re-release of Cleveland
    patients, so it is merged into Cleveland before de-duplication."""
    raw = load_raw(path)
    raw = raw.assign(site=recover_sites(raw).replace({"Statlog": "Cleveland"}))
    df = raw.drop_duplicates(subset=FEATURES + [TARGET]).reset_index(drop=True).copy()
    df.loc[df.cholesterol == 0, "cholesterol"] = np.nan
    df.loc[df.resting_bp_s == 0, "resting_bp_s"] = np.nan
    return df
