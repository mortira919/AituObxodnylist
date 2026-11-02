// HTTP-реализация порта ClearanceApi. Сессия живёт в httpOnly-cookie, которую ставит бэкенд,
// поэтому токенов в коде нет: браузер сам отправляет cookie с каждым запросом.
import type { ClearanceApi } from '../application/ports'
import { DomainError, type ErrorCode } from '../domain/clearance'

type Query = Record<string, string | number | undefined>

export function createHttpApi(baseUrl: string, onUnauthorized: () => void = () => {}): ClearanceApi {
  async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
    const qs = query ? new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== '') as [string, string][]).toString() : ''
    const isForm = body instanceof FormData
    let res: Response
    try {
      res = await fetch(`${baseUrl}${path}${qs ? `?${qs}` : ''}`, {
        method,
        credentials: 'include',
        // заголовок X-Requested-With бэкенд проверяет как простую защиту от CSRF
        headers: { Accept: 'application/json', 'X-Requested-With': 'fetch', ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
        body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      })
    } catch {
      throw new DomainError('network')
    }
    if (res.status === 204) return undefined as T
    const data = await res.json().catch(() => null)
    if (res.ok) return data as T

    const code = (data?.error?.code as ErrorCode | undefined) ?? (res.status >= 500 ? 'server' : 'validation')
    // истёкшая сессия посреди работы: отправляем на вход, но не при проверке «кто я»
    if (res.status === 401 && path !== '/auth/me' && path !== '/auth/login') onUnauthorized()
    throw new DomainError(code, data?.error?.field)
  }

  const get = <T>(path: string, query?: Query) => request<T>('GET', path, undefined, query)
  const enc = encodeURIComponent

  return {
    login: (login, password) => request('POST', '/auth/login', { login, password }),
    logout: () => request('POST', '/auth/logout'),
    me: () => get<Awaited<ReturnType<ClearanceApi['me']>>>('/auth/me').catch((e) => (e instanceof DomainError && e.code === 'unauthorized' ? null : Promise.reject(e))),
    changePassword: (current, next) => request('POST', '/auth/password', { current, next }),

    listSheets: (q) => get('/sheets', { ...q }),
    mySheets: () => get('/sheets/mine'),
    summary: () => get('/sheets/summary'),
    getSheet: (number) => get(`/sheets/${enc(number)}`),
    createSheet: (studentId, type) => request('POST', '/sheets', { studentId, type }),
    setMark: (number, dept, input) => request('PUT', `/sheets/${enc(number)}/marks/${dept}`, input),

    queueCounts: () => get('/queue/counts'),
    bulkClear: (numbers) => request('POST', '/queue/clear', { numbers }),

    listStudents: (q) => get('/students', { ...q }),
    createStudent: (input) => request('POST', '/students', input),
    updateStudent: (id, patch) => request('PATCH', `/students/${enc(id)}`, patch),
    importStudents: (file) => {
      const form = new FormData()
      form.append('file', file)
      return request('POST', '/students/import', form)
    },
    listStaff: (q) => get('/users', { ...q }),
    createStaff: (input) => request('POST', '/users', input),
    updateStaff: (id, patch) => request('PATCH', `/users/${enc(id)}`, patch),
    resetPassword: (userId) => request('POST', `/users/${enc(userId)}/reset-password`),

    getTemplates: () => get('/templates'),
    setTemplate: (type, departments) => request('PUT', `/templates/${type}`, { departments }),
    listAudit: (q) => get('/audit', { ...q }),

    telegramLink: () => request('POST', '/telegram/link'),
    telegramUnlink: () => request('DELETE', '/telegram/link'),
    verify: (number) => get(`/public/verify/${enc(number)}`),
  }
}
