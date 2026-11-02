// Аккаунт `/account` для любой роли: кто вошёл и смена пароля.
import { useEffect, useState, type FormEvent } from 'react'
import { PASSWORD_MIN } from '../../domain/clearance'
import { useAuth } from '../auth'
import { AppShell, Spinner } from '../components/Shell'
import { errorField, useErrorText } from '../errorText'
import { DEPT_NAMES, usePick, useT } from '../i18n'
import { useService } from '../services'

export default function Account() {
  const t = useT()
  const pick = usePick()
  const errorText = useErrorText()
  const service = useService()
  const { user, refresh } = useAuth()
  const empty = { current: '', next: '', repeat: '' }
  const [form, setForm] = useState(empty)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    document.title = `${t('Аккаунт', 'Аккаунт')} · AITU`
  })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setDone(false)
    try {
      await service.changePassword(form.current, form.next, form.repeat)
      setForm(empty)
      setDone(true)
      await refresh()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }
  const field = errorField(error)
  const role = user?.role === 'admin' ? t('Учебная часть', 'Оқу бөлімі') : user?.role === 'officer' ? `${t('Сотрудник отдела', 'Бөлім қызметкері')} «${pick(DEPT_NAMES[user.departmentId!])}»` : `${t('Студент', 'Студент')}, ${user?.group ?? ''}`

  return (
    <AppShell>
      <div className="student">
        <header className="page-head">
          <h1>{user?.name}</h1>
        </header>
        <dl className="facts account-facts">
          <div>
            <dt>{t('Роль', 'Рөлі')}</dt>
            <dd>{role}</dd>
          </div>
          <div>
            <dt>{t('Логин', 'Логин')}</dt>
            <dd className="num">{user?.login}</dd>
          </div>
        </dl>

        <form className="create" onSubmit={submit} noValidate>
          <h2>{t('Сменить пароль', 'Құпиясөзді ауыстыру')}</h2>
          {user?.mustChangePassword && (
            <p className="notice" role="status">
              {t('Вы вошли с временным паролем. Придумайте свой, чтобы продолжить работу.', 'Сіз уақытша құпиясөзбен кірдіңіз. Жұмысты жалғастыру үшін өз құпиясөзіңізді ойлап табыңыз.')}
            </p>
          )}
          <div className="stack">
            <div className="field">
              <label htmlFor="p-cur">{t('Текущий пароль', 'Ағымдағы құпиясөз')}</label>
              <input id="p-cur" type="password" autoComplete="current-password" value={form.current} aria-invalid={field === 'current' || (error as { code?: string })?.code === 'wrong_password'} onChange={(e) => setForm({ ...form, current: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="p-next">{t('Новый пароль', 'Жаңа құпиясөз')}</label>
              <input id="p-next" type="password" autoComplete="new-password" value={form.next} aria-invalid={field === 'next'} aria-describedby="p-hint" onChange={(e) => setForm({ ...form, next: e.target.value })} />
              <span className="hint" id="p-hint">
                {t(`не короче ${PASSWORD_MIN} символов`, `кемінде ${PASSWORD_MIN} таңба`)}
              </span>
            </div>
            <div className="field">
              <label htmlFor="p-rep">{t('Повторите новый пароль', 'Жаңа құпиясөзді қайталаңыз')}</label>
              <input id="p-rep" type="password" autoComplete="new-password" value={form.repeat} aria-invalid={field === 'repeat'} onChange={(e) => setForm({ ...form, repeat: e.target.value })} />
            </div>
          </div>
          {error != null && (
            <p className="field-error" role="alert">
              {field === 'repeat' ? t('Пароли не совпадают.', 'Құпиясөздер сәйкес емес.') : errorText(error)}
            </p>
          )}
          {done && (
            <p className="flash" role="status">
              {t('Пароль изменён. На других устройствах нужно войти заново.', 'Құпиясөз ауыстырылды. Басқа құрылғыларда қайта кіру керек.')}
            </p>
          )}
          <button className="btn btn--primary" type="submit" disabled={busy} aria-busy={busy}>
            {busy && <Spinner />}
            {t('Сменить пароль', 'Құпиясөзді ауыстыру')}
          </button>
        </form>
      </div>
    </AppShell>
  )
}
