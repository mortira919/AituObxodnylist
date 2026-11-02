// Порт: всё, что интерфейс может попросить у сервера. Реализация лежит в infrastructure/httpApi.ts,
// контракт описан в docs/backend/openapi.yaml. Слой не знает ни про fetch, ни про React.
import type { AuditEntry, DeptId, MarkInput, MarkState, Sheet, SheetStatus, SheetType, Student, Templates, User, Verification } from '../domain/clearance'

export interface Page<T> {
  items: T[]
  total: number
}

export interface SheetQuery {
  status?: SheetStatus
  type?: SheetType
  q?: string
  department?: DeptId
  markState?: MarkState
  page?: number
  pageSize?: number
}

export interface StudentInput {
  name: string
  group: string
  login: string
}

export interface StaffInput {
  name: string
  login: string
  role: 'officer' | 'admin'
  departmentId?: DeptId
}

export interface ClearanceApi {
  // вход и аккаунт
  login(login: string, password: string): Promise<User>
  logout(): Promise<void>
  me(): Promise<User | null>
  changePassword(current: string, next: string): Promise<void>

  // листы
  listSheets(query: SheetQuery): Promise<Page<Sheet>>
  mySheets(): Promise<Sheet[]>
  summary(): Promise<{ active: number; withDebt: number; closed: number }>
  getSheet(number: string): Promise<Sheet & { audit: AuditEntry[] }>
  createSheet(studentId: string, type: SheetType): Promise<Sheet>
  setMark(number: string, dept: DeptId, input: MarkInput): Promise<Sheet>

  // очередь отдела
  queueCounts(): Promise<Record<MarkState, number>>
  bulkClear(numbers: string[]): Promise<{ updated: string[]; failed: { number: string; code: string }[] }>

  // справочники
  listStudents(query: { q?: string; page?: number; pageSize?: number }): Promise<Page<Student>>
  createStudent(input: StudentInput): Promise<{ student: Student; temporaryPassword: string }>
  updateStudent(id: string, patch: Partial<Pick<Student, 'name' | 'group'>>): Promise<Student>
  importStudents(file: File): Promise<{ created: { student: Student; temporaryPassword: string }[]; skipped: { line: number; code: string }[] }>
  listStaff(query: { page?: number; pageSize?: number }): Promise<Page<User>>
  createStaff(input: StaffInput): Promise<{ user: User; temporaryPassword: string }>
  updateStaff(id: string, patch: { name?: string; departmentId?: DeptId; active?: boolean }): Promise<User>
  resetPassword(userId: string): Promise<{ temporaryPassword: string }>

  // настройки и журнал
  getTemplates(): Promise<Templates>
  setTemplate(type: SheetType, departments: DeptId[]): Promise<Templates>
  listAudit(query: { sheet?: string; page?: number; pageSize?: number }): Promise<Page<AuditEntry>>

  // Telegram и публичная проверка
  telegramLink(): Promise<{ code: string; botUrl: string; expiresAt: string }>
  telegramUnlink(): Promise<void>
  verify(number: string): Promise<Verification>
}
