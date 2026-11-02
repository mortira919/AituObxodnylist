// HTTP-клиент: правильные запросы и перевод ответов сервера в доменные ошибки.
import { afterEach, expect, test, vi } from 'vitest'
import { DomainError } from '../domain/clearance'
import { createHttpApi } from './httpApi'

const reply = (status: number, body?: unknown) =>
  vi.fn().mockResolvedValue({ status, ok: status < 400, json: () => (body === undefined ? Promise.reject() : Promise.resolve(body)) })

afterEach(() => vi.unstubAllGlobals())

test('отметка уходит PUT-запросом с cookie сессии и защитным заголовком', async () => {
  const fetch = reply(200, { number: '2026-0142' })
  vi.stubGlobal('fetch', fetch)
  await createHttpApi('/api/v1').setMark('2026-0142', 'library', { state: 'clear' })
  const [url, init] = fetch.mock.calls[0]
  expect(url).toBe('/api/v1/sheets/2026-0142/marks/library')
  expect(init).toMatchObject({ method: 'PUT', credentials: 'include', body: '{"state":"clear"}' })
  expect(init.headers['X-Requested-With']).toBe('fetch')
})

test('пустые параметры не попадают в строку запроса', async () => {
  const fetch = reply(200, { items: [], total: 0 })
  vi.stubGlobal('fetch', fetch)
  await createHttpApi('/api/v1').listSheets({ q: '', status: 'debt', page: 2 })
  expect(fetch.mock.calls[0][0]).toBe('/api/v1/sheets?status=debt&page=2')
})

test('код ошибки сервера становится DomainError с полем формы', async () => {
  vi.stubGlobal('fetch', reply(409, { error: { code: 'duplicate', message: 'x', field: 'type' } }))
  await expect(createHttpApi('/api/v1').createSheet('s1', 'graduation')).rejects.toMatchObject({ code: 'duplicate', field: 'type' })
})

test('401 посреди работы отправляет на вход, а /auth/me просто возвращает null', async () => {
  const onUnauthorized = vi.fn()
  vi.stubGlobal('fetch', reply(401, { error: { code: 'unauthorized', message: 'x' } }))
  const api = createHttpApi('/api/v1', onUnauthorized)
  expect(await api.me()).toBeNull()
  expect(onUnauthorized).not.toHaveBeenCalled()
  await expect(api.mySheets()).rejects.toBeInstanceOf(DomainError)
  expect(onUnauthorized).toHaveBeenCalledOnce()
})

test('нет сети и 500 без тела дают понятные коды', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
  await expect(createHttpApi('').summary()).rejects.toMatchObject({ code: 'network' })
  vi.stubGlobal('fetch', reply(502))
  await expect(createHttpApi('').summary()).rejects.toMatchObject({ code: 'server' })
})
