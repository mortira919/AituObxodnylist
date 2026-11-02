// Студент: статус листа, долги, закрытый лист с печатью, Telegram, пустое состояние.
import { botReceivesCode, openSheetDirect } from './fakeApi'
import { expect, login, test } from './fixtures'

test.use({ viewport: { width: 390, height: 844 } })

test('видно, кто держит лист, что вернуть, куда идти и до какого числа', async ({ page, api }) => {
  void api
  await login(page, 'a.saparova')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Держит: Библиотека')
  await expect(page.getByText('4 из 6 отделов подтвердили отсутствие задолженности')).toBeVisible()
  const library = page.locator('.mark-row.is-debt')
  await expect(library).toContainText('Python. Основы программирования')
  await expect(library).toContainText('Каб. 104')
  await expect(library).toContainText('Закрыть до')
  await expect(page.locator('.mark-row.is-pending')).toContainText('Приходить не нужно')
})

test('закрытый лист: печать, QR, PDF и ссылка для проверки', async ({ page, context, api }) => {
  void api
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await login(page, 'd.zhumabekov')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Лист закрыт')
  await expect(page.locator('.closed-block > .seal')).toBeVisible()
  await expect(page.locator('.closed-block-side .qr svg')).toBeVisible()
  await page.evaluate(() => {
    ;(window as unknown as { printed: boolean }).printed = false
    window.print = () => {
      ;(window as unknown as { printed: boolean }).printed = true
    }
  })
  await page.getByRole('button', { name: 'Скачать PDF' }).click()
  expect(await page.evaluate(() => (window as unknown as { printed: boolean }).printed)).toBe(true)
  await page.getByRole('button', { name: 'Ссылка для проверки' }).click()
  await expect(page.getByRole('button', { name: 'Ссылка скопирована' })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/verify\/\d{4}-\d{4}$/)
})

test('печатная форма содержит логотип, таблицу отметок и печать', async ({ page, api }) => {
  void api
  await login(page, 'd.zhumabekov')
  await page.emulateMedia({ media: 'print' })
  const print = page.locator('.print-sheet')
  await expect(print).toBeVisible()
  await expect(print.locator('img.print-logo')).toBeVisible()
  await expect(print.locator('tr')).toHaveCount(6)
  await expect(page.locator('.appbar')).toBeHidden()
})

test('Telegram: код, бот, подтверждение и отключение', async ({ page, world, api }) => {
  void api
  await login(page, 'a.saparova')
  await page.getByRole('button', { name: 'Подключить' }).click()
  const hint = page.locator('.tg')
  await expect(hint).toContainText(/отправьте код \d{4}/)
  await expect(hint.getByRole('link', { name: 'Открыть бота' })).toHaveAttribute('href', /t\.me/)
  const code = (await hint.textContent())!.match(/код (\d{4})/)![1]
  botReceivesCode(world.db, code)
  await hint.getByRole('button', { name: 'Я отправил код' }).click()
  await expect(hint).toContainText('Подключено')
  await hint.getByRole('button', { name: 'Отключить' }).click()
  await expect(hint.getByRole('button', { name: 'Подключить' })).toBeVisible()
})

test('без открытых листов студент видит объяснение, а не пустоту', async ({ page, world, api }) => {
  void api
  world.db.sheets = world.db.sheets.filter((s) => s.studentId !== world.students.nurlan.id)
  await login(page, 'n.akhmetov')
  await expect(page.getByRole('heading', { name: 'Открытых листов нет' })).toBeVisible()
  await expect(page.locator('.empty')).toContainText('учебная часть')
})

test('старые листы видны в истории со ссылкой на проверку', async ({ page, world, api }) => {
  void api
  const old = openSheetDirect(world.db, world.students.daniyar.id, 'dorm', { dorm: { state: 'clear' }, accounting: { state: 'clear' } }, 40)
  openSheetDirect(world.db, world.students.daniyar.id, 'leave')
  await login(page, 'd.zhumabekov')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Ждём')
  const history = page.locator('.history')
  await expect(history).toContainText(old.number)
  await history.getByRole('link', { name: 'Проверить' }).first().click()
  await expect(page).toHaveURL(/\/verify\//)
})
