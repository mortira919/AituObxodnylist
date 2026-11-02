// Опыт использования: два языка, адаптив на всех ширинах, доступность и клавиатура.
import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, login, noHorizontalOverflow, test } from './fixtures'

const SCREENS: { who?: string; url: string; ready: (p: Page) => Promise<void> }[] = [
  { url: '/', ready: (p) => expect(p.locator('.hero h1')).toBeVisible() },
  { url: '/login', ready: (p) => expect(p.getByRole('button', { name: 'Войти' })).toBeVisible() },
  { url: '/verify/__CLOSED__', ready: (p) => expect(p.getByRole('heading', { name: 'Документ подлинный' })).toBeVisible() },
  { who: 'a.saparova', url: '/student', ready: (p) => expect(p.locator('.status-line')).toBeVisible() },
  { who: 'd.zhumabekov', url: '/student', ready: (p) => expect(p.locator('.closed-block')).toBeVisible() },
  { who: 'off.library', url: '/office', ready: (p) => expect(p.locator('tbody tr').first()).toBeVisible() },
  { who: 'off.library', url: '/sheets/__DEBT__', ready: (p) => expect(p.locator('.my-mark')).toBeVisible() },
  { who: 'admin', url: '/admin', ready: (p) => expect(p.locator('tbody tr').first()).toBeVisible() },
  { who: 'admin', url: '/admin/students', ready: (p) => expect(p.locator('tbody tr').first()).toBeVisible() },
  { who: 'admin', url: '/admin/staff', ready: (p) => expect(p.locator('tbody tr').first()).toBeVisible() },
  { who: 'admin', url: '/admin/templates', ready: (p) => expect(p.locator('.matrix')).toBeVisible() },
  { who: 'admin', url: '/admin/audit', ready: (p) => expect(p.locator('.audit li').first()).toBeVisible() },
  { who: 'admin', url: '/account', ready: (p) => expect(p.getByLabel('Текущий пароль')).toBeVisible() },
]

async function open(page: Page, s: (typeof SCREENS)[number], numbers: { closed: string; debt: string }) {
  if (s.who) await login(page, s.who)
  await page.goto(s.url.replace('__CLOSED__', numbers.closed).replace('__DEBT__', numbers.debt))
  await s.ready(page)
}

test.describe('адаптив: без горизонтальной прокрутки на любой ширине', () => {
  for (const width of [320, 390, 640, 768, 1024, 1440]) {
    test(`ширина ${width}px`, async ({ page, world, api }) => {
      void api
      test.setTimeout(90_000)
      await page.setViewportSize({ width, height: 900 })
      for (const s of SCREENS) {
        await open(page, s, { closed: world.sheets.closedSheet.number, debt: world.sheets.debtSheet.number })
        await test.step(`${s.who ?? 'гость'} ${s.url}`, () => noHorizontalOverflow(page))
        if (s.who) await page.getByRole('button', { name: 'Выйти' }).click()
      }
    })
  }
})

test.describe('доступность (axe, WCAG 2.1 AA)', () => {
  for (const s of SCREENS) {
    test(`${s.who ?? 'гость'} ${s.url}`, async ({ page, world, api }) => {
      void api
      await open(page, s, { closed: world.sheets.closedSheet.number, debt: world.sheets.debtSheet.number })
      // ждём, пока лендинг закончит анимацию, иначе axe меряет контраст на полупрозрачных кадрах
      if (s.url === '/') await expect(page.locator('.hero-sheet.is-closed')).toBeVisible({ timeout: 8000 })
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
      const problems = result.violations.map((v) => `${v.impact} ${v.id}: ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)
      expect(problems, problems.join('\n')).toEqual([])
    })
  }
})

test.describe('клавиатура', () => {
  test('вход целиком с клавиатуры, фокус всегда виден', async ({ page, api }) => {
    void api
    await page.goto('/login')
    await page.keyboard.press('Tab')
    let guard = 0
    while (!(await page.getByLabel('Логин').evaluate((el) => el === document.activeElement)) && guard++ < 10) await page.keyboard.press('Tab')
    await page.keyboard.type('admin')
    await page.keyboard.press('Tab')
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle)
    expect(outline).not.toBe('none')
    await page.keyboard.type('password-123')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL('/admin')
  })

  test('лендинг: ссылка «К содержанию» появляется первой по Tab', async ({ page }) => {
    await page.goto('/')
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: 'К содержанию' })).toBeFocused()
  })

  test('сотрудник отмечает лист без мыши', async ({ page, api }) => {
    void api
    await login(page, 'off.library')
    const button = page.getByRole('row', { name: /Нурлан Ахметов/ }).getByRole('button', { name: 'Нет задолженности' })
    await button.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('status')).toContainText('отмечено без задолженности')
  })
})

test.describe('казахский язык', () => {
  test('выбор языка запоминается и действует на всех экранах', async ({ page, api }) => {
    void api
    await page.goto('/login')
    await page.getByRole('button', { name: 'ҚАЗ' }).click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'kk')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Айналма парағына кіру')
    await page.getByLabel('Логин').fill('a.saparova')
    await page.getByLabel('Құпиясөз').fill('password-123')
    await page.getByRole('button', { name: 'Кіру' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ұстап тұр: Кітапхана')
    await page.reload()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ұстап тұр: Кітапхана')
    await expect(page.locator('.mark-row.is-debt .mark-state')).toHaveText('Берешек бар')
  })

  test('ошибки тоже переведены', async ({ page, api }) => {
    void api
    await page.goto('/login')
    await page.getByRole('button', { name: 'ҚАЗ' }).click()
    await page.getByRole('button', { name: 'Кіру' }).click()
    await expect(page.getByRole('alert')).toHaveText('Логин мен құпиясөзді енгізіңіз.')
  })
})
