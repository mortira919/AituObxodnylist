// Кабинет студента `/student`: что держит лист, PDF и ссылка для проверки. Рассчитан в первую очередь на телефон.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Send } from 'lucide-react'
import type { Sheet } from '../../domain/clearance'
import { useAuth } from '../auth'
import { Empty, LoadError, Skeleton } from '../components/Feedback'
import { ClosedBlock, Headline, MarkList, SheetMeta } from '../components/SheetParts'
import { AppShell, Spinner } from '../components/Shell'
import { useErrorText } from '../errorText'
import { SHEET_TYPE_NAMES, STATUS_NAMES, useFormat, usePick, useT } from '../i18n'
import { useQuery, useService } from '../services'

function Telegram() {
  const t = useT()
  const errorText = useErrorText()
  const service = useService()
  const { user, refresh } = useAuth()
  const [link, setLink] = useState<{ code: string; botUrl: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="tg">
      <Send size={20} aria-hidden="true" />
      <div>
        <b>{t('Уведомления в Telegram', 'Telegram хабарламалары')}</b>
        <p className="muted">
          {user?.telegramLinked
            ? t('Подключено. Напишем, когда отдел поставит долг и когда лист закроется.', 'Қосылды. Бөлім берешек қойғанда және парақ жабылғанда жазамыз.')
            : link
              ? t(`Откройте бота и отправьте код ${link.code}. Код действует 15 минут.`, `Ботты ашып, ${link.code} кодын жіберіңіз. Код 15 минут жарамды.`)
              : t('Подключите бота, чтобы узнавать об отметках без захода на сайт.', 'Сайтқа кірмей белгілер туралы білу үшін ботты қосыңыз.')}
        </p>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </div>
      {user?.telegramLinked ? (
        <button className="btn btn--quiet" type="button" disabled={busy} onClick={() => run(async () => {
            await service.telegramUnlink()
            setLink(null) // старый код больше не действует, показываем «Подключить» заново
            await refresh()
          })}>
          {busy && <Spinner />}
          {t('Отключить', 'Өшіру')}
        </button>
      ) : link ? (
        <span className="tg-actions">
          <a className="btn btn--primary" href={link.botUrl} target="_blank" rel="noreferrer">
            {t('Открыть бота', 'Ботты ашу')}
          </a>
          <button className="btn btn--quiet" type="button" disabled={busy} onClick={() => run(refresh)}>
            {t('Я отправил код', 'Кодты жібердім')}
          </button>
        </span>
      ) : (
        <button className="btn btn--quiet" type="button" disabled={busy} onClick={() => run(async () => setLink(await service.telegramLink()))}>
          {busy && <Spinner />}
          {t('Подключить', 'Қосу')}
        </button>
      )}
    </section>
  )
}

function History({ sheets }: { sheets: Sheet[] }) {
  const t = useT()
  const pick = usePick()
  const f = useFormat()
  return (
    <section className="history">
      <h2>{t('Другие листы', 'Басқа парақтар')}</h2>
      <ul>
        {sheets.map((s) => (
          <li key={s.number}>
            <span>
              {pick(SHEET_TYPE_NAMES[s.type])} · № {s.number}
            </span>
            <span className="muted">
              {pick(STATUS_NAMES[s.status])}
              {s.closedAt && ` · ${f.date(s.closedAt)}`}
            </span>
            {s.closedAt && <Link to={`/verify/${s.number}`}>{t('Проверить', 'Тексеру')}</Link>}
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function Student() {
  const t = useT()
  const service = useService()
  const { user } = useAuth()
  const sheets = useQuery(['mySheets'], () => service.mySheets())

  useEffect(() => {
    document.title = `${t('Мой обходной лист', 'Менің айналма парағым')} · AITU`
  })

  const list = sheets.data ?? []
  const current = list.find((s) => !s.closedAt) ?? list[0]
  const rest = list.filter((s) => s !== current)

  return (
    <AppShell>
      <div className="student">
        {sheets.loading && !sheets.data ? (
          <Skeleton rows={6} />
        ) : sheets.error && !sheets.data ? (
          <LoadError error={sheets.error} onRetry={sheets.reload} />
        ) : current ? (
          <article className="sheet">
            <Headline sheet={current} />
            <SheetMeta sheet={current} />
            {current.closedAt && <ClosedBlock sheet={current} />}
            <MarkList sheet={current} showRoom />
          </article>
        ) : (
          <Empty title={t('Открытых листов нет', 'Ашық парақтар жоқ')}>
            {t(
              `${user?.name ?? ''}, обходной лист открывает учебная часть, когда вы подаёте заявление на выпуск, перевод, отпуск или выселение. Он появится здесь сам.`,
              `${user?.name ?? ''}, айналма парақты бітіруге, ауысуға, демалысқа немесе шығуға өтініш бергенде оқу бөлімі ашады. Ол осында өзі пайда болады.`,
            )}
          </Empty>
        )}
        <Telegram />
        {rest.length > 0 && <History sheets={rest} />}
      </div>
    </AppShell>
  )
}
