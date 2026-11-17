"""Central configuration: paths, seed, feature schema."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_PATH = ROOT / "data" / "merge.csv"
MODELS_DIR = ROOT / "models"
OUTPUTS_DIR = ROOT / "outputs"

SEED = 42
TEST_SIZE = 0.20
TARGET = "target"

FEATURES = ["age", "sex", "chest_pain_type", "resting_bp_s", "cholesterol",
            "fasting_blood_sugar", "resting_ecg", "max_heart_rate",
            "exercise_angina", "oldpeak", "ST_slope"]
NUM = ["age", "resting_bp_s", "cholesterol", "max_heart_rate", "oldpeak"]
NOMINAL = ["chest_pain_type", "resting_ecg", "ST_slope"]
BINARY = ["sex", "fasting_blood_sugar", "exercise_angina"]

# Fixed category levels (used by the PyTorch student's encoder so the .pth is self-contained)
CATEGORY_LEVELS = {
    "chest_pain_type": [1, 2, 3, 4],
    "resting_ecg": [0, 1, 2],
    "ST_slope": [0, 1, 2, 3],
}
BINARY_LEVELS = [0, 1]

# Plausibility ranges for input validation at inference (warnings only)
VALID_RANGES = {
    "age": (18, 100),
    "resting_bp_s": (60, 250),
    "cholesterol": (80, 700),
    "max_heart_rate": (50, 230),
    "oldpeak": (-3.0, 7.0),
}

LABELS = {0: "No disease", 1: "Disease"}
