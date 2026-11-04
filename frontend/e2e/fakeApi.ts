// Фейковый бэкенд для сквозных тестов. Живёт только в e2e/ и в продукт не попадает.
// Повторяет контракт docs/backend/openapi.yaml и правила из docs/backend/README.md (кроме отзыва
// сессий при сбросе и смене пароля из R19: это проверяйте на настоящем бэкенде),
// поэтому тесты заодно служат приёмкой: настоящий бэкенд должен вести себя так же.
import type { BrowserContext, Route } from '@playwright/test'

export const DEPTS = ['library', 'accounting', 'dorm', 'military', 'it', 'academic'] as const
type Dept = (typeof DEPTS)[number]
type SheetType = 'graduation' | 'expulsion' | 'transfer' | 'leave' | 'dorm'
type Role = 'student' | 'officer' | 'admin'

interface User {
  id: string
  login: string
  password: string
  name: string
  role: Role
  department?: Dept
  active: boolean
  mustChangePassword: boolean
  telegramLinked: boolean
}
interface Student {
  id: string
  userId: string
  group: string
}
interface Mark {
  department: Dept
  state: 'pending' | 'clear' | 'debt'
  note?: string
  due?: string
  at?: string
  by?: string
}
interface Sheet {
  number: string
  studentId: string
  type: SheetType
  createdAt: string
  closedAt?: string
  marks: Mark[]
}
interface Audit {
  at: string
  actor: string
  sheet: string
  department?: Dept
  action: 'create' | 'clear' | 'debt' | 'close'
  note?: string
}

export interface Db {
  users: User[]
  students: Student[]
  sheets: Sheet[]
  templates: Record<SheetType, Dept[]>
  audit: Audit[]
  seq: Record<number, number>
  loginFailures: Record<string, number>
  telegramCodes: Record<string, string>
  // управление сбоями из теста: следующий запрос по пути получит этот ответ
  faults: { match: RegExp; status: number; code?: string; times: number; delayMs?: number }[]
  requests: { method: string; path: string; body: unknown }[]
  idSeq: number
}

const today = () => new Date().toISOString().slice(0, 10)
const nowIso = () => new Date().toISOString()

export function emptyDb(): Db {
  return {
    users: [],
    students: [],
    sheets: [],
    templates: {
      graduation: [...DEPTS],
      expulsion: [...DEPTS],
      transfer: ['library', 'accounting', 'it', 'academic'],
      leave: ['library', 'accounting', 'academic'],
      dorm: ['dorm', 'accounting'],
    },
    audit: [],
    seq: {},
    loginFailures: {},
    telegramCodes: {},
    faults: [],
    requests: [],
    idSeq: 1,
  }
}

const nextId = (db: Db, prefix: string) => `${prefix}${db.idSeq++}`

export function addUser(db: Db, u: Partial<User> & Pick<User, 'login' | 'name' | 'role'>): User {
  const user: User = { id: nextId(db, 'u'), password: 'password-123', active: true, mustChangePassword: false, telegramLinked: false, ...u }
  db.users.push(user)
  return user
}

export function addStudent(db: Db, name: string, group: string, login: string, extra: Partial<User> = {}): Student {
  const user = addUser(db, { login, name, role: 'student', ...extra })
  const st: Student = { id: nextId(db, 's'), userId: user.id, group }
  db.students.push(st)
  return st
}

export function openSheetDirect(db: Db, studentId: string, type: SheetType, marks?: Partial<Record<Dept, Omit<Mark, 'department'>>>, daysAgo = 1): Sheet {
  const year = new Date().getFullYear()
  db.seq[year] = (db.seq[year] ?? 0) + 1
  const sheet: Sheet = {
    number: `${year}-${String(db.seq[year]).padStart(4, '0')}`,
    studentId,
    type,
    createdAt: new Date(Date.now() - daysAgo * 864e5).toISOString(),
    marks: db.templates[type].map((d) => ({ department: d, state: 'pending', ...(marks?.[d] ?? {}) })),
  }
  if (sheet.marks.every((m) => m.state === 'clear')) sheet.closedAt = nowIso()
  db.sheets.unshift(sheet)
  db.audit.unshift({ at: sheet.createdAt, actor: 'Учебная часть', sheet: sheet.number, action: 'create' })
  return sheet
}

// Стандартный набор: администратор, по сотруднику на отдел, три студента.
export function seed(db: Db = emptyDb()) {
  const admin = addUser(db, { login: 'admin', name: 'Жанар Абдрахманова', role: 'admin' })
  const officers = Object.fromEntries(
    DEPTS.map((d, i) => [d, addUser(db, { login: `off.${d}`, name: ['Гульнара Нуртазина', 'Евгений Ким', 'Серик Байжанов', 'Андрей Петренко', 'Даурен Оспанов', 'Айжан Сейтова'][i], role: 'officer', department: d })]),
  ) as Record<Dept, User>
  const aigerim = addStudent(db, 'Айгерим Сапарова', 'ПО-2201', 'a.saparova')
  const daniyar = addStudent(db, 'Данияр Жумабеков', 'ПО-2201', 'd.zhumabekov')
  const nurlan = addStudent(db, 'Нурлан Ахметов', 'ВТ-2202', 'n.akhmetov')
  const clearBy = (d: Dept) => ({ state: 'clear' as const, at: nowIso(), by: officers[d].name })
  const debtSheet = openSheetDirect(db, aigerim.id, 'graduation', {
    library: { state: 'debt', note: 'Вернуть книгу «Python. Основы программирования», инв. № 4471', due: new Date(Date.now() + 4 * 864e5).toISOString().slice(0, 10), at: nowIso(), by: officers.library.name },
    accounting: clearBy('accounting'),
    dorm: clearBy('dorm'),
    military: clearBy('military'),
    academic: clearBy('academic'),
  })
  const closedSheet = openSheetDirect(db, daniyar.id, 'graduation', Object.fromEntries(DEPTS.map((d) => [d, clearBy(d)])))
  const pendingSheet = openSheetDirect(db, nurlan.id, 'transfer')
  return { db, admin, officers, students: { aigerim, daniyar, nurlan }, sheets: { debtSheet, closedSheet, pendingSheet } }
}

// ---------- представление объектов так, как их отдаёт API ----------

const userOf = (db: Db, id: string) => db.users.find((u) => u.id === id)!
const studentUser = (db: Db, s: Student) => userOf(db, s.userId)

function status(s: Sheet) {
  if (s.closedAt) return 'closed'
  if (s.marks.some((m) => m.state === 'debt')) return 'debt'
  if (s.marks.some((m) => m.state === 'clear')) return 'progress'
  return 'created'
}

function sheetView(db: Db, s: Sheet) {
  const st = db.students.find((x) => x.id === s.studentId)!
  return {
    number: s.number,
    type: s.type,
    status: status(s),
    createdAt: s.createdAt,
    closedAt: s.closedAt ?? null,
    student: { id: st.id, name: studentUser(db, st).name, group: st.group },
    marks: DEPTS.map((d) => s.marks.find((m) => m.department === d)).filter(Boolean),
  }
}

const userView = (db: Db, u: User) => {
  const st = db.students.find((s) => s.userId === u.id)
  return {
    id: u.id,
    name: u.name,
    login: u.login,
    role: u.role,
    departmentId: u.department,
    studentId: st?.id,
    group: st?.group,
    active: u.active,
    telegramLinked: u.telegramLinked,
    mustChangePassword: u.mustChangePassword,
  }
}

const studentView = (db: Db, s: Student) => {
  const u = studentUser(db, s)
  return { id: s.id, userId: u.id, name: u.name, group: s.group, login: u.login, activeSheets: db.sheets.filter((x) => x.studentId === s.id && !x.closedAt).length }
}

const shortName = (full: string) => {
  const [first, last] = full.split(' ')
  return last ? `${first} ${last[0]}.` : first
}

const page = <T>(items: T[], q: URLSearchParams) => {
  const p = Number(q.get('page') ?? 1)
  const size = Math.min(Number(q.get('pageSize') ?? 25), 100)
  return { items: items.slice((p - 1) * size, p * size), total: items.length }
}

const LOGIN_RE = /^[a-z0-9._-]{3,64}$/
const tempPassword = () => `tmp-${Math.random().toString(36).slice(2, 10)}`

class ApiFail {
  status: number
  code: string
  field?: string
  constructor(status: number, code: string, field?: string) {
    this.status = status
    this.code = code
    this.field = field
  }
}
const fail = (status: number, code: string, field?: string): never => {
  throw new ApiFail(status, code, field)
}

// Отметка с правилами R5–R10, R12. Используется и одиночной отметкой, и массовой.
function applyMark(db: Db, user: User, number: string, dept: Dept, body: { state?: string; note?: string; due?: string }) {
  if (user.role !== 'officer' || user.department !== dept) fail(403, 'forbidden')
  const sheet = db.sheets.find((s) => s.number === number) ?? fail(404, 'not_found')
  if (sheet.closedAt) fail(409, 'closed')
  const mark = sheet.marks.find((m) => m.department === dept) ?? fail(400, 'foreign_dept')
  const at = nowIso()
  if (body.state === 'debt') {
    const note = (body.note ?? '').trim()
    if (!note) fail(400, 'note_required', 'note')
    if (note.length > 200) fail(400, 'note_too_long', 'note')
    if (body.due && body.due < today()) fail(400, 'due_past', 'due')
    if (mark.state === 'debt' && mark.note === note && (mark.due ?? '') === (body.due ?? '')) return sheet
    Object.assign(mark, { state: 'debt', note, due: body.due || undefined, at, by: user.name })
    db.audit.unshift({ at, actor: user.name, sheet: number, department: dept, action: 'debt', note })
  } else if (body.state === 'clear') {
    if (mark.state === 'clear') return sheet
    Object.assign(mark, { state: 'clear', note: undefined, due: undefined, at, by: user.name })
    db.audit.unshift({ at, actor: user.name, sheet: number, department: dept, action: 'clear' })
  } else fail(400, 'validation', 'state')
  if (sheet.marks.every((m) => m.state === 'clear')) {
    sheet.closedAt = at
    db.audit.unshift({ at, actor: 'Система', sheet: number, action: 'close' })
  }
  return sheet
}

function parseCsv(text: string) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  const sep = lines[0]?.includes(';') ? ';' : ','
  const rows = lines.map((l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, '')))
  return rows[0]?.[0] === 'name' ? rows.slice(1).map((r, i) => ({ r, line: i + 2 })) : rows.map((r, i) => ({ r, line: i + 1 }))
}

// ---------- обработчик запросов ----------

export async function attachFakeApi(context: BrowserContext, db: Db, opts: { loginAs?: string } = {}) {
  // сессия своя у каждого контекста браузера: можно держать открытыми студента и сотрудника одновременно
  let sessionUserId: string | null = opts.loginAs ? (db.users.find((u) => u.login === opts.loginAs)?.id ?? null) : null
  const session = {
    expire: () => {
      sessionUserId = null
    },
  }

  await context.route('**/api/v1/**', async (route: Route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname.replace(/^\/api\/v1/, '')
    const method = req.method()
    const isForm = (req.headers()['content-type'] ?? '').startsWith('multipart/form-data')
    let body: Record<string, unknown> = {}
    if (!isForm) {
      try {
        body = req.postDataJSON() ?? {}
      } catch {
        body = {}
      }
    }
    db.requests.push({ method, path, body })

    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: data === undefined ? '' : JSON.stringify(data) })
    const err = (status: number, code: string, field?: string, headers: Record<string, string> = {}) =>
      route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify({ error: { code, message: code, field } }) })

    const fault = db.faults.find((f) => f.match.test(path) && f.times > 0)
    if (fault) {
      fault.times--
      if (fault.delayMs) await new Promise((r) => setTimeout(r, fault.delayMs))
      if (fault.status === 0) return route.abort('failed')
      if (fault.status !== 200) return fault.code ? err(fault.status, fault.code) : route.fulfill({ status: fault.status, body: '' })
    }

    // защита от CSRF: изменяющие запросы обязаны нести заголовок
    if (method !== 'GET' && req.headers()['x-requested-with'] !== 'fetch') return err(403, 'forbidden')

    try {
      if (path === '/auth/login' && method === 'POST') {
        const login = String(body.login ?? '')
        if (!login || !body.password) return err(400, 'validation')
        if ((db.loginFailures[login] ?? 0) >= 5) return err(429, 'rate_limited', undefined, { 'Retry-After': '60' })
        const u = db.users.find((x) => x.login === login && x.password === body.password && x.active)
        if (!u) {
          db.loginFailures[login] = (db.loginFailures[login] ?? 0) + 1
          return err(401, 'login_failed')
        }
        db.loginFailures[login] = 0
        sessionUserId = u.id
        return json(userView(db, u))
      }
      if (path.startsWith('/public/verify/') && method === 'GET') {
        const s = db.sheets.find((x) => x.number === decodeURIComponent(path.split('/')[3]))
        if (!s) return json({ found: false, closed: false })
        const name = shortName(studentUser(db, db.students.find((x) => x.id === s.studentId)!).name)
        return s.closedAt ? json({ found: true, closed: true, shortName: name, number: s.number, type: s.type, closedAt: s.closedAt, departments: s.marks.map((m) => m.department) }) : json({ found: true, closed: false, shortName: name })
      }

      const user = sessionUserId ? db.users.find((u) => u.id === sessionUserId && u.active) : undefined
      if (!user) return err(401, 'unauthorized')
      const need = (...roles: Role[]) => roles.includes(user.role) || fail(403, 'forbidden')

      if (path === '/auth/me') return json(userView(db, user))
      if (path === '/auth/logout') {
        sessionUserId = null
        return json(undefined, 204)
      }
      if (path === '/auth/password' && method === 'POST') {
        if (body.current !== user.password) fail(400, 'wrong_password', 'current')
        if (String(body.next ?? '').length < 8) fail(400, 'weak_password', 'next')
        user.password = String(body.next)
        user.mustChangePassword = false
        return json(undefined, 204)
      }

      if (path === '/sheets/mine') {
        need('student')
        const st = db.students.find((s) => s.userId === user.id)!
        // открытые сверху (новые первыми), затем закрытые (недавно закрытые первыми)
        const mine = db.sheets.filter((s) => s.studentId === st.id).sort((a, b) => Number(!!a.closedAt) - Number(!!b.closedAt) || (b.closedAt ?? b.createdAt).localeCompare(a.closedAt ?? a.createdAt))
        return json(mine.map((s) => sheetView(db, s)))
      }
      if (path === '/sheets/summary') {
        need('admin')
        const open = db.sheets.filter((s) => !s.closedAt)
        return json({ active: open.length, withDebt: open.filter((s) => status(s) === 'debt').length, closed: db.sheets.filter((s) => s.closedAt?.startsWith(String(new Date().getFullYear()))).length })
      }
      if (path === '/sheets' && method === 'GET') {
        need('officer', 'admin')
        const q = url.searchParams
        const dept = user.role === 'officer' ? user.department! : (q.get('department') as Dept | null)
        if (q.get('markState') && !dept) fail(400, 'validation', 'markState')
        const needle = (q.get('q') ?? '').toLowerCase()
        let list = db.sheets
        if (dept) list = list.filter((s) => s.marks.some((m) => m.department === dept && (!q.get('markState') || m.state === q.get('markState'))))
        if (q.get('status')) list = list.filter((s) => status(s) === q.get('status'))
        if (q.get('type')) list = list.filter((s) => s.type === q.get('type'))
        if (needle) list = list.filter((s) => {
          const v = sheetView(db, s)
          return [v.student.name, v.student.group, v.number].some((x) => x.toLowerCase().includes(needle))
        })
        return json(page(list.map((s) => sheetView(db, s)), q))
      }
      if (path === '/sheets' && method === 'POST') {
        need('admin')
        const st = db.students.find((s) => s.id === body.studentId) ?? fail(404, 'not_found')
        const type = body.type as SheetType
        if (!db.templates[type]) fail(400, 'validation', 'type')
        if (db.sheets.some((s) => s.studentId === st.id && s.type === type && !s.closedAt)) fail(409, 'duplicate', 'type')
        const s = openSheetDirect(db, st.id, type, undefined, 0)
        db.audit[0].actor = user.name
        return json(sheetView(db, s), 201)
      }
      const markMatch = path.match(/^\/sheets\/([^/]+)\/marks\/([a-z]+)$/)
      if (markMatch && method === 'PUT') return json(sheetView(db, applyMark(db, user, decodeURIComponent(markMatch[1]), markMatch[2] as Dept, body)))
      const sheetMatch = path.match(/^\/sheets\/([^/]+)$/)
      if (sheetMatch && method === 'GET') {
        need('officer', 'admin')
        const s = db.sheets.find((x) => x.number === decodeURIComponent(sheetMatch[1]))
        if (!s || (user.role === 'officer' && !s.marks.some((m) => m.department === user.department))) fail(404, 'not_found')
        return json({ ...sheetView(db, s!), audit: db.audit.filter((a) => a.sheet === s!.number) })
      }

      if (path === '/queue/counts') {
        need('officer')
        const counts = { pending: 0, debt: 0, clear: 0 }
        for (const s of db.sheets) {
          const m = s.marks.find((x) => x.department === user.department)
          if (m) counts[m.state]++
        }
        return json(counts)
      }
      if (path === '/queue/clear' && method === 'POST') {
        need('officer')
        const updated: string[] = []
        const failed: { number: string; code: string }[] = []
        for (const n of (body.numbers as string[]) ?? []) {
          try {
            applyMark(db, user, n, user.department!, { state: 'clear' })
            updated.push(n)
          } catch (e) {
            failed.push({ number: n, code: e instanceof ApiFail ? e.code : 'server' })
          }
        }
        return json({ updated, failed })
      }

      if (path === '/students' && method === 'GET') {
        need('admin')
        const needle = (url.searchParams.get('q') ?? '').toLowerCase()
        const list = db.students
          .map((s) => studentView(db, s))
          .filter((s) => !needle || [s.name, s.group, s.login].some((x) => x.toLowerCase().includes(needle)))
          .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
        return json(page(list, url.searchParams))
      }
      if (path === '/students' && method === 'POST') {
        need('admin')
        const name = String(body.name ?? '').trim()
        const login = String(body.login ?? '')
        if (name.length < 3) fail(400, 'validation', 'name')
        if (!LOGIN_RE.test(login)) fail(400, 'validation', 'login')
        if (db.users.some((u) => u.login === login)) fail(409, 'login_taken', 'login')
        const pass = tempPassword()
        const st = addStudent(db, name, String(body.group ?? ''), login, { password: pass, mustChangePassword: true })
        return json({ student: studentView(db, st), temporaryPassword: pass }, 201)
      }
      const stMatch = path.match(/^\/students\/([^/]+)$/)
      if (stMatch && method === 'PATCH') {
        need('admin')
        const st = db.students.find((s) => s.id === stMatch[1]) ?? fail(404, 'not_found')
        if (body.name !== undefined) studentUser(db, st).name = String(body.name)
        if (body.group !== undefined) st.group = String(body.group)
        return json(studentView(db, st))
      }
      if (path === '/students/import' && method === 'POST') {
        need('admin')
        const raw = req.postDataBuffer()?.toString('utf8') ?? ''
        const file = raw.split(/\r?\n\r?\n/).slice(1).join('\n\n').split(/\r?\n--/)[0] ?? ''
        const created: unknown[] = []
        const skipped: { line: number; code: string }[] = []
        for (const { r, line } of parseCsv(file)) {
          const [name = '', group = '', login = ''] = r
          if ([name, group, login].some((c) => /^[=+\-@]/.test(c))) {
            skipped.push({ line, code: 'validation' })
            continue
          }
          if (name.length < 3 || group.length < 2 || !LOGIN_RE.test(login)) {
            skipped.push({ line, code: 'validation' })
            continue
          }
          if (db.users.some((u) => u.login === login)) {
            skipped.push({ line, code: 'login_taken' })
            continue
          }
          const pass = tempPassword()
          const st = addStudent(db, name, group, login, { password: pass, mustChangePassword: true })
          created.push({ student: studentView(db, st), temporaryPassword: pass })
        }
        return json({ created, skipped })
      }

      if (path === '/users' && method === 'GET') {
        need('admin')
        const staff = db.users.filter((u) => u.role !== 'student').sort((a, b) => a.name.localeCompare(b.name, 'ru'))
        return json(page(staff.map((u) => userView(db, u)), url.searchParams))
      }
      if (path === '/users' && method === 'POST') {
        need('admin')
        const name = String(body.name ?? '').trim()
        const login = String(body.login ?? '')
        if (name.length < 3) fail(400, 'validation', 'name')
        if (!LOGIN_RE.test(login)) fail(400, 'validation', 'login')
        if (body.role !== 'officer' && body.role !== 'admin') fail(400, 'validation', 'role')
        if (body.role === 'officer' && !body.departmentId) fail(400, 'department_required', 'departmentId')
        if (db.users.some((u) => u.login === login)) fail(409, 'login_taken', 'login')
        const pass = tempPassword()
        const u = addUser(db, { name, login, role: body.role as Role, department: body.role === 'officer' ? (body.departmentId as Dept) : undefined, password: pass, mustChangePassword: true })
        return json({ user: userView(db, u), temporaryPassword: pass }, 201)
      }
      const userMatch = path.match(/^\/users\/([^/]+)(\/reset-password)?$/)
      if (userMatch) {
        need('admin')
        const target = db.users.find((u) => u.id === userMatch[1]) ?? fail(404, 'not_found')
        if (userMatch[2] && method === 'POST') {
          if (target.id === user.id) fail(403, 'forbidden')
          const pass = tempPassword()
          Object.assign(target, { password: pass, mustChangePassword: true })
          return json({ temporaryPassword: pass })
        }
        if (method === 'PATCH') {
          if (target.role === 'student') fail(404, 'not_found')
          if (body.active === false && target.id === user.id) fail(403, 'forbidden')
          if (body.departmentId !== undefined && target.role !== 'officer') fail(400, 'validation', 'departmentId')
          if (body.name !== undefined) target.name = String(body.name)
          if (body.departmentId !== undefined) target.department = body.departmentId as Dept
          if (body.active !== undefined) target.active = Boolean(body.active)
          return json(userView(db, target))
        }
      }

      if (path === '/templates' && method === 'GET') {
        need('admin')
        return json(db.templates)
      }
      const tplMatch = path.match(/^\/templates\/([a-z]+)$/)
      if (tplMatch && method === 'PUT') {
        need('admin')
        const depts = (body.departments as Dept[]) ?? []
        if (!depts.length) fail(400, 'no_depts')
        db.templates[tplMatch[1] as SheetType] = DEPTS.filter((d) => depts.includes(d))
        return json(db.templates)
      }
      if (path === '/audit') {
        need('admin')
        const sheet = url.searchParams.get('sheet')
        return json(page(db.audit.filter((a) => !sheet || a.sheet.includes(sheet)), url.searchParams))
      }

      if (path === '/telegram/link') {
        need('student')
        if (method === 'DELETE') {
          user.telegramLinked = false
          return json(undefined, 204)
        }
        // новый код заменяет прежний код этого студента
        for (const [c, id] of Object.entries(db.telegramCodes)) if (id === user.id) delete db.telegramCodes[c]
        const code = String(1000 + Math.floor(Math.random() * 9000))
        db.telegramCodes[code] = user.id
        return json({ code, botUrl: `https://t.me/aitu_test_bot?start=${code}`, expiresAt: new Date(Date.now() + 9e5).toISOString() })
      }

      return err(404, 'not_found')
    } catch (e) {
      if (e instanceof ApiFail) return err(e.status, e.code, e.field)
      return err(500, 'server')
    }
  })

  return session
}

// Имитация бота: студент отправил код боту.
export function botReceivesCode(db: Db, code: string) {
  const userId = db.telegramCodes[code]
  if (userId) db.users.find((u) => u.id === userId)!.telegramLinked = true
}
