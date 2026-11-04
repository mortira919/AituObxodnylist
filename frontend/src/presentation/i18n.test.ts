// Казахские даты не зависят от того, есть ли в браузере локаль kk-KZ.
import { expect, test } from 'vitest'
import { formatKz } from './i18n'

test('казахские названия месяцев, время и год', () => {
  const iso = new Date(2026, 10, 4, 9, 5).toISOString()
  expect(formatKz(iso, 'date')).toBe('4 қараша')
  expect(formatKz(iso, 'dateTime')).toBe('4 қараша, 09:05')
  expect(formatKz(iso, 'full')).toBe('2026 жылғы 4 қараша')
  expect(formatKz(new Date(2026, 0, 31).toISOString(), 'date')).toBe('31 қаңтар')
})
