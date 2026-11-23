import type {
  AdminStats,
  Assessment,
  Doctor,
  Inputs,
  ModelInfo,
  Patient,
  PatientDetail,
  PublicDoctor,
  User,
} from "@/lib/types"

/** Raised for every non-2xx response, carrying the server's `detail` message. */
export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

type Listener = () => void
const sessionLost = new Set<Listener>()

/** The shell subscribes, so an expired cookie drops the app back to sign-in. */
export function onSessionLost(fn: Listener) {
  sessionLost.add(fn)
  return () => {
    sessionLost.delete(fn)
  }
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...opts,
  })

  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    sessionLost.forEach((fn) => fn())
    throw new ApiError("Your session has ended. Please sign in again.", 401)
  }

  if (!res.ok) {
    let detail: string = res.statusText
    try {
      const body = await res.json()
      detail =
        typeof body.detail === "string"
          ? body.detail
          : (body.detail ?? [])
              .map(
                (d: { loc?: string[]; msg: string }) =>
                  `${d.loc?.slice(-1)[0]}: ${d.msg}`
              )
              .join("; ")
    } catch {
      // the body was not JSON; the status text stands
    }
    throw new ApiError(detail || `Request failed (${res.status})`, res.status)
  }

  return res.json() as Promise<T>
}

const send = <T>(path: string, body?: unknown, method = "POST") =>
  request<T>(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

export interface RegisterBody {
  full_name: string
  username: string
  password: string
  date_of_birth: string
  sex: number
  email: string | null
  phone: string | null
  doctor_ids: number[]
}

export interface NewDoctorBody {
  full_name: string
  specialty: string
  hospital: string
  username: string
  password: string
  registration_no: string | null
  email: string | null
  phone: string | null
}

export type DetailsBody = Partial<{
  full_name: string
  email: string | null
  phone: string | null
  date_of_birth: string
  sex: number
  specialty: string
  hospital: string
  registration_no: string | null
  bio: string | null
}>

export type AssessmentBody = Omit<Inputs, "cholesterol"> & {
  cholesterol: number | null
  notes: string | null
}

export const api = {
  me: () => request<User>("/api/auth/me"),
  login: (username: string, password: string) =>
    send<User>("/api/auth/login", { username, password }),
  logout: () => send<unknown>("/api/auth/logout"),
  register: (body: RegisterBody) => send<User>("/api/auth/register", body),
  changePassword: (current_password: string, new_password: string) =>
    send<unknown>("/api/auth/password", { current_password, new_password }),

  model: () => request<ModelInfo>("/api/model"),

  publicDoctors: () => request<PublicDoctor[]>("/api/public/doctors"),
  doctors: () => request<Doctor[]>("/api/doctors"),
  myDoctors: () => request<Doctor[]>("/api/me/doctors"),
  addMyDoctor: (id: number) => send<Doctor[]>(`/api/me/doctors/${id}`),
  removeMyDoctor: (id: number) =>
    request<Doctor[]>(`/api/me/doctors/${id}`, { method: "DELETE" }),

  patients: () => request<Patient[]>("/api/patients"),
  patient: (pid: number) => request<PatientDetail>(`/api/patients/${pid}`),
  patientAssessments: (pid: number) =>
    request<Assessment[]>(`/api/patients/${pid}/assessments`),
  assess: (pid: number, body: AssessmentBody) =>
    send<Assessment>(`/api/patients/${pid}/assessments`, body),

  assessment: (aid: number) => request<Assessment>(`/api/assessments/${aid}`),
  deleteAssessment: (aid: number) =>
    request<unknown>(`/api/assessments/${aid}`, { method: "DELETE" }),

  updateDetails: (uid: number, body: DetailsBody) =>
    send<User>(`/api/users/${uid}`, body, "PATCH"),

  stats: () => request<AdminStats>("/api/admin/stats"),
  allAssessments: () => request<Assessment[]>("/api/admin/assessments"),
  createDoctor: (body: NewDoctorBody) =>
    send<Doctor>("/api/admin/doctors", body),
  setActive: (uid: number, is_active: boolean) =>
    send<User>(`/api/admin/users/${uid}`, { is_active }, "PATCH"),
  resetPassword: (uid: number, new_password: string) =>
    send<unknown>(`/api/admin/users/${uid}/password`, { new_password }),
  assign: (patient_id: number, doctor_id: number) =>
    send<unknown>("/api/admin/assignments", { patient_id, doctor_id }),
  unassign: (patient_id: number, doctor_id: number) =>
    request<unknown>(
      `/api/admin/assignments?patient_id=${patient_id}&doctor_id=${doctor_id}`,
      { method: "DELETE" }
    ),
}
