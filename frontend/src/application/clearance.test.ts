// Сценарии: неверные данные останавливаются до сети, верные уходят в API очищенными.
import { expect, test, vi } from 'vitest'
import { createClearance } from './clearance'
import type { ClearanceApi } from './ports'

const fakeApi = () => ({ setMark: vi.fn().mockResolvedValue({}), createStaff: vi.fn().mockResolvedValue({}), changePassword: vi.fn().mockResolvedValue(undefined) }) as unknown as ClearanceApi

test('долг без описания не уходит на сервер', () => {
  const api = fakeApi()
  expect(() => createClearance(api).setMark('2026-0142', 'library', { state: 'debt', note: '' })).toThrow()
  expect(api.setMark).not.toHaveBeenCalled()
})

test('сотрудник отдела без отдела не создаётся, у администратора отдел не отправляется', async () => {
  const api = fakeApi()
  const c = createClearance(api)
  expect(() => c.createStaff({ name: 'Г. Нуртазина', login: 'g.nurtazina', role: 'officer' })).toThrow()
  await c.createStaff({ name: '  Ж. Абдрахманова ', login: 'zh.abdrakhmanova', role: 'admin', departmentId: 'library' })
  expect(api.createStaff).toHaveBeenCalledWith({ name: 'Ж. Абдрахманова', login: 'zh.abdrakhmanova', role: 'admin', departmentId: undefined })
})

test('смена пароля проверяет повтор до запроса', () => {
  const api = fakeApi()
  expect(() => createClearance(api).changePassword('old-password', 'new-password', 'другой')).toThrow()
  expect(api.changePassword).not.toHaveBeenCalled()
})
