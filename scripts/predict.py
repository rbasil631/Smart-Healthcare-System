#!/usr/bin/env python3
"""Run inference with a saved .pth bundle.

    python scripts/predict.py --csv examples/patients.csv
    python scripts/predict.py --model models/smartheart_student.pth --csv examples/patients.csv --out preds.csv
    python scripts/predict.py --json "{\"age\":56,\"sex\":1,\"chest_pain_type\":4,\"resting_bp_s\":128,\"cholesterol\":223,\"fasting_blood_sugar\":0,\"resting_ecg\":1,\"max_heart_rate\":119,\"exercise_angina\":1,\"oldpeak\":2.0,\"ST_slope\":3}"
    python scripts/predict.py --info
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import pandas as pd

from smartheart_ml.inference import SmartHeartPredictor


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=str(ROOT / "models" / "smartheart_ensemble.pth"))
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--csv", help="CSV with the 11 feature columns (extra columns are kept in the output)")
    src.add_argument("--json", help="one patient as a JSON object")
    src.add_argument("--info", action="store_true", help="print model metadata")
    ap.add_argument("--out", help="save predictions to CSV")
    a = ap.parse_args()

    clf = SmartHeartPredictor(a.model)
    if a.info:
        print(json.dumps(clf.info(), indent=2, default=str))
        return
    data = pd.read_csv(a.csv) if a.csv else pd.DataFrame([json.loads(a.json)])
    res = pd.concat([data.reset_index(drop=True), clf.predict(data)], axis=1)
    pd.set_option("display.width", 200)
    print(res.to_string(index=False))
    if a.out:
        res.to_csv(a.out, index=False)
        print(f"\nSaved {a.out}")


if __name__ == "__main__":
    main()
