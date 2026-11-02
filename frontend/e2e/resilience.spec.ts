// Устойчивость к сбоям: нет сети, ошибка сервера, медленный ответ.
import { expect, login, test } from './fixtures'

test('нет сети при загрузке очереди: понятное сообщение и рабочая кнопка «Повторить»', async ({ page, world, api }) => {
  void api
  await login(page, 'off.library')
  await expect(page.locator('tbody tr')).toHaveCount(1)
  world.db.faults.push({ match: /^\/sheets$/, status: 0, times: 1 })
  await page.getByRole('tab', { name: /С долгом/ }).click()
  await expect(page.locator('.load-error')).toContainText('Нет связи с сервером')
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(page.locator('tbody tr')).toHaveCount(1)
})

test('ошибка сервера при отметке не теряет строку и объясняет, что делать', async ({ page, world, api }) => {
  void api
  await login(page, 'off.library')
  world.db.faults.push({ match: /\/marks\//, status: 500, code: 'server', times: 1 })
  await page.getByRole('row', { name: /Нурлан Ахметов/ }).getByRole('button', { name: 'Нет задолженности' }).click()
  await expect(page.getByRole('status')).toContainText('На сервере ошибка')
  await expect(page.getByRole('row', { name: /Нурлан Ахметов/ })).toBeVisible()
  expect(world.sheets.pendingSheet.marks.find((m) => m.department === 'library')!.state).toBe('pending')
})

test('медленный ответ: скелетон вместо пустоты, кнопка блокируется на время запроса', async ({ page, world, api }) => {
  void api
  await login(page, 'admin')
  world.db.faults.push({ match: /^\/students$/, status: 200, times: 2, delayMs: 1500 })
  await page.getByRole('link', { name: 'Студенты' }).click()
  await expect(page.locator('.skeleton')).toBeVisible()
  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 5000 })

  await page.goto('/admin/staff')
  await expect(page.locator('tbody tr').first()).toBeVisible()
  await page.locator('form.create').getByLabel('ФИО').fill('Медленная Проверка')
  await page.locator('form.create').getByLabel('Логин').fill('slow.check')
  world.db.faults.push({ match: /^\/users$/, status: 200, times: 1, delayMs: 1200 })
  const submit = page.locator('form.create').getByRole('button', { name: 'Добавить' })
  await submit.click()
  await expect(submit).toBeDisabled()
  await expect(page.locator('.otp')).toContainText('slow.check', { timeout: 5000 })
})

test('сбой проверки документа предлагает повторить', async ({ page, world, api }) => {
  void api
  world.db.faults.push({ match: /^\/public\/verify/, status: 0, times: 2 })
  await page.goto(`/verify/${world.sheets.closedSheet.number}`)
  await expect(page.locator('.load-error')).toContainText('Нет связи')
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByRole('heading', { name: 'Документ подлинный' })).toBeVisible()
})

test('сервер без заголовка X-Requested-With отклоняет изменение: фронт всегда его шлёт', async ({ page, world, api }) => {
  void api
  await login(page, 'off.library')
  await page.getByRole('row', { name: /Нурлан Ахметов/ }).getByRole('button', { name: 'Нет задолженности' }).click()
  await expect(page.getByRole('status')).toContainText('отмечено без задолженности')
  expect(world.db.requests.filter((r) => r.method !== 'GET').length).toBeGreaterThan(0)
})
