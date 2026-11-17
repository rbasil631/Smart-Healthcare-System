-- SmartHeart database schema (SQLite). Created automatically by app/server.py on first run.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,                 -- pbkdf2_sha256$iterations$salt$hash
    role          TEXT    NOT NULL CHECK (role IN ('admin', 'doctor', 'patient')),
    full_name     TEXT    NOT NULL,
    email         TEXT,
    phone         TEXT,
    is_active     INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT    NOT NULL,
    last_login    TEXT
);

CREATE TABLE IF NOT EXISTS patient_profiles (
    user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    sex           INTEGER NOT NULL CHECK (sex IN (0, 1)),   -- 1 = male, 0 = female
    date_of_birth TEXT    NOT NULL                          -- YYYY-MM-DD
);

CREATE TABLE IF NOT EXISTS doctor_profiles (
    user_id         INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    specialty       TEXT NOT NULL,
    hospital        TEXT NOT NULL,
    registration_no TEXT,
    bio             TEXT
);

-- Many-to-many: a patient can have several doctors, a doctor many patients.
CREATE TABLE IF NOT EXISTS patient_doctors (
    patient_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    doctor_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_at TEXT    NOT NULL,
    assigned_by INTEGER REFERENCES users(id),
    PRIMARY KEY (patient_id, doctor_id)
);

-- One row per assessment = one time step in the patient's history.
CREATE TABLE IF NOT EXISTS assessments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_by  INTEGER NOT NULL REFERENCES users(id),
    created_at  TEXT    NOT NULL,
    probability REAL    NOT NULL,
    prediction  TEXT    NOT NULL,
    decision    TEXT    NOT NULL,
    model_name  TEXT,
    notes       TEXT,
    inputs      TEXT    NOT NULL,   -- JSON: the 11 clinical inputs
    result      TEXT    NOT NULL    -- JSON: probability, prediction set, SHAP explanation
);

CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assessments_patient ON assessments(patient_id, created_at);
CREATE INDEX IF NOT EXISTS idx_patient_doctors_doctor ON patient_doctors(doctor_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
