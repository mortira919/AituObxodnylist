// Полный путь листа: учебная часть открывает, шесть отделов отмечают, студент получает печать,
// посторонний проверяет подлинность. Каждая роль работает в своём окне браузера.
import { DEPTS } from './fakeApi'
import { attachFakeApi } from './fakeApi'
import { expect, login, test } from './fixtures'

test('от открытия листа до проверки подлинности по QR', async ({ browser, world }) => {
  test.setTimeout(120_000)
  const db = world.db
  // у Нурлана в исходных данных есть открытый «Перевод»; убираем, чтобы следить за одним листом
  db.sheets = db.sheets.filter((s) => s !== world.sheets.pendingSheet)
  const window = async (asLogin?: string, viewport = { width: 1440, height: 900 }) => {
    const ctx = await browser.newContext({ viewport, locale: 'ru-RU', timezoneId: 'Asia/Almaty' })
    await attachFakeApi(ctx, db)
    const page = await ctx.newPage()
    if (asLogin) await login(page, asLogin)
    return { ctx, page }
  }

  // 1. учебная часть открывает лист «Выпуск» Нурлану
  const admin = await window('admin')
  const form = admin.page.locator('form.create')
  await form.getByPlaceholder('ФИО или группа').fill('Нурлан')
  await admin.page.getByRole('option', { name: /Нурлан Ахметов/ }).click()
  await form.getByRole('button', { name: 'Открыть лист' }).click()
  await expect(form).toContainText('открыт')
  const number = db.sheets[0].number

  // 2. студент сразу видит новый лист и шесть ожидающих отделов
  const student = await window('n.akhmetov', { width: 390, height: 844 })
  await expect(student.page.getByRole('heading', { level: 1 })).toHaveText('Ждём отметки 6 отделов')

  // 3. библиотека ставит долг, студент видит его после возврата на вкладку
  const library = await window('off.library')
  await library.page.getByPlaceholder('ФИО, группа или №').fill(number)
  await expect(library.page.locator('tbody tr')).toHaveCount(1)
  await library.page.getByRole('row', { name: /Нурлан Ахметов/ }).getByRole('button', { name: 'Есть долг' }).click()
  await library.page.locator('.debt-form textarea').fill('Вернуть «Компьютерные сети», инв. № 5512')
  await library.page.locator('.debt-form').getByRole('button', { name: 'Записать долг' }).click()
  await expect(library.page.getByRole('status')).toContainText('Долг записан')
  await student.page.reload()
  await expect(student.page.getByRole('heading', { level: 1 })).toHaveText('Держит: Библиотека')

  // 4. остальные отделы отмечают «нет задолженности», библиотека гасит долг
  for (const dept of DEPTS.filter((d) => d !== 'library')) {
    const w = await window(`off.${dept}`)
    await w.page.getByPlaceholder('ФИО, группа или №').fill(number)
    await expect(w.page.locator('tbody tr')).toHaveCount(1)
    await w.page.getByRole('row', { name: /Нурлан Ахметов/ }).getByRole('button', { name: 'Нет задолженности' }).click()
    await expect(w.page.getByRole('status')).toContainText('отмечено без задолженности')
    await w.ctx.close()
  }
  await library.page.getByRole('tab', { name: /С долгом/ }).click()
  await library.page.getByRole('row', { name: /Нурлан Ахметов/ }).getByRole('button', { name: 'Долг погашен' }).click()
  await expect(library.page.getByRole('status')).toContainText('все отделы отметились, лист закрыт')

  // 5. студент получает закрытый лист с печатью и QR
  await student.page.reload()
  await expect(student.page.getByRole('heading', { level: 1 })).toContainText('Лист закрыт')
  await expect(student.page.locator('.closed-block > .seal')).toContainText(number)

  // 6. закрытый лист больше не меняется даже прямым запросом
  const res = await library.page.evaluate(
    async (n) => (await fetch(`/api/v1/sheets/${n}/marks/library`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, body: JSON.stringify({ state: 'debt', note: 'x' }) })).status,
    number,
  )
  expect(res).toBe(409)

  // 7. журнал учебной части фиксирует всё по порядку
  await admin.page.goto(`/sheets/${number}`)
  await expect(admin.page.locator('.audit li').first()).toContainText('Лист закрыт автоматически')
  expect(db.audit.filter((a) => a.sheet === number).map((a) => a.action).sort()).toEqual(['clear', 'clear', 'clear', 'clear', 'clear', 'clear', 'close', 'create', 'debt'].sort())

  // 8. посторонний без входа проверяет документ и видит только минимум данных
  const stranger = await window()
  await stranger.page.goto(`/verify/${number}`)
  await expect(stranger.page.getByRole('heading', { name: 'Документ подлинный' })).toBeVisible()
  await expect(stranger.page.locator('.verdict-facts')).toContainText('Нурлан А.')
  await expect(stranger.page.locator('main')).not.toContainText('Ахметов')
  await expect(stranger.page.locator('main')).not.toContainText('ВТ-2202')
  await expect(stranger.page.locator('main')).not.toContainText('Компьютерные сети')
})
