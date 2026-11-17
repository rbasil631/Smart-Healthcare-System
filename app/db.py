"""Database access, password hashing and seeding for the SmartHeart server."""
import hashlib
import hmac
import secrets
import sqlite3
import threading
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

APP_DIR = Path(__file__).resolve().parent
SCHEMA = APP_DIR / "schema.sql"
_lock = threading.RLock()
PBKDF2_ITERATIONS = 240_000

MOCK_DOCTORS = [  # fictional doctors for demonstration
    ("dr.ayesha", "Dr. Ayesha Siddiqui", "Interventional Cardiology", "Crescent Heart Institute, Aligarh",
     "Coronary angiography and stenting; 14 years in practice."),
    ("dr.rohan", "Dr. Rohan Mehta", "Clinical Cardiology", "Lakeview Hospital, New Delhi",
     "Chest pain evaluation, stress testing and hypertension."),
    ("dr.farhan", "Dr. Farhan Qureshi", "Electrophysiology", "Crescent Heart Institute, Aligarh",
     "Arrhythmia management and ECG interpretation."),
    ("dr.priya", "Dr. Priya Nair", "Preventive Cardiology", "Sunrise Multispeciality Hospital, Noida",
     "Cholesterol, diabetes and lifestyle risk reduction."),
    ("dr.kavita", "Dr. Kavita Sharma", "Heart Failure Clinic", "Lakeview Hospital, New Delhi",
     "Long-term follow-up of heart failure patients."),
    ("dr.arjun", "Dr. Arjun Verma", "General Medicine", "City Care Clinic, Moradabad",
     "First-contact care and referral to cardiology."),
]
DEMO_DOCTOR_PASSWORD = "Doctor@123"


def now():
    return datetime.now().isoformat(timespec="seconds")


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), PBKDF2_ITERATIONS).hex()
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters, salt, digest = stored.split("$")
        calc = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), int(iters)).hex()
        return algo == "pbkdf2_sha256" and hmac.compare_digest(calc, digest)
    except Exception:
        return False


def age_on(dob: str, on: Optional[date] = None) -> int:
    b = date.fromisoformat(dob)
    on = on or date.today()
    return on.year - b.year - ((on.month, on.day) < (b.month, b.day))


class Database:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.con = sqlite3.connect(self.path, check_same_thread=False)
        self.con.row_factory = sqlite3.Row
        self.con.execute("PRAGMA foreign_keys = ON")
        with _lock:
            self.con.executescript(SCHEMA.read_text(encoding="utf-8"))
            self.con.commit()

    def q(self, sql, args=()):
        with _lock:
            return self.con.execute(sql, args).fetchall()

    def one(self, sql, args=()):
        with _lock:
            return self.con.execute(sql, args).fetchone()

    def run(self, sql, args=()):
        with _lock:
            cur = self.con.execute(sql, args)
            self.con.commit()
            return cur

    # -------------------------------------------------------------- users
    def create_user(self, username, password, role, full_name, email=None, phone=None):
        cur = self.run("INSERT INTO users (username, password_hash, role, full_name, email, phone, created_at)"
                       " VALUES (?,?,?,?,?,?,?)",
                       (username.strip(), hash_password(password), role, full_name.strip(), email, phone, now()))
        return cur.lastrowid

    def create_doctor(self, username, password, full_name, specialty, hospital, email=None, phone=None,
                      registration_no=None, bio=None):
        uid = self.create_user(username, password, "doctor", full_name, email, phone)
        self.run("INSERT INTO doctor_profiles (user_id, specialty, hospital, registration_no, bio) VALUES (?,?,?,?,?)",
                 (uid, specialty, hospital, registration_no or f"DEMO-{uid:04d}", bio))
        return uid

    def create_patient(self, username, password, full_name, sex, date_of_birth, email=None, phone=None):
        uid = self.create_user(username, password, "patient", full_name, email, phone)
        self.run("INSERT INTO patient_profiles (user_id, sex, date_of_birth) VALUES (?,?,?)", (uid, sex, date_of_birth))
        return uid

    def seed(self):
        """Create the admin (first run only) and the mock doctors. Returns the admin password if newly created."""
        admin_password = None
        if not self.one("SELECT 1 FROM users WHERE role = 'admin'"):
            admin_password = secrets.token_urlsafe(9)
            self.create_user("admin", admin_password, "admin", "System Administrator")
        for username, name, spec, hosp, bio in MOCK_DOCTORS:
            if not self.one("SELECT 1 FROM users WHERE username = ?", (username,)):
                self.create_doctor(username, DEMO_DOCTOR_PASSWORD, name, spec, hosp,
                                   email=f"{username.replace('.', '_')}@smartheart.example", bio=bio)
        return admin_password

    def reset_admin(self):
        pw = secrets.token_urlsafe(9)
        row = self.one("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")
        if row:
            self.run("UPDATE users SET password_hash = ?, is_active = 1 WHERE id = ?", (hash_password(pw), row["id"]))
            self.run("DELETE FROM sessions WHERE user_id = ?", (row["id"],))
        else:
            self.create_user("admin", pw, "admin", "System Administrator")
        return pw

    # -------------------------------------------------------------- sessions
    def new_session(self, user_id, days=7):
        token = secrets.token_urlsafe(32)
        self.run("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)",
                 (token, user_id, now(), (datetime.now() + timedelta(days=days)).isoformat(timespec="seconds")))
        self.run("UPDATE users SET last_login = ? WHERE id = ?", (now(), user_id))
        return token

    def session_user(self, token):
        if not token:
            return None
        return self.one("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id"
                        " WHERE s.token = ? AND s.expires_at > ? AND u.is_active = 1", (token, now()))

    def end_session(self, token):
        self.run("DELETE FROM sessions WHERE token = ?", (token,))

    # -------------------------------------------------------------- relationships
    def is_assigned(self, patient_id, doctor_id):
        return self.one("SELECT 1 FROM patient_doctors WHERE patient_id = ? AND doctor_id = ?",
                        (patient_id, doctor_id)) is not None

    def assign(self, patient_id, doctor_id, by):
        self.run("INSERT OR IGNORE INTO patient_doctors (patient_id, doctor_id, assigned_at, assigned_by)"
                 " VALUES (?,?,?,?)", (patient_id, doctor_id, now(), by))

    def unassign(self, patient_id, doctor_id):
        self.run("DELETE FROM patient_doctors WHERE patient_id = ? AND doctor_id = ?", (patient_id, doctor_id))
