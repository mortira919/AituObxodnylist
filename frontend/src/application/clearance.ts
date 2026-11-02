// Сценарии поверх порта: перед отправкой на сервер прогоняем правила домена,
// чтобы ошибку в форме пользователь увидел сразу. Остальные вызовы идут к API как есть.
import { validateMark, validatePassword, validatePerson, DomainError, type DeptId, type MarkInput } from '../domain/clearance'
import type { ClearanceApi, StaffInput, StudentInput } from './ports'

export function createClearance(api: ClearanceApi) {
  return {
    ...api,

    setMark(number: string, dept: DeptId, input: MarkInput) {
      return api.setMark(number, dept, validateMark(input))
    },

    changePassword(current: string, next: string, repeat: string) {
      validatePassword(next, repeat)
      return api.changePassword(current, next)
    },

    createStudent(input: StudentInput) {
      validatePerson(input.name, input.login)
      if (input.group.trim().length < 2) throw new DomainError('validation', 'group')
      return api.createStudent({ ...input, name: input.name.trim(), group: input.group.trim() })
    },

    createStaff(input: StaffInput) {
      validatePerson(input.name, input.login)
      if (input.role === 'officer' && !input.departmentId) throw new DomainError('department_required', 'departmentId')
      return api.createStaff({ ...input, name: input.name.trim(), departmentId: input.role === 'officer' ? input.departmentId : undefined })
    },
  }
}

export type Clearance = ReturnType<typeof createClearance>
