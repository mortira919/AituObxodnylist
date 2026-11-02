// Худшие реалистичные данные (методика break-ui): всё в пределах лимитов контракта.
// Скриншоты складываются в .impeccable/review/worst-*.png для глазной проверки.
import type { Page } from '@playwright/test'
import { DEPTS, addStudent, addUser, emptyDb, openSheetDirect, type Db } from './fakeApi'
import { attachFakeApi } from './fakeApi'
import { expect, login, noHorizontalOverflow, test } from './fixtures'

const LONG_NOTE =
  'Вернуть «Алгоритмы и структуры данных. Полный курс» (инв. № 4471), «Компьютерные сети. 6-е изд.» (инв. № 5512) и ноутбук Lenovo ThinkPad E14, сер. № PF3KX2Y9Z1; оплатить штраф 1 500 ₸'.slice(0, 200)
const URL_NOTE = 'Сдать по ссылке https://library.example.com/loans/9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f?return=true&student=nursultan'
const SCRIPT_NOTE = '<script>alert(1)</script> &amp; **жирный**'

function worstDb(): { db: Db; numbers: string[] } {
  const db = emptyDb()
  addUser(db, { login: 'admin', name: 'Жанар Абдрахманова', role: 'admin' })
  const longOfficer = 'Александра Вишневская-Ковальчик-Сейітқасымова'
  for (const d of DEPTS) addUser(db, { login: `off.${d}`, name: d === 'library' ? longOfficer : `Сотрудник ${d}`, role: 'officer', department: d })

  const kz = addStudent(db, 'Нұрсұлтан Әбдіқадырұлы Жұмағалиев-Сейітқасымов', 'ПО-2201-ВЕЧЕРНЕЕ-ОТД', 'bartholomew.fitzgerald-northwind-industries.holdings')
  const vn = addStudent(db, 'Đặng Thị Ngọc Hân', 'ИС-2302', 'dang.thi.ngoc.han')
  const short = addStudent(db, 'Ким', 'ВТ-2201', 'kim')
  const by = (d: (typeof DEPTS)[number]) => db.users.find((u) => u.department === d)!.name
  const at = new Date().toISOString()

  const a = openSheetDirect(db, kz.id, 'graduation', {
    library: { state: 'debt', note: LONG_NOTE, due: new Date(Date.now() + 864e5).toISOString().slice(0, 10), at, by: by('library') },
    accounting: { state: 'debt', note: URL_NOTE, at, by: by('accounting') },
    dorm: { state: 'debt', note: SCRIPT_NOTE, at, by: by('dorm') },
    military: { state: 'clear', at, by: by('military') },
  })
  const b = openSheetDirect(db, vn.id, 'expulsion', Object.fromEntries(DEPTS.map((d) => [d, { state: 'clear', at, by: by(d) }])))
  const c = openSheetDirect(db, short.id, 'dorm', { dorm: { state: 'clear', at, by: by('dorm') } })
  // 1000 записей журнала: список должен листаться страницами, а не рисовать всё сразу
  for (let i = 0; i < 1000; i++) db.audit.push({ at: new Date(Date.now() - i * 6e4).toISOString(), actor: longOfficer, sheet: a.number, department: 'library', action: 'debt', note: LONG_NOTE })
  return { db, numbers: [a.number, b.number, c.number] }
}

async function check(page: Page, name: string) {
  await noHorizontalOverflow(page)
  const text = await page.locator('body').innerText()
  expect(text, 'сырые значения не должны просачиваться в интерфейс').not.toMatch(/\bundefined\b|\bNaN\b|\bnull\b|\[object Object\]/)
  await page.screenshot({ path: `../.impeccable/review/worst-${name}.png`, fullPage: true })
}

for (const width of [320, 1440]) {
  test(`худшие данные, ширина ${width}px`, async ({ browser }) => {
    test.setTimeout(120_000)
    const { db, numbers } = worstDb()
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, locale: 'ru-RU', timezoneId: 'Asia/Almaty' })
    await attachFakeApi(ctx, db)
    const page = await ctx.newPage()
    page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
    page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text()))
    page.on('dialog', () => {
      throw new Error('в интерфейсе выполнился чужой скрипт')
    })

    await login(page, 'bartholomew.fitzgerald-northwind-industries.holdings')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Держит')
    await expect(page.locator('main')).toContainText('<script>alert(1)</script>')
    await check(page, `student-${width}`)
    await page.getByRole('button', { name: 'Выйти' }).click()

    await login(page, 'off.library')
    await page.getByRole('tab', { name: /С долгом/ }).click()
    await expect(page.locator('tbody tr')).toHaveCount(1)
    await check(page, `office-${width}`)
    await page.goto(`/sheets/${numbers[0]}`)
    await expect(page.locator('.my-mark')).toBeVisible()
    await expect(page.locator('.audit li')).toHaveCount(20)
    await expect(page.getByRole('button', { name: /Показать все записи \(10\d\d\)/ })).toBeVisible()
    await check(page, `sheet-${width}`)
    await page.getByRole('button', { name: 'Выйти' }).click()

    await login(page, 'admin')
    await expect(page.locator('tbody tr')).toHaveCount(3)
    await check(page, `admin-${width}`)
    await page.goto('/admin/students')
    await expect(page.locator('tbody tr')).toHaveCount(3)
    await check(page, `students-${width}`)
    await page.goto('/admin/staff')
    await check(page, `staff-${width}`)
    await page.goto('/admin/audit')
    await expect(page.locator('.audit li')).toHaveCount(50)
    await expect(page.getByText('Страница 1 из 21')).toBeVisible()
    await check(page, `audit-${width}`)

    await page.goto(`/verify/${numbers[1]}`)
    await expect(page.getByRole('heading', { name: 'Документ подлинный' })).toBeVisible()
    await expect(page.locator('.verdict-facts')).toContainText('Đặng T.')
    await check(page, `verify-${width}`)
    await ctx.close()
  })
}
