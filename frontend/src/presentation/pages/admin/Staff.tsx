// Учебная часть `/admin/staff`: сотрудники отделов и учебной части, их роли и доступ.
import { useEffect, useState, type FormEvent } from 'react'
import { DEPTS, type DeptId, type User } from '../../../domain/clearance'
import type { StaffInput } from '../../../application/ports'
import { useAuth } from '../../auth'
import { Empty, LoadError, OneTimePassword, Pager, Skeleton } from '../../components/Feedback'
import { AppShell, Spinner } from '../../components/Shell'
import { errorField, useErrorText } from '../../errorText'
import { DEPT_NAMES, usePick, useT } from '../../i18n'
import { useQuery, useService } from '../../services'

const PAGE_SIZE = 50

function AddStaff({ onAdded }: { onAdded: () => void }) {
  const t = useT()
  const pick = usePick()
  const errorText = useErrorText()
  const service = useService()
  const empty: StaffInput = { name: '', login: '', role: 'officer', departmentId: 'library' }
  const [form, setForm] = useState<StaffInput>(empty)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [issued, setIssued] = useState<{ login: string; password: string } | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await service.createStaff({ ...form, login: form.login.trim().toLowerCase() })
      setIssued({ login: res.user.login, password: res.temporaryPassword })
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
      <h2>{t('Добавить сотрудника', 'Қызметкер қосу')}</h2>
      <div className="create-fields">
        <div className="field field--grow">
          <label htmlFor="u-name">{t('ФИО', 'Аты-жөні')}</label>
          <input id="u-name" value={form.name} aria-invalid={field === 'name'} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="u-login">{t('Логин', 'Логин')}</label>
          <input id="u-login" value={form.login} autoCapitalize="none" spellCheck={false} aria-invalid={field === 'login'} onChange={(e) => setForm({ ...form, login: e.target.value })} />
        </div>
        <div className="field field--compact">
          <label htmlFor="u-role">{t('Роль', 'Рөлі')}</label>
          <select id="u-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as StaffInput['role'] })}>
            <option value="officer">{t('Сотрудник отдела', 'Бөлім қызметкері')}</option>
            <option value="admin">{t('Учебная часть', 'Оқу бөлімі')}</option>
          </select>
        </div>
        {form.role === 'officer' && (
          <div className="field field--compact">
            <label htmlFor="u-dept">{t('Отдел', 'Бөлім')}</label>
            <select id="u-dept" value={form.departmentId} aria-invalid={field === 'departmentId'} onChange={(e) => setForm({ ...form, departmentId: e.target.value as DeptId })}>
              {DEPTS.map((d) => (
                <option key={d} value={d}>
                  {pick(DEPT_NAMES[d])}
                </option>
              ))}
            </select>
          </div>
        )}
        <button className="btn btn--primary" type="submit" disabled={busy} aria-busy={busy}>
          {busy && <Spinner />}
          {t('Добавить', 'Қосу')}
        </button>
      </div>
      {error != null && (
        <p className="field-error" role="alert">
          {errorText(error)}
        </p>
      )}
      {issued && <OneTimePassword login={issued.login} password={issued.password} onClose={() => setIssued(null)} />}
    </form>
  )
}

export default function AdminStaff() {
  const t = useT()
  const pick = usePick()
  const errorText = useErrorText()
  const service = useService()
  const { user: me } = useAuth()
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState<string | null>(null)
  const [issued, setIssued] = useState<{ login: string; password: string } | null>(null)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)
  const list = useQuery(['staff', page], () => service.listStaff({ page, pageSize: PAGE_SIZE }))

  useEffect(() => {
    document.title = `${t('Сотрудники', 'Қызметкерлер')} · AITU`
  })

  const act = async (u: User, fn: () => Promise<unknown>, ok: string) => {
    setBusy(u.id)
    setMessage(null)
    try {
      await fn()
      setMessage({ text: ok })
      list.reload()
    } catch (e) {
      setMessage({ text: errorText(e), error: true })
    } finally {
      setBusy(null)
    }
  }

  const rows = list.data?.items ?? []
  return (
    <AppShell>
      <div className="admin">
        <header className="page-head">
          <h1>{t('Сотрудники', 'Қызметкерлер')}</h1>
        </header>
        <AddStaff onAdded={list.reload} />
        <p className={`flash ${message?.error ? 'is-error' : ''}`} role="status" aria-live="polite">
          {message?.text}
        </p>
        {issued && <OneTimePassword login={issued.login} password={issued.password} onClose={() => setIssued(null)} />}
        {list.loading && !list.data ? (
          <Skeleton />
        ) : list.error && !list.data ? (
          <LoadError error={list.error} onRetry={list.reload} />
        ) : rows.length === 0 ? (
          <Empty title={t('Сотрудников пока нет', 'Әзірге қызметкерлер жоқ')}>{t('Добавьте по сотруднику на каждый отдел, чтобы листы не застревали.', 'Парақтар тұрып қалмауы үшін әр бөлімге бір қызметкер қосыңыз.')}</Empty>
        ) : (
          <>
            <table className="queue">
              <thead>
                <tr>
                  <th>{t('ФИО', 'Аты-жөні')}</th>
                  <th>{t('Логин', 'Логин')}</th>
                  <th>{t('Роль и отдел', 'Рөлі мен бөлімі')}</th>
                  <th>{t('Доступ', 'Рұқсат')}</th>
                  <th className="col-actions">
                    <span className="sr-only">{t('Действия', 'Әрекеттер')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id} className={u.active ? '' : 'is-inactive'}>
                    <td>
                      <b>{u.name}</b>
                    </td>
                    <td className="num" data-label={t('Логин', 'Логин')}>
                      {u.login}
                    </td>
                    <td data-label={t('Роль и отдел', 'Рөлі мен бөлімі')}>
                      {u.role === 'admin' ? (
                        t('Учебная часть', 'Оқу бөлімі')
                      ) : (
                        <select
                          aria-label={t(`Отдел: ${u.name}`, `Бөлімі: ${u.name}`)}
                          value={u.departmentId}
                          disabled={busy === u.id}
                          onChange={(e) => act(u, () => service.updateStaff(u.id, { departmentId: e.target.value as DeptId }), t('Отдел изменён.', 'Бөлім өзгертілді.'))}
                        >
                          {DEPTS.map((d) => (
                            <option key={d} value={d}>
                              {pick(DEPT_NAMES[d])}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td data-label={t('Доступ', 'Рұқсат')}>{u.active ? t('Активен', 'Белсенді') : <span className="is-debt">{t('Заблокирован', 'Бұғатталған')}</span>}</td>
                    <td className="col-actions">
                      <div className="row-actions">
                        {/* свой пароль меняют в аккаунте; сброс самому себе оборвал бы текущую сессию */}
                        {u.id !== me?.id && (
                          <button
                            className="btn btn--quiet btn--sm"
                            type="button"
                            disabled={busy === u.id}
                            onClick={async () => {
                              setBusy(u.id)
                              try {
                                const res = await service.resetPassword(u.id)
                                setIssued({ login: u.login, password: res.temporaryPassword })
                              } catch (e) {
                                setMessage({ text: errorText(e), error: true })
                              } finally {
                                setBusy(null)
                              }
                            }}
                          >
                            {t('Новый пароль', 'Жаңа құпиясөз')}
                          </button>
                        )}
                        {/* себя заблокировать нельзя, иначе учебная часть может остаться без администратора */}
                        {u.id !== me?.id && (
                          <button
                            className="btn btn--quiet btn--sm"
                            type="button"
                            disabled={busy === u.id}
                            onClick={() => act(u, () => service.updateStaff(u.id, { active: !u.active }), u.active ? t('Доступ закрыт, сессии завершены.', 'Рұқсат жабылды, сессиялар аяқталды.') : t('Доступ открыт.', 'Рұқсат ашылды.'))}
                          >
                            {u.active ? t('Заблокировать', 'Бұғаттау') : t('Разблокировать', 'Бұғаттан шығару')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
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
