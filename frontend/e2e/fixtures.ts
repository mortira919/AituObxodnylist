// Общие фикстуры: свежая база на каждый тест и вход под нужной ролью.
import { test as base, expect, type Page } from '@playwright/test'
import { attachFakeApi, seed } from './fakeApi'

type Seeded = ReturnType<typeof seed>

export const test = base.extend<{ world: Seeded; api: Awaited<ReturnType<typeof attachFakeApi>> }>({
  world: async ({}, use) => {
    await use(seed())
  },
  api: async ({ context, world }, use) => {
    await use(await attachFakeApi(context, world.db))
  },
})

export { expect }

// Вход через настоящую форму, как это делает человек.
export async function login(page: Page, login: string, password = 'password-123') {
  await page.goto('/login')
  await page.getByLabel('Логин').fill(login)
  await page.getByLabel('Пароль', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Войти' }).click()
}

export async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, 'страница не должна листаться вбок').toBeLessThanOrEqual(0)
}
