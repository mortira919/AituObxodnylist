// Вход, выход, роли, временный пароль и истёкшая сессия.
import { expect, login, test } from './fixtures'

test.describe('вход', () => {
  test('каждая роль после входа попадает в свой кабинет', async ({ page, api }) => {
    void api
    for (const [who, url, heading] of [
      ['admin', '/admin', /Открыто листов/],
      ['off.library', '/office', /Библиотека/],
      ['a.saparova', '/student', /Держит: Библиотека/],
    ] as const) {
      await login(page, who)
      await expect(page).toHaveURL(url)
      await expect(page.locator('main')).toContainText(heading)
      await page.getByRole('button', { name: 'Выйти' }).click()
      await expect(page).toHaveURL('/login')
    }
  })

  test('пустая форма и неверный пароль объясняют ошибку, пароль стирается', async ({ page, api }) => {
    void api
    await page.goto('/login')
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page.getByRole('alert')).toHaveText('Введите логин и пароль.')
    await page.getByLabel('Логин').fill('admin')
    await page.getByLabel('Пароль', { exact: true }).fill('wrong-password')
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page.getByRole('alert')).toHaveText('Неверный логин или пароль.')
    await expect(page.getByLabel('Пароль', { exact: true })).toHaveValue('')
    await expect(page.getByLabel('Логин')).toHaveValue('admin')
  })

  test('после пяти неудачных попыток сервер ограничивает вход, интерфейс говорит подождать', async ({ page, api }) => {
    void api
    await page.goto('/login')
    for (let i = 0; i < 6; i++) {
      await page.getByLabel('Логин').fill('admin')
      await page.getByLabel('Пароль', { exact: true }).fill(`bad-${i}`)
      await page.getByRole('button', { name: 'Войти' }).click()
      await expect(page.getByRole('alert')).toBeVisible()
    }
    await expect(page.getByRole('alert')).toContainText('Слишком много попыток')
  })

  test('заблокированный сотрудник не может войти', async ({ page, world, api }) => {
    void api
    world.officers.library.active = false
    await login(page, 'off.library')
    await expect(page.getByRole('alert')).toHaveText('Неверный логин или пароль.')
  })
})

test.describe('доступ к разделам', () => {
  test('без входа кабинет уводит на вход и возвращает обратно после него', async ({ page, api }) => {
    void api
    await page.goto('/admin/students')
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Fstudents/)
    await page.getByLabel('Логин').fill('admin')
    await page.getByLabel('Пароль', { exact: true }).fill('password-123')
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page).toHaveURL('/admin/students')
  })

  test('ссылка на чужой сайт в next игнорируется', async ({ page, api }) => {
    void api
    await page.goto('/login?next=//evil.example/steal')
    await page.getByLabel('Логин').fill('admin')
    await page.getByLabel('Пароль', { exact: true }).fill('password-123')
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page).toHaveURL('/admin')
  })

  test('студент на странице учебной части видит «нет доступа» внутри своего кабинета', async ({ page, api }) => {
    void api
    await login(page, 'a.saparova')
    await page.goto('/admin/staff')
    await expect(page.getByRole('heading', { name: 'Нет доступа к этому разделу' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible()
    await page.getByRole('link', { name: 'В мой кабинет' }).click()
    await expect(page).toHaveURL('/student')
  })

  test('сотрудник отдела не открывает кабинет студента и справочники', async ({ page, api }) => {
    void api
    await login(page, 'off.it')
    for (const url of ['/student', '/admin', '/admin/templates']) {
      await page.goto(url)
      await expect(page.getByRole('heading', { name: 'Нет доступа к этому разделу' })).toBeVisible()
    }
  })

  test('навигация показывает только разделы своей роли', async ({ page, api }) => {
    void api
    await login(page, 'admin')
    const nav = page.getByRole('navigation', { name: 'Разделы' })
    await expect(nav.getByRole('link')).toHaveText(['Листы', 'Студенты', 'Сотрудники', 'Шаблоны', 'Журнал'])
    await page.getByRole('button', { name: 'Выйти' }).click()
    await login(page, 'off.dorm')
    await expect(page.getByRole('navigation', { name: 'Разделы' }).getByRole('link')).toHaveText(['Очередь отдела'])
  })

  test('истёкшая сессия посреди работы уводит на вход с возвратом', async ({ page, api }) => {
    await login(page, 'off.library')
    await expect(page.getByRole('heading', { name: 'Библиотека' })).toBeVisible()
    api.expire()
    await page.getByRole('row', { name: /Нурлан Ахметов/ }).getByRole('button', { name: 'Нет задолженности' }).click()
    await expect(page).toHaveURL(/\/login\?next=%2Foffice/)
  })
})

test.describe('временный пароль', () => {
  test('новый сотрудник обязан сменить пароль, прежде чем работать', async ({ page, world, api }) => {
    void api
    world.officers.it.mustChangePassword = true
    await login(page, 'off.it')
    await expect(page).toHaveURL('/account')
    await expect(page.getByText('Вы вошли с временным паролем')).toBeVisible()
    await page.goto('/office')
    await expect(page).toHaveURL('/account')

    const current = page.getByLabel('Текущий пароль')
    const next = page.getByLabel('Новый пароль', { exact: true })
    const repeat = page.getByLabel('Повторите новый пароль')
    const submit = page.getByRole('button', { name: 'Сменить пароль' })

    await current.fill('password-123')
    await next.fill('short')
    await repeat.fill('short')
    await submit.click()
    await expect(page.getByRole('alert')).toHaveText('Пароль должен быть не короче 8 символов.')

    await next.fill('new-password-1')
    await repeat.fill('new-password-2')
    await submit.click()
    await expect(page.getByRole('alert')).toHaveText('Пароли не совпадают.')

    await current.fill('wrong-current')
    await repeat.fill('new-password-1')
    await submit.click()
    await expect(page.getByRole('alert')).toHaveText('Текущий пароль введён неверно.')

    await current.fill('password-123')
    await submit.click()
    await expect(page.getByText('Пароль изменён.')).toBeVisible()
    await page.goto('/office')
    await expect(page.getByRole('heading', { name: 'IT-отдел' })).toBeVisible()
  })
})
