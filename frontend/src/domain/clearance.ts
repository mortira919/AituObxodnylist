// Домен: сущности обходного листа и правила, которые проверяются ещё до отправки на сервер.
// Окончательно все правила проверяет бэкенд (docs/backend/README.md), здесь они нужны,
// чтобы форма сразу объяснила ошибку, а не ждала ответа сервера.

export type DeptId = 'library' | 'accounting' | 'dorm' | 'military' | 'it' | 'academic'
export type SheetType = 'graduation' | 'expulsion' | 'transfer' | 'leave' | 'dorm'
export type MarkState = 'pending' | 'clear' | 'debt'
export type SheetStatus = 'created' | 'progress' | 'debt' | 'closed'
export type Role = 'student' | 'officer' | 'admin'

export const DEPTS: DeptId[] = ['library', 'accounting', 'dorm', 'military', 'it', 'academic']
export const SHEET_TYPES: SheetType[] = ['graduation', 'expulsion', 'transfer', 'leave', 'dorm']
export const NOTE_MAX = 200
export const PASSWORD_MIN = 8
export const NUMBER_RE = /^\d{4}-\d{4}$/
export const LOGIN_RE = /^[a-z0-9._-]{3,64}$/

export interface User {
  id: string
  name: string
  login: string
  role: Role
  departmentId?: DeptId
  studentId?: string
  group?: string
  active: boolean
  telegramLinked: boolean
  mustChangePassword?: boolean
}

export interface Student {
  id: string
  userId?: string
  name: string
  group: string
  login: string
  activeSheets?: number
}

export interface Mark {
  department: DeptId
  state: MarkState
  note?: string
  due?: string // ISO-дата, до которой нужно закрыть долг
  at?: string
  by?: string
}

export interface Sheet {
  number: string
  type: SheetType
  status: SheetStatus
  createdAt: string
  closedAt?: string | null
  student: { id: string; name: string; group: string }
  marks: Mark[]
}

export interface AuditEntry {
  at: string
  actor: string
  sheet: string
  department?: DeptId
  action: 'create' | 'clear' | 'debt' | 'close'
  note?: string
}

export type Templates = Record<SheetType, DeptId[]>

export interface MarkInput {
  state: 'clear' | 'debt'
  note?: string
  due?: string
}

export interface Verification {
  found: boolean
  closed: boolean
  shortName?: string
  number?: string
  type?: SheetType
  closedAt?: string
  departments?: DeptId[]
}

// Коды ошибок общие для фронта и бэкенда (docs/backend/openapi.yaml, ErrorCode).
export type ErrorCode =
  | 'validation'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'login_failed'
  | 'rate_limited'
  | 'duplicate'
  | 'closed'
  | 'foreign_dept'
  | 'note_required'
  | 'note_too_long'
  | 'due_past'
  | 'no_depts'
  | 'login_taken'
  | 'weak_password'
  | 'wrong_password'
  | 'department_required'
  | 'bad_file'
  | 'server'
  | 'network'

export class DomainError extends Error {
  code: ErrorCode
  field?: string
  constructor(code: ErrorCode, field?: string) {
    super(code)
    this.code = code
    this.field = field
  }
}

const today = (now: Date) => now.toISOString().slice(0, 10)

// Долг должен объяснять студенту, что вернуть или оплатить, и не иметь срока в прошлом.
export function validateMark(input: MarkInput, now: Date = new Date()): MarkInput {
  if (input.state === 'clear') return { state: 'clear' }
  const note = input.note?.trim() ?? ''
  if (!note) throw new DomainError('note_required', 'note')
  if (note.length > NOTE_MAX) throw new DomainError('note_too_long', 'note')
  if (input.due && input.due < today(now)) throw new DomainError('due_past', 'due')
  return { state: 'debt', note, due: input.due || undefined }
}

export function validatePassword(next: string, repeat: string) {
  if (next.length < PASSWORD_MIN) throw new DomainError('weak_password', 'next')
  if (next !== repeat) throw new DomainError('validation', 'repeat')
}

export function validatePerson(name: string, login: string) {
  if (name.trim().length < 3) throw new DomainError('validation', 'name')
  if (!LOGIN_RE.test(login)) throw new DomainError('validation', 'login')
}

// Где начинается рабочее место пользователя после входа.
export function homeOf(role: Role): string {
  return role === 'student' ? '/student' : role === 'officer' ? '/office' : '/admin'
}

export const markOf = (sheet: Sheet, dept: DeptId) => sheet.marks.find((m) => m.department === dept)
