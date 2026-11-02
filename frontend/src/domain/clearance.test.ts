// Правила, которые фронт проверяет до отправки. Запуск: npm test
import { describe, expect, test } from 'vitest'
import { DomainError, homeOf, validateMark, validatePassword, validatePerson } from './clearance'

const code = (fn: () => unknown) => {
  try {
    fn()
    return 'ok'
  } catch (e) {
    return (e as DomainError).code
  }
}

describe('отметка отдела', () => {
  const now = new Date('2026-10-29T10:00:00Z')

  test('долг требует описания, лимит 200 символов, срок не в прошлом', () => {
    expect(code(() => validateMark({ state: 'debt', note: '  ' }, now))).toBe('note_required')
    expect(code(() => validateMark({ state: 'debt', note: 'x'.repeat(201) }, now))).toBe('note_too_long')
    expect(code(() => validateMark({ state: 'debt', note: 'книга', due: '2026-10-28' }, now))).toBe('due_past')
  })

  test('описание обрезается, пустой срок не отправляется, у clear нет лишних полей', () => {
    expect(validateMark({ state: 'debt', note: '  книга  ', due: '' }, now)).toEqual({ state: 'debt', note: 'книга', due: undefined })
    expect(validateMark({ state: 'clear', note: 'мусор' }, now)).toEqual({ state: 'clear' })
  })
})

describe('учётные записи', () => {
  test('пароль не короче 8 символов и совпадает с повтором', () => {
    expect(code(() => validatePassword('short', 'short'))).toBe('weak_password')
    expect(code(() => validatePassword('long-enough', 'other-one'))).toBe('validation')
    expect(code(() => validatePassword('long-enough', 'long-enough'))).toBe('ok')
  })

  test('логин латиницей, ФИО не короче 3 символов', () => {
    expect(code(() => validatePerson('Ай', 'a.saparova'))).toBe('validation')
    expect(code(() => validatePerson('Айгерим Сапарова', 'Айгерим'))).toBe('validation')
    expect(code(() => validatePerson('Айгерим Сапарова', 'a.saparova'))).toBe('ok')
  })

  test('после входа каждая роль попадает в свой кабинет', () => {
    expect([homeOf('student'), homeOf('officer'), homeOf('admin')]).toEqual(['/student', '/office', '/admin'])
  })
})
