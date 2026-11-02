// Публичные страницы: проверка документа, лендинг, 404.
import { expect, test } from './fixtures'

test.describe('проверка документа без входа', () => {
  test('неверный формат номера ловится до запроса', async ({ page, world, api }) => {
    void api
    await page.goto('/verify')
    await page.getByLabel('Номер с QR-кода или из PDF').fill('142')
    await page.getByRole('button', { name: 'Проверить' }).click()
    await expect(page.getByRole('alert')).toHaveText('Номер выглядит так: 2026-0139')
    expect(world.db.requests.some((r) => r.path.startsWith('/public'))).toBe(false)
  })

  test('несуществующий, незакрытый и закрытый лист', async ({ page, world, api }) => {
    void api
    await page.goto('/verify/1999-0001')
    await expect(page.getByRole('heading', { name: 'Лист с таким номером не найден' })).toBeVisible()

    await page.goto(`/verify/${world.sheets.debtSheet.number}`)
    await expect(page.getByRole('heading', { name: 'Лист ещё не закрыт' })).toBeVisible()
    await expect(page.locator('main')).toContainText('Айгерим С.')
    await expect(page.locator('main')).not.toContainText('Python')

    await page.goto(`/verify/${world.sheets.closedSheet.number}`)
    await expect(page.getByRole('heading', { name: 'Документ подлинный' })).toBeVisible()
    await expect(page.locator('.verdict-ok .seal')).toContainText(world.sheets.closedSheet.number)
    await expect(page.locator('.verdict-marks li')).toHaveCount(6)
  })

  test('ввод номера в форму ведёт на страницу результата', async ({ page, world, api }) => {
    void api
    await page.goto('/verify')
    await page.getByLabel('Номер с QR-кода или из PDF').fill(world.sheets.closedSheet.number)
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(`/verify/${world.sheets.closedSheet.number}`)
    await expect(page.getByRole('heading', { name: 'Документ подлинный' })).toBeVisible()
  })
})

test('лендинг: живой лист проходит путь от долга до печати, кнопки ведут ко входу и проверке', async ({ page, api }) => {
  void api
  await page.goto('/')
  await expect(page.locator('.hero-sheet-foot')).toContainText('Библиотека: вернуть', { timeout: 4000 })
  await expect(page.locator('.hero-sheet.is-closed')).toBeVisible({ timeout: 8000 })
  await page.locator('.hero .role-entries').getByRole('link', { name: 'Войти' }).click()
  await expect(page).toHaveURL('/login')
  await page.goBack()
  await page.locator('.hero .role-entries').getByRole('link', { name: 'Проверить документ' }).click()
  await expect(page).toHaveURL('/verify')
})

test('лендинг уважает «уменьшить движение»: сразу показан итог без анимации', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  await page.goto('/')
  await expect(page.locator('.hero-sheet.is-closed')).toBeVisible({ timeout: 1000 })
  await ctx.close()
})

test('несуществующая страница', async ({ page, api }) => {
  void api
  await page.goto('/no-such-page')
  await expect(page.getByRole('heading', { name: 'Такой страницы нет' })).toBeVisible()
  await page.getByRole('link', { name: 'На главную' }).click()
  await expect(page).toHaveURL('/')
})
