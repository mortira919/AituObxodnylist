// Состояния списка, которые бывают у любого запроса: грузится, ошибка, пусто, листание.
import type { ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import { useErrorText } from '../errorText'
import { useT } from '../i18n'

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="skeleton-row" />
      ))}
    </div>
  )
}

export function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useT()
  const errorText = useErrorText()
  return (
    <div className="load-error" role="alert">
      <p>{errorText(error)}</p>
      <button className="btn btn--quiet btn--sm" type="button" onClick={onRetry}>
        <RotateCcw size={16} aria-hidden="true" />
        {t('Повторить', 'Қайталау')}
      </button>
    </div>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  )
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const t = useT()
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages === 1) return null
  return (
    <nav className="pager" aria-label={t('Страницы', 'Беттер')}>
      <button className="btn btn--quiet btn--sm" type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        {t('Назад', 'Артқа')}
      </button>
      <span className="num">
        {t(`Страница ${page} из ${pages}`, `${pages} беттің ${page}-і`)}
      </span>
      <button className="btn btn--quiet btn--sm" type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        {t('Дальше', 'Келесі')}
      </button>
    </nav>
  )
}

// Временный пароль показывается один раз: сервер его больше не отдаст.
export function OneTimePassword({ login, password, onClose }: { login: string; password: string; onClose: () => void }) {
  const t = useT()
  return (
    <div className="otp" role="status">
      <p>
        {t('Передайте человеку данные для входа. Пароль показан один раз, при первом входе его нужно сменить.', 'Кіру деректерін адамға беріңіз. Құпиясөз бір рет көрсетіледі, алғаш кіргенде оны ауыстыру керек.')}
      </p>
      <dl>
        <div>
          <dt>{t('Логин', 'Логин')}</dt>
          <dd className="num">{login}</dd>
        </div>
        <div>
          <dt>{t('Временный пароль', 'Уақытша құпиясөз')}</dt>
          <dd className="num">{password}</dd>
        </div>
      </dl>
      <button className="btn btn--quiet btn--sm" type="button" onClick={onClose}>
        {t('Я сохранил', 'Сақтадым')}
      </button>
    </div>
  )
}
