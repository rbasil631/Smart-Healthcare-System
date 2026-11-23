import type { Inputs, Role } from "@/lib/types"

/** The two worked examples offered on the intake form. */
export const EXAMPLES: Record<"low" | "high", Inputs> = {
  low: {
    age: 39,
    sex: 0,
    chest_pain_type: 2,
    resting_bp_s: 120,
    cholesterol: 204,
    fasting_blood_sugar: 0,
    resting_ecg: 0,
    max_heart_rate: 170,
    exercise_angina: 0,
    oldpeak: 0.0,
    ST_slope: 1,
  },
  high: {
    age: 56,
    sex: 1,
    chest_pain_type: 4,
    resting_bp_s: 128,
    cholesterol: 223,
    fasting_blood_sugar: 0,
    resting_ecg: 1,
    max_heart_rate: 119,
    exercise_angina: 1,
    oldpeak: 2.0,
    ST_slope: 3,
  },
}

export const NUMERIC = [
  "age",
  "resting_bp_s",
  "cholesterol",
  "max_heart_rate",
  "oldpeak",
] as const

export const RADIOS = [
  "sex",
  "chest_pain_type",
  "fasting_blood_sugar",
  "resting_ecg",
  "exercise_angina",
  "ST_slope",
] as const

export type NumericKey = (typeof NUMERIC)[number]
export type RadioKey = (typeof RADIOS)[number]

/** Server-side valid ranges, mirrored so a bad value is explained before posting. */
export const LIMITS: Record<NumericKey, [number, number]> = {
  age: [18, 100],
  resting_bp_s: [60, 250],
  cholesterol: [80, 700],
  max_heart_rate: [50, 230],
  oldpeak: [-3, 7],
}

/** Label and unit for every numeric field, in the order the form shows them. */
export const UNITS: Record<NumericKey, string> = {
  age: "years",
  resting_bp_s: "mmHg",
  cholesterol: "mg/dl",
  max_heart_rate: "bpm",
  oldpeak: "mm",
}

export const CHOICES: Record<RadioKey, { value: number; label: string }[]> = {
  sex: [
    { value: 1, label: "Male" },
    { value: 0, label: "Female" },
  ],
  chest_pain_type: [
    { value: 1, label: "Typical angina" },
    { value: 2, label: "Atypical angina" },
    { value: 3, label: "Non-anginal pain" },
    { value: 4, label: "No pain (asymptomatic)" },
  ],
  fasting_blood_sugar: [
    { value: 0, label: "No" },
    { value: 1, label: "Yes" },
  ],
  resting_ecg: [
    { value: 0, label: "Normal" },
    { value: 1, label: "ST-T abnormality" },
    { value: 2, label: "LV hypertrophy" },
  ],
  exercise_angina: [
    { value: 0, label: "No" },
    { value: 1, label: "Yes" },
  ],
  ST_slope: [
    { value: 1, label: "Up" },
    { value: 2, label: "Flat" },
    { value: 3, label: "Down" },
  ],
}

export const NAV: Record<Role, [string, string][]> = {
  patient: [
    ["assess", "New assessment"],
    ["history", "My history"],
    ["doctors", "My doctors"],
    ["model", "Model"],
  ],
  doctor: [
    ["patients", "My patients"],
    ["model", "Model"],
  ],
  admin: [
    ["overview", "Overview"],
    ["patients", "Patients"],
    ["doctors", "Doctors"],
    ["assessments", "Assessments"],
    ["model", "Model"],
  ],
}

export const HOME: Record<Role, string> = {
  patient: "history",
  doctor: "patients",
  admin: "overview",
}

export const ALLOWED: Record<Role, string[]> = {
  patient: ["assess", "history", "doctors", "model", "assessment"],
  doctor: ["patients", "patient", "assess", "assessment", "model"],
  admin: [
    "overview",
    "patients",
    "patient",
    "doctors",
    "assessments",
    "assess",
    "assessment",
    "model",
  ],
}

/** The tab a detail page belongs under, so the header keeps a current tab. */
export const PARENT_TAB: Record<string, (role: Role) => string> = {
  patient: () => "patients",
  assessment: (role) => (role === "patient" ? "history" : "patients"),
  assess: (role) => (role === "patient" ? "assess" : "patients"),
}

export const USERNAME_RE = /^[A-Za-z0-9._-]{3,40}$/
