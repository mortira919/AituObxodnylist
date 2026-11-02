// Общие элементы оболочки: бренд колледжа, переключатель языка, каркас кабинетов.
import { useEffect, useRef, type ReactNode } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { LogOut, UserRound } from 'lucide-react'
import logoOnDark from '../../assets/aitu-logo-on-dark.svg'
import { useAuth } from '../auth'
import { useLang, useT } from '../i18n'

export function Brand() {
  const t = useT()
  return (
    <Link to="/" className="brand">
      <img src={logoOnDark} alt="Astana IT University" width={96} height={42} />
      <span className="brand-product">
        {t('Колледж', 'Колледж')}
        <b>{t('Обходной лист', 'Айналма парақ')}</b>
      </span>
    </Link>
  )
}

export function LangSwitch() {
  const { lang, setLang } = useLang()
  return (
    <div className="lang" role="group" aria-label="Язык / Тіл">
      <button type="button" aria-pressed={lang === 'ru'} onClick={() => setLang('ru')}>
        RU
      </button>
      <button type="button" aria-pressed={lang === 'kz'} onClick={() => setLang('kz')}>
        ҚАЗ
      </button>
    </div>
  )
}

// Каркас кабинетов: тёмная панель сверху (разделы своей роли, пользователь, выход), рабочая область ниже.
export function AppShell({ children }: { children: ReactNode }) {
  const t = useT()
  const nav = useNavigate()
  const { user, logout } = useAuth()
  const navRef = useRef<HTMLElement>(null)
  // на телефоне разделы листаются вбок: текущий должен быть виден сразу
  useEffect(() => {
    navRef.current?.querySelector('a.active')?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  })

  const links: [string, string][] =
    user?.role === 'admin'
      ? [
          ['/admin', t('Листы', 'Парақтар')],
          ['/admin/students', t('Студенты', 'Студенттер')],
          ['/admin/staff', t('Сотрудники', 'Қызметкерлер')],
          ['/admin/templates', t('Шаблоны', 'Үлгілер')],
          ['/admin/audit', t('Журнал', 'Журнал')],
        ]
      : user?.role === 'officer'
        ? [['/office', t('Очередь отдела', 'Бөлім кезегі')]]
        : [['/student', t('Мой лист', 'Менің парағым')]]

  return (
    <div className="app">
      <header className="appbar">
        <Brand />
        <nav ref={navRef} className="roles" aria-label={t('Разделы', 'Бөлімдер')}>
          {links.map(([to, label]) => (
            <NavLink key={to} to={to} end>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="appbar-end">
          {user && (
            <Link className="whoami" to="/account" aria-label={`${t('Аккаунт', 'Аккаунт')}: ${user.name}`}>
              <UserRound size={18} aria-hidden="true" />
              <span className="whoami-name">{user.name}</span>
            </Link>
          )}
          <button
            type="button"
            className="icon-btn"
            aria-label={t('Выйти', 'Шығу')}
            onClick={async () => {
              await logout()
              nav('/login')
            }}
          >
            <LogOut size={18} aria-hidden="true" />
          </button>
          <LangSwitch />
        </div>
      </header>
      <main className="app-main" id="main">
        {children}
      </main>
    </div>
  )
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />
}
