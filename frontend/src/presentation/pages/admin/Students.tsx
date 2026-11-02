// Учебная часть `/admin/students`: справочник студентов, добавление по одному и импорт из CSV.
import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react'
import { Search, Upload } from 'lucide-react'
import { DomainError, type ErrorCode, type Student } from '../../../domain/clearance'
import type { StudentInput } from '../../../application/ports'
import { Empty, LoadError, OneTimePassword, Pager, Skeleton } from '../../components/Feedback'
import { AppShell, Spinner } from '../../components/Shell'
import { errorField, useErrorText } from '../../errorText'
import { useT } from '../../i18n'
import { useDebounced, useQuery, useService } from '../../services'

const PAGE_SIZE = 25

function AddStudent({ onAdded }: { onAdded: () => void }) {
  const t = useT()
  const errorText = useErrorText()
  const service = useService()
  const empty: StudentInput = { name: '', group: '', login: '' }
  const [form, setForm] = useState(empty)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [issued, setIssued] = useState<{ login: string; password: string } | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await service.createStudent({ ...form, login: form.login.trim().toLowerCase() })
      setIssued({ login: res.student.login, password: res.temporaryPassword })
      setForm(empty)
      onAdded()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }
  const field = errorField(error)

  return (
    <form className="create" onSubmit={submit} noValidate>
      <h2>{t('Добавить студента', 'Студент қосу')}</h2>
      <div className="create-fields">
        <div className="field field--grow">
          <label htmlFor="s-name">{t('ФИО', 'Аты-жөні')}</label>
          <input id="s-name" value={form.name} aria-invalid={field === 'name'} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="s-group">{t('Группа', 'Тобы')}</label>
          <input id="s-group" value={form.group} placeholder={t('например, ПО-2201', 'мысалы, ПО-2201')} aria-invalid={field === 'group'} onChange={(e) => setForm({ ...form, group: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="s-login">{t('Логин', 'Логин')}</label>
          <input id="s-login" value={form.login} autoCapitalize="none" spellCheck={false} placeholder={t('например, a.saparova', 'мысалы, a.saparova')} aria-invalid={field === 'login'} onChange={(e) => setForm({ ...form, login: e.target.value })} />
        </div>
        <button className="btn btn--primary" type="submit" disabled={busy} aria-busy={busy}>
          {busy && <Spinner />}
          {t('Добавить', 'Қосу')}
        </button>
      </div>
      <p className="create-hint muted">{t('Логин: латиница, цифры, точка, дефис, 3–64 символа.', 'Логин: латын әріптері, сандар, нүкте, сызықша, 3–64 таңба.')}</p>
      {error != null && (
        <p className="field-error" role="alert">
          {errorText(error)}
        </p>
      )}
      {issued && <OneTimePassword login={issued.login} password={issued.password} onClose={() => setIssued(null)} />}
    </form>
  )
}

// CSV с выданными паролями собираем в браузере: на сервере пароли в открытом виде не хранятся.
function downloadCredentials(rows: { student: Student; temporaryPassword: string }[]) {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
  const csv = ['name;group;login;password', ...rows.map((r) => [r.student.name, r.student.group, r.student.login, r.temporaryPassword].map(esc).join(';'))].join('\n')
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'students-credentials.csv'
  a.click()
  URL.revokeObjectURL(url)
}

function ImportStudents({ onImported }: { onImported: () => void }) {
  const t = useT()
  const errorText = useErrorText()
  const service = useService()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [result, setResult] = useState<Awaited<ReturnType<typeof service.importStudents>> | null>(null)

  const upload = async (file: File) => {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      setResult(await service.importStudents(file))
      onImported()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <section className="import">
      <h2>{t('Импорт из CSV', 'CSV-тен импорттау')}</h2>
      <p className="muted measure">
        {t('Файл в UTF-8, по строке на студента: name;group;login. Первая строка может быть заголовком. До 2000 строк.', 'UTF-8 файл, әр студентке бір жол: name;group;login. Бірінші жол тақырып болуы мүмкін. 2000 жолға дейін.')}
      </p>
      <label className="btn btn--quiet file-btn">
        {busy ? <Spinner /> : <Upload size={18} aria-hidden="true" />}
        {t('Выбрать файл', 'Файл таңдау')}
        <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      </label>
      {error != null && (
        <p className="field-error" role="alert">
          {errorText(error)}
        </p>
      )}
      {result && (
        <div className="otp" role="status">
          <p>
            {t(`Добавлено: ${result.created.length}. Пропущено строк: ${result.skipped.length}.`, `Қосылды: ${result.created.length}. Өткізілген жолдар: ${result.skipped.length}.`)}
          </p>
          {result.skipped.length > 0 && (
            <ul className="skipped">
              {result.skipped.slice(0, 20).map((s) => (
                <li key={s.line}>
                  {t('Строка', 'Жол')} {s.line}: {errorText(new DomainError(s.code as ErrorCode))}
                </li>
              ))}
            </ul>
          )}
          {result.created.length > 0 && (
            <button className="btn btn--primary btn--sm" type="button" onClick={() => downloadCredentials(result.created)}>
              {t('Скачать логины и пароли', 'Логиндер мен құпиясөздерді жүктеу')}
            </button>
          )}
        </div>
      )}
    </section>
  )
}

function EditRow({ student, onDone }: { student: Student; onDone: (changed: boolean) => void }) {
  const t = useT()
  const errorText = useErrorText()
  const service = useService()
  const [form, setForm] = useState({ name: student.name, group: student.group })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await service.updateStudent(student.id, { name: form.name.trim(), group: form.group.trim() })
      onDone(true)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  return (
    <form className="inline-edit" onSubmit={submit} onKeyDown={(e) => e.key === 'Escape' && onDone(false)}>
      <div className="field field--grow">
        <label htmlFor={`e-name-${student.id}`}>{t('ФИО', 'Аты-жөні')}</label>
        <input id={`e-name-${student.id}`} autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor={`e-group-${student.id}`}>{t('Группа', 'Тобы')}</label>
        <input id={`e-group-${student.id}`} value={form.group} onChange={(e) => setForm({ ...form, group: e.target.value })} />
      </div>
      <button className="btn btn--primary btn--sm" type="submit" disabled={busy}>
        {busy && <Spinner />}
        {t('Сохранить', 'Сақтау')}
      </button>
      <button className="btn btn--quiet btn--sm" type="button" onClick={() => onDone(false)}>
        {t('Отмена', 'Болдырмау')}
      </button>
      {error != null && (
        <p className="field-error" role="alert">
          {errorText(error)}
        </p>
      )}
    </form>
  )
}

export default function AdminStudents() {
  const t = useT()
  const errorText = useErrorText()
  const service = useService()
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<string | null>(null)
  const [issued, setIssued] = useState<{ login: string; password: string } | null>(null)
  const [message, setMessage] = useState('')
  const needle = useDebounced(q.trim())
  const list = useQuery(['students', needle, page], () => service.listStudents({ q: needle, page, pageSize: PAGE_SIZE }))

  useEffect(() => {
    document.title = `${t('Студенты', 'Студенттер')} · AITU`
  })
  useEffect(() => setPage(1), [needle])

  const reset = async (s: Student) => {
    if (!s.userId) return
    try {
      const res = await service.resetPassword(s.userId)
      setIssued({ login: s.login, password: res.temporaryPassword })
    } catch (e) {
      setMessage(errorText(e))
    }
  }

  const rows = list.data?.items ?? []
  return (
    <AppShell>
      <div className="admin">
        <header className="page-head">
          <h1>{t('Студенты', 'Студенттер')}</h1>
        </header>
        <AddStudent onAdded={list.reload} />
        <ImportStudents onImported={list.reload} />
        <div className="toolbar">
          <label className="search">
            <Search size={18} aria-hidden="true" />
            <span className="sr-only">{t('Поиск', 'Іздеу')}</span>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ФИО, группа или логин', 'Аты-жөні, тобы немесе логин')} />
          </label>
        </div>
        {message && (
          <p className="flash is-error" role="alert">
            {message}
          </p>
        )}
        {issued && <OneTimePassword login={issued.login} password={issued.password} onClose={() => setIssued(null)} />}
        {list.loading && !list.data ? (
          <Skeleton />
        ) : list.error && !list.data ? (
          <LoadError error={list.error} onRetry={list.reload} />
        ) : rows.length === 0 ? (
          <Empty title={needle ? t('Никого не нашли', 'Ешкім табылмады') : t('Справочник пуст', 'Анықтамалық бос')}>
            {needle ? t('Проверьте написание или ищите по группе.', 'Жазылуын тексеріңіз немесе топ бойынша іздеңіз.') : t('Добавьте студентов по одному или загрузите CSV-файл группы.', 'Студенттерді бір-бірлеп қосыңыз немесе топтың CSV файлын жүктеңіз.')}
          </Empty>
        ) : (
          <>
            <table className="queue">
              <thead>
                <tr>
                  <th>{t('ФИО', 'Аты-жөні')}</th>
                  <th>{t('Группа', 'Тобы')}</th>
                  <th>{t('Логин', 'Логин')}</th>
                  <th>{t('Открытые листы', 'Ашық парақтар')}</th>
                  <th className="col-actions">
                    <span className="sr-only">{t('Действия', 'Әрекеттер')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <Fragment key={s.id}>
                    <tr>
                      <td>
                        <b>{s.name}</b>
                      </td>
                      <td data-label={t('Группа', 'Тобы')}>{s.group}</td>
                      <td className="num" data-label={t('Логин', 'Логин')}>
                        {s.login}
                      </td>
                      <td className="num" data-label={t('Открытые листы', 'Ашық парақтар')}>
                        {s.activeSheets ?? 0}
                      </td>
                      <td className="col-actions">
                        <div className="row-actions">
                          <button className="btn btn--quiet btn--sm" type="button" aria-expanded={editing === s.id} onClick={() => setEditing(editing === s.id ? null : s.id)}>
                            {t('Изменить', 'Өзгерту')}
                          </button>
                          <button className="btn btn--quiet btn--sm" type="button" disabled={!s.userId} onClick={() => reset(s)}>
                            {t('Новый пароль', 'Жаңа құпиясөз')}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {editing === s.id && (
                      <tr className="edit-row">
                        <td colSpan={5}>
                          <EditRow
                            student={s}
                            onDone={(changed) => {
                              setEditing(null)
                              if (changed) list.reload()
                            }}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
            <Pager page={page} pageSize={PAGE_SIZE} total={list.data?.total ?? 0} onPage={setPage} />
          </>
        )}
      </div>
    </AppShell>
  )
}
