#!/usr/bin/env python3
"""Add demo patients with assessments at different dates to the SmartHeart database.

    python app/seed_demo_patients.py                  # adds to data/smartheart.db, keeps everything already there
    python app/seed_demo_patients.py --db other.db

Every prediction and SHAP explanation comes from the real model, exactly as if the visit
had been entered in the interface. Patients that already exist (same username) are skipped,
so the script is safe to run more than once. All demo patients use the password Patient@123.
"""
import argparse
import json
import sys
import warnings
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(APP_DIR))

from db import Database, age_on  # noqa: E402

DEMO_PASSWORD = "Patient@123"

# Each visit: days before today, who entered it, note, and the clinical values (age is computed from the
# date of birth at the visit date). chol=None means "not measured".
def V(days, by, note, cp, bp, chol, fbs, ecg, hr, ex, op, slope):
    return {"days": days, "by": by, "notes": note,
            "inputs": dict(chest_pain_type=cp, resting_bp_s=bp, cholesterol=chol, fasting_blood_sugar=fbs,
                           resting_ecg=ecg, max_heart_rate=hr, exercise_angina=ex, oldpeak=op, ST_slope=slope)}


PATIENTS = [
    # username, full name, sex, date of birth, doctors, visits
    ("demo.imran", "Imran Ahmed", 1, "1968-03-14", ["dr.ayesha", "dr.farhan"], [
        V(600, "self", "Breathless climbing stairs", 4, 150, 268, 1, 1, 118, 1, 2.2, 2),
        V(420, "dr.ayesha", "Started statin and beta blocker", 4, 142, 241, 1, 1, 126, 1, 1.6, 2),
        V(240, "dr.ayesha", "Symptoms easing", 3, 136, 220, 1, 0, 134, 0, 1.0, 2),
        V(45, "self", "Walking daily, no chest pain", 3, 132, 205, 0, 0, 140, 0, 0.6, 1),
    ]),
    ("demo.sana", "Sana Fatima", 0, "1979-09-02", ["dr.priya"], [
        V(330, "self", "Routine check", 2, 128, 230, 0, 0, 158, 0, 0.4, 1),
        V(30, "dr.priya", "Annual review, all normal", 2, 124, 214, 0, 0, 162, 0, 0.0, 1),
    ]),
    ("demo.rahul", "Rahul Gupta", 1, "1961-02-11", ["dr.rohan", "dr.ayesha"], [
        V(760, "self", "Annual check-up", 2, 130, 210, 0, 0, 150, 0, 0.2, 1),
        V(520, "dr.rohan", "Occasional chest tightness", 3, 138, 236, 0, 0, 138, 0, 1.0, 2),
        V(260, "dr.rohan", "Pain on exertion, referred to cardiology", 4, 146, 252, 1, 1, 124, 1, 1.8, 2),
        V(20, "dr.ayesha", "Angiography advised", 4, 152, 261, 1, 1, 112, 1, 2.6, 2),
    ]),
    ("demo.fatima", "Fatima Begum", 0, "1958-07-23", ["dr.kavita"], [
        V(820, "dr.kavita", "First visit, heart failure clinic", 4, 160, 290, 1, 2, 108, 1, 3.0, 2),
        V(640, "dr.kavita", "On medication, still breathless", 4, 150, 270, 1, 2, 115, 1, 2.4, 2),
        V(450, "dr.kavita", "Improving, diet changed", 4, 140, 240, 1, 0, 128, 0, 1.4, 2),
        V(250, "self", "Feeling better", 3, 134, 225, 0, 0, 136, 0, 0.8, 1),
        V(60, "dr.kavita", "Stable, continue treatment", 3, 128, 210, 0, 0, 142, 0, 0.4, 1),
    ]),
    ("demo.arjun", "Arjun Singh", 1, "1987-11-02", ["dr.arjun"], [
        V(700, "self", "Pre-employment health check", 2, 118, 190, 0, 0, 178, 0, 0.0, 1),
        V(340, "self", "Yearly check", 2, 120, 196, 0, 0, 174, 0, 0.0, 1),
        V(15, "dr.arjun", "No complaints", 3, 122, 201, 0, 0, 172, 0, 0.0, 1),
    ]),
    ("demo.meera", "Meera Iyer", 0, "1966-04-17", ["dr.priya", "dr.rohan"], [
        V(540, "self", "Palpitations at night", 3, 140, 245, 0, 1, 140, 0, 1.2, 2),
        V(380, "dr.priya", "Lab report pending, cholesterol not done", 4, 144, None, 0, 1, 132, 0, 1.0, 2),
        V(190, "dr.rohan", "Stress test borderline", 4, 138, 238, 0, 1, 136, 1, 1.2, 2),
        V(25, "self", "Mild symptoms continue", 3, 136, 232, 0, 0, 138, 0, 1.0, 2),
    ]),
    ("demo.vikram", "Vikram Rao", 1, "1954-09-30", ["dr.ayesha", "dr.farhan"], [
        V(480, "dr.farhan", "Known coronary disease, ECG changes", 4, 158, 275, 1, 2, 104, 1, 2.8, 3),
        V(280, "dr.ayesha", "Post-angioplasty review", 4, 150, 250, 1, 1, 112, 1, 2.2, 2),
        V(40, "dr.ayesha", "Persistent exertional angina", 4, 154, 262, 1, 1, 108, 1, 2.5, 2),
    ]),
    ("demo.nadia", "Nadia Hussain", 0, "1980-01-25", [], [
        V(10, "self", "Wanted a baseline check", 2, 122, 198, 0, 0, 165, 0, 0.0, 1),
    ]),
    ("demo.suresh", "Suresh Patel", 1, "1970-06-08", ["dr.ayesha"], [
        V(900, "self", "Smoker, routine check", 3, 134, 228, 0, 0, 150, 0, 0.6, 1),
        V(720, "self", "Chest discomfort after meals", 3, 140, 246, 1, 0, 142, 0, 1.0, 2),
        V(540, "dr.ayesha", "Positive stress test", 4, 148, 268, 1, 1, 126, 1, 2.0, 2),
        V(380, "dr.ayesha", "Bypass surgery completed", 4, 140, 240, 1, 1, 130, 1, 1.6, 2),
        V(200, "dr.ayesha", "Cardiac rehab, stopped smoking", 3, 130, 210, 0, 0, 144, 0, 0.8, 1),
        V(35, "self", "Doing well", 2, 126, 198, 0, 0, 152, 0, 0.4, 1),
    ]),
    ("demo.ananya", "Ananya Das", 0, "1992-03-14", ["dr.priya"], [
        V(400, "self", "Family history of heart disease", 2, 116, 182, 0, 0, 182, 0, 0.0, 1),
        V(50, "self", "Follow-up", 2, 114, 176, 0, 0, 184, 0, 0.0, 1),
    ]),
    ("demo.karim", "Abdul Karim", 1, "1963-12-05", ["dr.farhan"], [
        V(500, "dr.farhan", "Cholesterol test not available", 4, 145, None, 0, 1, 120, 1, 1.5, 2),
        V(300, "dr.farhan", "Cholesterol still not measured", 4, 140, None, 0, 1, 126, 1, 1.2, 2),
        V(70, "self", "Lab closed, values from home monitor", 3, 136, None, 0, 0, 132, 0, 0.8, 2),
    ]),
    ("demo.lakshmi", "Lakshmi Menon", 0, "1975-08-19", ["dr.kavita", "dr.rohan"], [
        V(90, "self", "New breathlessness and ankle swelling", 4, 156, 282, 1, 2, 110, 1, 2.6, 2),
        V(5, "dr.kavita", "Echo booked, urgent review", 4, 160, 295, 1, 2, 104, 1, 3.0, 3),
    ]),
]


def build_assess(predictor, explainer):
    from smartheart_ml.config import LABELS
    from smartheart_ml.evaluation import conformal_sets, decision
    q = predictor.q
    band = {"refer_low": round(1 - q, 4), "refer_high": round(q, 4)}

    def assess(record):
        rec = dict(record)
        for k in ["cholesterol", "resting_bp_s"]:
            if rec.get(k) is None:
                rec[k] = 0
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            X = predictor.prepare(rec)
            prob = float(predictor.proba_prepared(X)[0])
        sets = conformal_sets([prob], q)[0]
        return {"probability": prob, "prediction": LABELS[int(prob >= predictor.threshold)],
                "threshold": predictor.threshold, "conformal_set": [LABELS[c] for c in (0, 1) if sets[c]],
                "decision": decision(sets), "band": band, "warnings": [str(w.message) for w in caught],
                "explanation": explainer.explain(X)}
    return assess


def seed(db: Database, predictor, explainer, model_name, password=DEMO_PASSWORD):
    admin_pw = db.seed()
    assess = build_assess(predictor, explainer)
    uid = lambda username: db.one("SELECT id FROM users WHERE username = ?", (username,))["id"]
    added = []
    for username, name, sex, dob, doctors, visits in PATIENTS:
        if db.one("SELECT 1 FROM users WHERE username = ?", (username,)):
            print(f"  skip {username} (already exists)")
            continue
        reg_date = (datetime.now() - timedelta(days=max(v["days"] for v in visits) + 2)).replace(hour=9, minute=15, second=0)
        pid = db.create_patient(username, password, name, sex, dob)
        db.run("UPDATE users SET created_at = ? WHERE id = ?", (reg_date.isoformat(timespec="seconds"), pid))
        for d in doctors:
            db.assign(pid, uid(d), pid)
        for i, v in enumerate(sorted(visits, key=lambda v: -v["days"])):
            when = (datetime.now() - timedelta(days=v["days"])).replace(hour=9 + (i * 2) % 8, minute=(i * 17) % 60, second=0)
            inputs = {"age": age_on(dob, when.date()), "sex": sex, **v["inputs"]}
            result = assess(inputs)
            by = pid if v["by"] == "self" else uid(v["by"])
            db.run("INSERT INTO assessments (patient_id, created_by, created_at, probability, prediction, decision,"
                   " model_name, notes, inputs, result) VALUES (?,?,?,?,?,?,?,?,?,?)",
                   (pid, by, when.isoformat(timespec="seconds"), result["probability"], result["prediction"],
                    result["decision"], model_name, v["notes"], json.dumps(inputs), json.dumps(result)))
        traj = " -> ".join(f"{r['probability'] * 100:.0f}%" for r in db.q(
            "SELECT probability FROM assessments WHERE patient_id = ? ORDER BY created_at", (pid,)))
        print(f"  added {username:14s} {name:16s} {len(visits)} visits: {traj}")
        added.append(username)
    return admin_pw, added


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(ROOT / "data" / "smartheart.db"))
    ap.add_argument("--model", default=str(ROOT / "models" / "smartheart_ensemble.pth"))
    a = ap.parse_args()
    from smartheart_ml.explain import ShapExplainer
    from smartheart_ml.inference import SmartHeartPredictor
    print("Loading model ...", flush=True)
    predictor = SmartHeartPredictor(a.model)
    explainer = ShapExplainer(predictor.proba_prepared)
    admin_pw, added = seed(Database(a.db), predictor, explainer, predictor.info().get("model_name"))
    if admin_pw:
        print(f"\nNew database: admin password is {admin_pw}")
    print(f"\nDone: {len(added)} demo patients added to {a.db}. Password for all of them: {DEMO_PASSWORD}")


if __name__ == "__main__":
    main()
