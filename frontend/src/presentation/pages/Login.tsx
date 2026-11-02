// Вход `/login`: логин и пароль колледжа. После входа ведёт туда, куда человек шёл, или в кабинет его роли.
import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { homeOf } from '../../domain/clearance'
import { useAuth } from '../auth'
import { Brand, LangSwitch, Spinner } from '../components/Shell'
import { useErrorText } from '../errorText'
import { useT } from '../i18n'

export default function Login() {
  const t = useT()
  const errorText = useErrorText()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const { user, loading, login } = useAuth()
  const [form, setForm] = useState({ login: '', password: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    document.title = `${t('Вход', 'Кіру')} · AITU`
  })

  // next берём только относительный, чтобы ссылка на вход не уводила на чужой сайт
  const next = params.get('next')
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null
  if (!loading && user) return <Navigate to={safeNext ?? homeOf(user.role)} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!form.login.trim() || !form.password) return setError(t('Введите логин и пароль.', 'Логин мен құпиясөзді енгізіңіз.'))
    setBusy(true)
    setError('')
    try {
      const u = await login(form.login.trim(), form.password)
      nav(u.mustChangePassword ? '/account' : (safeNext ?? homeOf(u.role)), { replace: true })
    } catch (err) {
      setError(errorText(err))
      setForm((f) => ({ ...f, password: '' }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login on-dark">
      <header className="topbar">
        <Brand />
        <LangSwitch />
      </header>
      <main className="login-main" id="main">
        <h1>{t('Вход в\u00a0обходной лист', 'Айналма парағына кіру')}</h1>
        <p className="lead">{t('Логин и пароль выдаёт учебная часть колледжа.', 'Логин мен құпиясөзді колледждің оқу бөлімі береді.')}</p>
        <form className="login-form" onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="l-login">{t('Логин', 'Логин')}</label>
            <input id="l-login" autoComplete="username" autoCapitalize="none" spellCheck={false} value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} aria-invalid={!!error} />
          </div>
          <div className="field">
            <label htmlFor="l-pass">{t('Пароль', 'Құпиясөз')}</label>
            <input id="l-pass" type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} aria-invalid={!!error} />
          </div>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn--primary btn--lg" type="submit" disabled={busy} aria-busy={busy}>
            {busy && <Spinner />}
            {t('Войти', 'Кіру')}
          </button>
        </form>
        <p className="login-help">
          {t('Забыли пароль? Обратитесь в учебную часть, там выдадут новый.', 'Құпиясөзді ұмыттыңыз ба? Оқу бөліміне жүгініңіз, жаңасын береді.')}{' '}
          <Link to="/verify">{t('Проверить документ без входа', 'Құжатты кірмей тексеру')}</Link>
        </p>
      </main>
    </div>
  )
}
