# SmartHeart v2.1 — leak-free heart-disease risk prediction

Reproduction and critical re-evaluation of Mridha et al., *SmartHeart: A conceptual framework for
explainable machine learning in cardiovascular risk prediction*, Computers in Biology and Medicine 198 (2025) 111221.
Part of the final-year B.Tech major project "Intelligent Healthcare System for Heart Patients".

> Research / educational prototype. Not a medical device; not validated for clinical diagnosis.

## Project structure

```
smartheart/
├── data/merge.csv                  # 1190-row merged Kaggle dataset (as used by the paper)
├── src/smartheart_ml/              # the package
│   ├── config.py                   # paths, seed, feature schema, valid ranges
│   ├── data.py                     # load, audit (duplicates / zero-shortcut), clean, split
│   ├── features.py                 # leak-free preprocessing pipelines
│   ├── models.py                   # 7 diverse learners, soft vote, stacking, greedy (Caruana) ensemble
│   ├── evaluation.py               # metrics, corrected t-test, bootstrap CI, conformal, decision curves
│   ├── distill.py                  # knowledge distillation -> PyTorch MLP student
│   ├── persistence.py              # save/load .pth bundles
│   └── inference.py                # SmartHeartPredictor (Python API)
├── app/
│   ├── server.py                   # FastAPI server: prediction, SHAP, history (SQLite)
│   └── static/index.html           # the SmartHeart interface
├── scripts/
│   ├── train.py                    # select -> evaluate -> distill -> export .pth
│   ├── ablation.py                 # cholesterol-shortcut sensitivity analysis
│   ├── loso.py                     # leave-one-site-out external validation
│   └── predict.py                  # CLI inference from CSV / JSON
├── models/                         # exported .pth files (created by train.py)
├── outputs/train/                  # audit, CV selection, metrics, plots, model card
├── examples/patients.csv           # 5 example patients for inference
├── legacy/                         # paper reproduction (smartheart.py), first ensemble, v2 audit script
└── docs/                           # put the paper PDF / report here
```

## Setup

```powershell
python -m venv venv; .\venv\Scripts\activate
pip install -r requirements.txt
$env:PYTHONWARNINGS="ignore"     # silences SciPy 'iprint' warnings raised inside parallel workers
```

## Train and export

```powershell
python scripts/train.py                  # auto-select by repeated CV on train split, then export
python scripts/train.py --model soft_vote --refit-all   # fixed model, refit on all clean data before export
python scripts/train.py --fast           # quick check
python scripts/train.py --impute drop    # strictest variant: no cholesterol at all
python scripts/ablation.py               # re-identification probe + median/regress/drop/complete-case
python scripts/loso.py                   # leave-one-site-out validation across the 4 hospitals
```

Pipeline:

1. **Audit + clean**: drop 272 exact duplicates (1190 → 918 patients), treat cholesterol = 0 and BP = 0 as missing,
   then impute inside every pipeline with ridge-regression imputation (`--impute regress`, default).
2. **Model selection**: repeated stratified 5-fold CV on the 80% train split only; best mean AUC wins
   (candidates: `rf`, `catboost`, `logreg`, `soft_vote`, `stacking`, `greedy`), with Nadeau–Bengio corrected
   p-values vs Random Forest.
3. **Threshold + conformal calibration** from training out-of-fold predictions (test set never used).
4. **Single evaluation** on the 20% held-out test set: AUC + bootstrap CI, accuracy, sensitivity,
   specificity, Brier, log-loss, conformal coverage, latency.
5. **Knowledge distillation** of the selected model into a 2-layer MLP (PyTorch).
6. **Export** both models as `.pth`.

## The two .pth files

| File | Contents | Load with | Needs |
|---|---|---|---|
| `models/smartheart_ensemble.pth` | Best model (fitted scikit-learn pipeline), threshold, conformal q, test metrics | `torch.load(path, weights_only=False)` | torch, scikit-learn, xgboost, catboost, this package |
| `models/smartheart_student.pth` | MLP `state_dict` + encoder parameters + threshold, q, metrics | `torch.load(path, weights_only=True)` | torch only (+ this package's `StudentMLP`) |

`.pth` is PyTorch's format; the ensemble is a scikit-learn model, so it is stored *inside* the `.pth` as a
pickled object. Only load ensemble files you created yourself (pickle can execute code). The student is a
true PyTorch model and is the one to use for lightweight / edge deployment.

## Inference

```powershell
python scripts/predict.py --csv examples/patients.csv
python scripts/predict.py --model models/smartheart_student.pth --csv examples/patients.csv --out preds.csv
python scripts/predict.py --info
```

```python
import sys; sys.path.insert(0, "src")
from smartheart_ml.inference import SmartHeartPredictor

clf = SmartHeartPredictor("models/smartheart_ensemble.pth")
clf.predict({"age": 56, "sex": 1, "chest_pain_type": 4, "resting_bp_s": 128, "cholesterol": 223,
             "fasting_blood_sugar": 0, "resting_ecg": 1, "max_heart_rate": 119,
             "exercise_angina": 1, "oldpeak": 2.0, "ST_slope": 3})
```

Output columns: `prob_disease`, `prediction` (at the trained threshold), `conformal_set`, and `decision`:
*Disease likely* / *No disease likely* / *Uncertain – refer to clinician*.

Input codes: sex 1=male 0=female; chest_pain_type 1=typical, 2=atypical, 3=non-anginal, 4=asymptomatic;
resting_ecg 0=normal, 1=ST-T abnormality, 2=LVH; ST_slope 1=up, 2=flat, 3=down; fasting_blood_sugar,
exercise_angina 0/1. Cholesterol 0 is treated as missing.

## Web interface (multi-user)

```powershell
& C:\Users\rbasi\Desktop\BCODERS\gpu-env\Scripts\Activate.ps1   # the training environment
pip install fastapi uvicorn "shap==0.46.0"
python app/server.py --seed-demo      # first run; prints the admin password once
```

Open http://127.0.0.1:8000. The database is `data/smartheart.db` (SQLite); its tables are defined in
`app/schema.sql`: `users`, `patient_profiles`, `doctor_profiles`, `patient_doctors` (many-to-many),
`assessments` (one row per visit, with date, inputs, result and SHAP explanation) and `sessions`.

| Role | How the account is made | What they can do |
|---|---|---|
| Patient | Registers on the sign-in page | Run assessments for themselves, see their history over time (trend chart, change between visits), choose and remove doctors, export their data, delete their own assessments |
| Doctor | Six mock doctors are seeded; the admin can add more | See only patients who chose them or were assigned to them, open their history, record new assessments for them |
| Admin | Created on first run (password printed once) | See every patient, doctor and assessment; add doctors; assign and remove doctors; deactivate or reactivate accounts; reset passwords; export everything |

Demo accounts: doctors `dr.ayesha`, `dr.rohan`, `dr.farhan`, `dr.priya`, `dr.kavita`, `dr.arjun` with password
`Doctor@123`; with `--seed-demo`, patients `demo.imran` and `demo.sana` with password `Patient@123`. Change or
remove these before showing the system to anyone outside the project. Lost the admin password:
`python app/server.py --reset-admin`.

Security: passwords are stored as salted PBKDF2-SHA256 hashes; sessions use random tokens in HttpOnly
cookies; every permission is checked on the server, not only hidden in the interface. This is a local
prototype: run it behind HTTPS before putting it on a network.

## Key findings so far (from `legacy/smartheart_v2.py`)

| | RF accuracy / AUC |
|---|---|
| Paper protocol (raw 1190, duplicates) | 0.929 / 0.965 |
| Deduplicated (918) | 0.869 / 0.928 |
| Dedup + zeros→missing | 0.862 / 0.924 |

- 272 duplicate rows; 84/238 (35%) of the paper-style test rows have an exact copy in train → RF's
  "superiority" was memorisation. On clean data RF, XGB and LogReg are statistically tied.
- A diverse soft-voting ensemble beats RF on clean data: AUC 0.931 vs 0.924 (corrected p = 0.024),
  lower Brier (0.099 vs 0.106) and log-loss (0.332 vs 0.350).
- Conformal prediction (90% target): ~78% of patients get a single confident label with ~94% accuracy;
  ~22% are referred.

## Source sites (recovered)

`merge.csv` is a row-wise concatenation of five UCI files. `data.recover_sites()` recovers each row's
hospital from the row order and refuses to run if the file no longer matches the published signature:

| Rows | Site | n | Disease | Cholesterol = 0 |
|---|---|---|---|---|
| 0–293 | Hungary | 294 | 106 | 0 |
| 294–416 | Switzerland | 123 | 115 | 123 |
| 417–616 | VA Long Beach | 200 | 149 | 49 |
| 617–886 | Statlog (all 270 rows are copies of Cleveland rows) | 270 | 120 | 0 |
| 887–1189 | Cleveland | 303 | 139 | 0 |

After merging Statlog into Cleveland and de-duplicating: Cleveland 303, Hungary 293, Switzerland 123,
VA Long Beach 199 = 918 patients (identical to the 918 used everywhere else).

## Limitations

Retrospective pre-merged dataset; four hospitals only (Switzerland has just 8 non-diseased patients, so its
AUC is very uncertain); conformal guarantee is approximate (cross-conformal on OOF predictions);
the student reuses the teacher's threshold and conformal quantile, so its coverage is reported empirically.

## Changelog

**v2.1 (pipeline review fixes)**
- Median imputation replaced by regression imputation (default). With median imputation, 129 imputed
  training rows shared the exact value 238 mg/dL while only 3 genuine patients did, so tree models could
  re-identify the "missing cholesterol" patients (88% diseased) and the site shortcut survived.
  `scripts/ablation.py` quantifies this with a re-identification probe.
- Distillation targets are cross-fitted (each patient scored by a teacher that never saw it) instead of
  the teacher scoring its own training rows.
- Threshold selection takes the median of the tied accuracy plateau instead of its lowest point.
- Imputation mode stored in both `.pth` bundles; v2.0 student files still load (treated as median mode).
