// Сотрудник отдела: очередь, отметки, долги, массовая отметка, карточка листа.
import { addStudent, openSheetDirect } from './fakeApi'
import { expect, login, test } from './fixtures'

test.beforeEach(async ({ page, api }) => {
  void api
  await login(page, 'off.library')
  await expect(page.getByRole('heading', { name: 'Библиотека' })).toBeVisible()
})

test('очередь показывает только свой отдел и верные счётчики', async ({ page }) => {
  await expect(page.getByRole('tab', { name: /Ожидают/ })).toContainText('1')
  await expect(page.getByRole('tab', { name: /С долгом/ })).toContainText('1')
  await expect(page.getByRole('tab', { name: /Отмечены/ })).toContainText('1')
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await expect(page.locator('tbody')).toContainText('Нурлан Ахметов')
})

test('«Нет задолженности» убирает лист из очереди и обновляет счётчики', async ({ page, world }) => {
  await page.getByRole('row', { name: /Нурлан Ахметов/ }).getByRole('button', { name: 'Нет задолженности' }).click()
  await expect(page.getByRole('status')).toContainText('Нурлан Ахметов: отмечено без задолженности.')
  await expect(page.getByRole('row', { name: /Нурлан Ахметов/ })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: /Отмечены/ })).toContainText('2')
  expect(world.sheets.pendingSheet.marks.find((m) => m.department === 'library')).toMatchObject({ state: 'clear', by: 'Гульнара Нуртазина' })
})

test('долг без описания не уходит на сервер, долг с описанием появляется во вкладке', async ({ page, world }) => {
  const row = page.getByRole('row', { name: /Нурлан Ахметов/ })
  await row.getByRole('button', { name: 'Есть долг' }).click()
  const form = page.locator('.debt-form')
  await expect(form.getByLabel('Что должен студент')).toBeFocused()
  const before = world.db.requests.length
  await form.getByRole('button', { name: 'Записать долг' }).click()
  await expect(form.getByRole('alert')).toHaveText('Опишите задолженность: что вернуть или оплатить.')
  expect(world.db.requests.slice(before).some((r) => r.method === 'PUT')).toBe(false)

  await form.getByLabel('Что должен студент').fill('Вернуть «Базы данных», инв. № 2210')
  await expect(form.getByText('34/200')).toBeVisible()
  await form.getByRole('button', { name: 'Записать долг' }).click()
  await expect(page.getByRole('status')).toContainText('Долг записан')
  await page.getByRole('tab', { name: /С долгом/ }).click()
  await expect(page.getByRole('row', { name: /Нурлан Ахметов/ })).toContainText('Вернуть «Базы данных»')
})

test('Escape закрывает форму долга без сохранения', async ({ page, world }) => {
  await page.getByRole('row', { name: /Нурлан Ахметов/ }).getByRole('button', { name: 'Есть долг' }).click()
  await page.locator('.debt-form textarea').fill('черновик')
  await page.keyboard.press('Escape')
  await expect(page.locator('.debt-form')).toHaveCount(0)
  expect(world.sheets.pendingSheet.marks.find((m) => m.department === 'library')!.state).toBe('pending')
})

test('срок в прошлом сервер отклоняет понятной ошибкой', async ({ page }) => {
  await page.getByRole('row', { name: /Нурлан Ахметов/ }).getByRole('button', { name: 'Есть долг' }).click()
  const form = page.locator('.debt-form')
  await form.getByLabel('Что должен студент').fill('Книга')
  await form.getByLabel('Срок').fill('2020-01-01')
  await form.getByRole('button', { name: 'Записать долг' }).click()
  await expect(form.getByRole('alert')).toHaveText('Срок не может быть в прошлом.')
})

test('изменить долг и погасить его', async ({ page, world }) => {
  await page.getByRole('tab', { name: /С долгом/ }).click()
  const row = page.getByRole('row', { name: /Айгерим Сапарова/ })
  await row.getByRole('button', { name: 'Изменить' }).click()
  await expect(page.locator('.debt-form textarea')).toHaveValue(/Python/)
  await page.locator('.debt-form textarea').fill('Вернуть две книги: «Python» и «SQL»')
  await page.locator('.debt-form').getByRole('button', { name: 'Записать долг' }).click()
  await expect(row).toContainText('две книги')
  await row.getByRole('button', { name: 'Долг погашен' }).click()
  await expect(page.getByRole('row', { name: /Айгерим Сапарова/ })).toHaveCount(0)
  expect(world.sheets.debtSheet.marks.find((m) => m.department === 'library')!.state).toBe('clear')
})

test('массовая отметка нескольких листов', async ({ page, world }) => {
  for (const i of [1, 2, 3]) openSheetDirect(world.db, addStudent(world.db, `Выпускник Группы${i}`, 'ПО-2201', `grad.${i}`).id, 'graduation')
  await page.reload()
  await expect(page.locator('tbody tr')).toHaveCount(4)
  await page.getByRole('checkbox', { name: 'Выбрать все' }).check()
  await expect(page.locator('.bulk')).toContainText('Выбрано: 4')
  await page.getByRole('button', { name: 'Отметить без задолженности' }).click()
  await expect(page.getByRole('status')).toContainText('Отмечено без задолженности: 4.')
  await expect(page.getByRole('heading', { name: 'Очередь пуста' })).toBeVisible()
})

test('поиск по группе и по номеру листа', async ({ page, world }) => {
  await page.getByPlaceholder('ФИО, группа или №').fill('ВТ-2202')
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await page.getByPlaceholder('ФИО, группа или №').fill(world.sheets.pendingSheet.number)
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await page.getByPlaceholder('ФИО, группа или №').fill('никто')
  await expect(page.getByRole('heading', { name: 'Ничего не нашлось' })).toBeVisible()
})

test('закрытый лист заблокирован для правок', async ({ page }) => {
  await page.getByRole('tab', { name: /Отмечены/ }).click()
  const row = page.getByRole('row', { name: /Данияр Жумабеков/ })
  await expect(row).toContainText('Лист закрыт')
  await expect(row.getByRole('button')).toHaveCount(0)
})

test('отметка из карточки листа и журнал по листу', async ({ page, world }) => {
  await page.getByRole('link', { name: `№ ${world.sheets.pendingSheet.number}` }).click()
  await expect(page.getByRole('heading', { name: 'Отметка отдела «Библиотека»' })).toBeVisible()
  await page.getByRole('button', { name: 'Нет задолженности' }).click()
  await expect(page.getByText('Отмечено без задолженности.')).toBeVisible()
  await expect(page.locator('.audit')).toContainText('Библиотека: нет задолженности')
  await page.getByRole('link', { name: 'К списку' }).click()
  await expect(page).toHaveURL('/office')
})

test('карточка листа чужого отдела не открывается', async ({ page, world }) => {
  const s = openSheetDirect(world.db, world.students.nurlan.id, 'dorm')
  await page.goto(`/sheets/${s.number}`)
  await expect(page.getByRole('alert')).toContainText('Не найдено')
})
