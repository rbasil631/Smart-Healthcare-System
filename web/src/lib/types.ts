/** Shapes returned by the FastAPI backend in app/server.py. */

export type Role = "patient" | "doctor" | "admin"

export interface User {
  id: number
  username: string
  full_name: string
  role: Role
  email: string | null
  phone: string | null
  is_active: boolean
  created_at: string
  sex?: number
  date_of_birth?: string
  specialty?: string
  hospital?: string
  registration_no?: string | null
  bio?: string | null
}

export interface Doctor {
  id: number
  username: string
  full_name: string
  specialty: string
  hospital: string
  registration_no: string | null
  bio: string | null
  email: string | null
  phone: string | null
  is_active: boolean
  n_patients: number
  created_at: string
}

/** The doctor list shown on the registration page carries no contact details. */
export type PublicDoctor = Pick<
  Doctor,
  "id" | "full_name" | "specialty" | "hospital"
>

export interface Patient {
  id: number
  username: string
  full_name: string
  email: string | null
  phone: string | null
  is_active: boolean
  created_at: string
  sex: number
  date_of_birth: string
  age: number
  n_assessments: number
  last_probability: number | null
  last_decision: string | null
  last_assessed: string | null
  doctors: { id: number; full_name: string }[]
}

export type PatientDetail = Omit<Patient, "doctors"> & { doctors: Doctor[] }

export interface Inputs {
  age: number
  sex: number
  chest_pain_type: number
  resting_bp_s: number
  cholesterol: number | null
  fasting_blood_sugar: number
  resting_ecg: number
  max_heart_rate: number
  exercise_angina: number
  oldpeak: number
  ST_slope: number
}

export interface Contribution {
  feature: string
  label: string
  display: string
  shap: number
  value: number
}

export interface Explanation {
  base_value: number
  method: string
  additivity_error: number
  contributions: Contribution[]
  estimated_inputs?: Partial<Record<keyof Inputs, number>>
}

export interface Band {
  refer_low: number
  refer_high: number
}

export interface Result {
  probability: number
  prediction: string
  decision: string
  threshold: number
  band: Band
  conformal_set: string[]
  warnings?: string[]
  explanation?: Explanation | null
}

export interface Assessment {
  id: number
  patient_id: number
  patient_name?: string
  created_at: string
  probability: number
  prediction: string
  decision: string
  notes: string | null
  created_by: number
  created_by_name: string
  created_by_role: Role
  inputs: Inputs
  result?: Result
}

export interface ModelInfo {
  model_name: string | null
  trained_on: string | null
  impute: string | null
  threshold: number
  alpha: number
  band: Band
  conformal: {
    coverage?: number
    decisive_rate?: number
    accuracy_on_decisive?: number
  } | null
  external_validation: {
    description: string
    mean_auc: number
    per_site: Record<string, number>
  } | null
  test_metrics: {
    accuracy?: number | null
    auc?: number | null
    auc_95ci?: [number, number] | null
    sensitivity?: number | null
    specificity?: number | null
    precision?: number | null
    f1?: number | null
    brier?: number | null
  }
}

export interface AdminStats {
  patients: number
  active_patients: number
  doctors: number
  assessments: number
  assessments_30d: number
  unassigned_patients: number
  latest_decision_mix: Record<string, number>
  recent: Assessment[]
}
