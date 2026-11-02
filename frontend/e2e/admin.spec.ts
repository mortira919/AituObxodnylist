// Учебная часть: справочники, открытие листов, шаблоны, журнал.
import { DEPTS, addStudent, openSheetDirect } from './fakeApi'
import { expect, login, test } from './fixtures'

test.beforeEach(async ({ page, api }) => {
  void api
  await login(page, 'admin')
  await expect(page).toHaveURL('/admin')
})

test.describe('сотрудники', () => {
  test('добавление сотрудника отдела выдаёт временный пароль, занятый логин отклоняется', async ({ page, world }) => {
    await page.getByRole('link', { name: 'Сотрудники' }).click()
    const form = page.locator('form.create')
    await form.getByLabel('ФИО').fill('Мария Ли')
    await form.getByLabel('Логин').fill('m.li')
    await form.getByLabel('Отдел').selectOption('dorm')
    await form.getByRole('button', { name: 'Добавить' }).click()
    const otp = page.locator('.otp')
    await expect(otp).toContainText('m.li')
    await expect(otp).toContainText(/tmp-/)
    await expect(page.getByRole('row', { name: /Мария Ли/ })).toBeVisible()
    expect(world.db.users.find((u) => u.login === 'm.li')).toMatchObject({ role: 'officer', department: 'dorm', mustChangePassword: true })

    await form.getByLabel('ФИО').fill('Другая Мария')
    await form.getByLabel('Логин').fill('m.li')
    await form.getByRole('button', { name: 'Добавить' }).click()
    await expect(form.getByRole('alert')).toHaveText('Такой логин уже занят. Придумайте другой.')
  })

  test('логин кириллицей и короткое ФИО останавливаются до запроса', async ({ page, world }) => {
    await page.goto('/admin/staff')
    const form = page.locator('form.create')
    await form.getByLabel('ФИО').fill('Ли')
    await form.getByLabel('Логин').fill('мария')
    const before = world.db.requests.length
    await form.getByRole('button', { name: 'Добавить' }).click()
    await expect(form.getByRole('alert')).toHaveText('Проверьте заполнение полей.')
    await expect(form.getByLabel('ФИО')).toHaveAttribute('aria-invalid', 'true')
    expect(world.db.requests.slice(before).some((r) => r.path === '/users' && r.method === 'POST')).toBe(false)
  })

  test('администратору отдел не задаётся', async ({ page, world }) => {
    await page.goto('/admin/staff')
    const form = page.locator('form.create')
    await form.getByLabel('Роль').selectOption('admin')
    await expect(form.getByLabel('Отдел')).toHaveCount(0)
    await form.getByLabel('ФИО').fill('Ерлан Нуров')
    await form.getByLabel('Логин').fill('e.nurov')
    await form.getByRole('button', { name: 'Добавить' }).click()
    await expect(page.locator('.otp')).toContainText('e.nurov')
    expect(world.db.users.find((u) => u.login === 'e.nurov')).toMatchObject({ role: 'admin', department: undefined })
  })

  test('блокировка, смена отдела и сброс пароля', async ({ page, world }) => {
    await page.goto('/admin/staff')
    const row = page.getByRole('row', { name: /Евгений Ким/ })
    await row.getByRole('button', { name: 'Заблокировать' }).click()
    await expect(row).toContainText('Заблокирован')
    expect(world.officers.accounting.active).toBe(false)
    await row.getByRole('button', { name: 'Разблокировать' }).click()
    await expect(row).toContainText('Активен')

    await row.getByRole('combobox').selectOption('it')
    await expect(page.getByText('Отдел изменён.')).toBeVisible()
    expect(world.officers.accounting.department).toBe('it')

    await row.getByRole('button', { name: 'Новый пароль' }).click()
    await expect(page.locator('.otp')).toContainText('off.accounting')
  })

  test('себя заблокировать нельзя: кнопки нет', async ({ page }) => {
    await page.goto('/admin/staff')
    const me = page.getByRole('row', { name: /Жанар Абдрахманова/ })
    await expect(me.getByRole('button', { name: 'Заблокировать' })).toHaveCount(0)
  })
})

test.describe('студенты', () => {
  test('добавление, правка и сброс пароля', async ({ page, world }) => {
    await page.getByRole('link', { name: 'Студенты' }).click()
    const form = page.locator('form.create')
    await form.getByLabel('ФИО').fill('Мадина Ержанова')
    await form.getByLabel('Группа').fill('ПО-2203')
    await form.getByLabel('Логин').fill('m.erzhanova')
    await form.getByRole('button', { name: 'Добавить' }).click()
    await expect(page.locator('.otp').first()).toContainText('m.erzhanova')

    const row = page.getByRole('row', { name: /Мадина Ержанова/ })
    await row.getByRole('button', { name: 'Изменить' }).click()
    await page.locator('.inline-edit').getByLabel('Группа').fill('ПО-2301')
    await page.locator('.inline-edit').getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByRole('row', { name: /Мадина Ержанова/ })).toContainText('ПО-2301')
    expect(world.db.students.at(-1)!.group).toBe('ПО-2301')

    await page.getByRole('row', { name: /Мадина Ержанова/ }).getByRole('button', { name: 'Новый пароль' }).click()
    await expect(page.locator('.otp').last()).toContainText('m.erzhanova')
  })

  test('поиск по справочнику', async ({ page }) => {
    await page.goto('/admin/students')
    await page.getByPlaceholder('ФИО, группа или логин').fill('ВТ-2202')
    await expect(page.locator('tbody tr')).toHaveCount(1)
    await expect(page.locator('tbody')).toContainText('Нурлан Ахметов')
    await page.getByPlaceholder('ФИО, группа или логин').fill('нет-такого')
    await expect(page.getByRole('heading', { name: 'Никого не нашли' })).toBeVisible()
  })

  test('импорт CSV: создаёт хорошие строки, пропускает занятые логины и формулы', async ({ page, world }) => {
    await page.goto('/admin/students')
    const csv = ['name;group;login', 'Алия Кенжебаева;ПО-2301;a.kenzhebaeva', 'Дубль Логина;ПО-2201;a.saparova', '=HYPERLINK("x");ПО-2201;evil.user', 'Тимур Есенов;ПО-2203;t.esenov'].join('\n')
    await page.locator('input[type=file]').setInputFiles({ name: 'group.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') })
    const result = page.locator('.import .otp')
    await expect(result).toContainText('Добавлено: 2. Пропущено строк: 2.')
    await expect(result).toContainText('Строка 3: Такой логин уже занят')
    await expect(result).toContainText('Строка 4: Проверьте заполнение полей.')
    expect(world.db.users.some((u) => u.login === 'evil.user')).toBe(false)

    const download = page.waitForEvent('download')
    await result.getByRole('button', { name: 'Скачать логины и пароли' }).click()
    const file = await download
    expect(file.suggestedFilename()).toBe('students-credentials.csv')
  })
})

test.describe('листы', () => {
  test('открытие листа через поиск студента; повтор того же типа отклоняется', async ({ page, world }) => {
    const form = page.locator('form.create')
    await form.getByPlaceholder('ФИО или группа').fill('Айг')
    await page.getByRole('option', { name: /Айгерим Сапарова/ }).click()
    await form.getByLabel('Тип листа').selectOption('dorm')
    await expect(form).toContainText('Отделы по шаблону: Общежитие, Бухгалтерия')
    await form.getByRole('button', { name: 'Открыть лист' }).click()
    await expect(form).toContainText(/Лист № \d{4}-\d{4} открыт/)
    const created = world.db.sheets[0]
    expect(created.type).toBe('dorm')
    expect(created.marks.map((m) => m.department)).toEqual(['dorm', 'accounting'])

    await form.getByPlaceholder('ФИО или группа').fill('Айг')
    await page.getByRole('option', { name: /Айгерим Сапарова/ }).click()
    await form.getByLabel('Тип листа').selectOption('graduation')
    await form.getByRole('button', { name: 'Открыть лист' }).click()
    await expect(form).toContainText('У студента уже есть открытый лист этого типа')
  })

  test('без студента форма не отправляется', async ({ page }) => {
    await page.locator('form.create').getByRole('button', { name: 'Открыть лист' }).click()
    await expect(page.locator('form.create')).toContainText('Выберите студента.')
  })

  test('фильтр по статусу, поиск и переход в карточку', async ({ page }) => {
    await page.getByRole('tab', { name: 'Закрыт' }).click()
    await expect(page.locator('tbody tr')).toHaveCount(1)
    await expect(page.locator('tbody')).toContainText('Данияр Жумабеков')
    await page.getByRole('tab', { name: 'Все' }).click()
    await page.getByPlaceholder('ФИО, группа или №').fill('Нурлан')
    await expect(page.locator('tbody tr')).toHaveCount(1)
    await page.locator('tbody').getByRole('link').first().click()
    await expect(page).toHaveURL(/\/sheets\/\d{4}-\d{4}/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Ждём отметки 4 отделов')
  })

  test('пагинация на 25 листах и больше', async ({ page, world }) => {
    for (let i = 0; i < 30; i++) openSheetDirect(world.db, addStudent(world.db, `Студент Номер${i}`, 'ПО-2401', `st.n${i}`).id, 'leave')
    await page.reload()
    await expect(page.getByText('Страница 1 из 2')).toBeVisible()
    await expect(page.locator('tbody tr')).toHaveCount(25)
    await page.getByRole('button', { name: 'Дальше' }).click()
    await expect(page.getByText('Страница 2 из 2')).toBeVisible()
    await expect(page.locator('tbody tr')).toHaveCount(8)
    await expect(page.getByRole('button', { name: 'Дальше' })).toBeDisabled()
  })

  test('сводка считает открытые, долги и закрытые', async ({ page }) => {
    await expect(page.locator('.summary')).toHaveText('Открыто листов 2, из них с долгом 1. Закрыто в этом году 1.')
  })
})

test.describe('шаблоны и журнал', () => {
  test('шаблон меняется, последний отдел убрать нельзя', async ({ page, world }) => {
    await page.getByRole('link', { name: 'Шаблоны' }).click()
    await page.getByLabel('Выселение из общежития: Бухгалтерия').uncheck()
    await expect(page.getByText('Шаблон сохранён')).toBeVisible()
    expect(world.db.templates.dorm).toEqual(['dorm'])
    await page.getByLabel('Выселение из общежития: Общежитие').click()
    await expect(page.getByText('В шаблоне должен остаться хотя бы один отдел.')).toBeVisible()
    await expect(page.getByLabel('Выселение из общежития: Общежитие')).toBeChecked()
    expect(DEPTS.filter((d) => world.db.templates.graduation.includes(d))).toHaveLength(6)
  })

  test('журнал показывает действия и фильтруется по номеру листа', async ({ page, world }) => {
    await page.getByRole('link', { name: 'Журнал' }).click()
    await expect(page.locator('.audit li').first()).toBeVisible()
    const number = world.sheets.debtSheet.number
    await page.getByPlaceholder('Номер листа').fill(number)
    await expect(page.locator('.audit li')).toHaveCount(world.db.audit.filter((a) => a.sheet === number).length)
    await page.getByPlaceholder('Номер листа').fill('1999-0001')
    await expect(page.getByRole('heading', { name: 'Записей по этому номеру нет' })).toBeVisible()
  })
})
