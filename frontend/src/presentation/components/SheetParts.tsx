// Части карточки листа, общие для студента, отдела и учебной части.
import { useState } from 'react'
import { Check, Copy, Printer } from 'lucide-react'
import logo from '../../assets/aitu-logo.svg'
import type { Mark as MarkT, Sheet } from '../../domain/clearance'
import { DEPT_NAMES, DEPT_ROOMS, MARK_NAMES, SHEET_TYPE_NAMES, useFormat, usePick, useT } from '../i18n'
import { Mark, Seal } from './Mark'
import { Qr, verifyUrl } from './Qr'

const FRESH_MS = 60_000

// Крупная строка статуса: студент с первого взгляда видит, что его держит.
export function Headline({ sheet }: { sheet: Sheet }) {
  const t = useT()
  const pick = usePick()
  const f = useFormat()
  const debts = sheet.marks.filter((m) => m.state === 'debt')
  const pending = sheet.marks.filter((m) => m.state === 'pending')
  const names = (ms: MarkT[]) => ms.map((m) => pick(DEPT_NAMES[m.department])).join(', ')
  if (sheet.closedAt) return <h1 className="status-line is-closed">{t(`Лист закрыт ${f.date(sheet.closedAt)}`, `Парақ ${f.date(sheet.closedAt)} жабылды`)}</h1>
  if (debts.length) return <h1 className="status-line is-debt">{t('Держит', 'Ұстап тұр')}: {names(debts)}</h1>
  if (pending.length > 2) return <h1 className="status-line">{t(`Ждём отметки ${pending.length} отделов`, `${pending.length} бөлімнің белгісін күтудеміз`)}</h1>
  return <h1 className="status-line">{t('Ждём', 'Күтудеміз')}: {names(pending)}</h1>
}

export function SheetMeta({ sheet }: { sheet: Sheet }) {
  const t = useT()
  const pick = usePick()
  const f = useFormat()
  const done = sheet.marks.filter((m) => m.state === 'clear').length
  return (
    <>
      <p className="sheet-meta">
        {sheet.student.name}, {sheet.student.group} · {pick(SHEET_TYPE_NAMES[sheet.type])} · <span className="nowrap">№ {sheet.number}</span> · {t('открыт', 'ашылды')} {f.date(sheet.createdAt)}
      </p>
      <p className="sheet-progress">
        {t(`${done} из ${sheet.marks.length} отделов подтвердили отсутствие задолженности`, `${sheet.marks.length} бөлімнің ${done}-і берешек жоқ екенін растады`)}
      </p>
    </>
  )
}

export function MarkRow({ m, showRoom = true }: { m: MarkT; showRoom?: boolean }) {
  const t = useT()
  const pick = usePick()
  const f = useFormat()
  const fresh = m.at && Date.now() - new Date(m.at).getTime() < FRESH_MS
  return (
    <li className={`mark-row is-${m.state} ${fresh ? 'is-fresh' : ''}`}>
      <Mark dept={m.department} state={m.state} size={44} />
      <div className="mark-row-body">
        <div className="mark-row-top">
          <b>{pick(DEPT_NAMES[m.department])}</b>
          <span className="mark-state">{pick(MARK_NAMES[m.state])}</span>
        </div>
        {m.state === 'debt' && (
          <div className="debt">
            <p>{m.note}</p>
            {m.due && (
              <p className="debt-due">
                {t('Закрыть до', 'Мерзімі')}: <b>{f.date(m.due)}</b>
              </p>
            )}
            {showRoom && <p className="debt-where">{pick(DEPT_ROOMS[m.department])}</p>}
          </div>
        )}
        {m.state === 'pending' && <p className="muted">{t('Отдел ещё не проверил лист. Приходить не нужно.', 'Бөлім парақты әлі тексерген жоқ. Келудің қажеті жоқ.')}</p>}
        {m.at && (
          <p className="meta">
            {m.by} · {f.dateTime(m.at)}
          </p>
        )}
      </div>
    </li>
  )
}

export function MarkList({ sheet, showRoom }: { sheet: Sheet; showRoom?: boolean }) {
  return (
    <ol className="mark-list" aria-live="polite">
      {sheet.marks.map((m) => (
        <MarkRow key={m.department} m={m} showRoom={showRoom} />
      ))}
    </ol>
  )
}

// Закрытый лист: печать, QR-код, PDF через печать браузера и ссылка для проверки.
export function ClosedBlock({ sheet }: { sheet: Sheet }) {
  const t = useT()
  const pick = usePick()
  const f = useFormat()
  const [copied, setCopied] = useState(false)
  const url = verifyUrl(sheet.number)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }
  return (
    <section className="closed-block" aria-label={t('Документ', 'Құжат')}>
      <Seal number={sheet.number} closedAt={sheet.closedAt!} size={176} />
      <div className="closed-block-side">
        <Qr text={url} size={112} />
        <div className="closed-actions">
          <button className="btn btn--primary" type="button" onClick={() => window.print()}>
            <Printer size={18} aria-hidden="true" />
            {t('Скачать PDF', 'PDF жүктеу')}
          </button>
          <button className="btn btn--quiet" type="button" onClick={copy}>
            {copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
            {copied ? t('Ссылка скопирована', 'Сілтеме көшірілді') : t('Ссылка для проверки', 'Тексеру сілтемесі')}
          </button>
        </div>
      </div>
      {/* Печатная форма: видна только при печати, браузер сохраняет её в PDF */}
      <div className="print-sheet" aria-hidden="true">
        <img className="print-logo" src={logo} alt="Astana IT University" />
        <h1>
          {t('Обходной лист', 'Айналма парақ')} № {sheet.number}
        </h1>
        <p>
          {sheet.student.name}, {sheet.student.group} · {pick(SHEET_TYPE_NAMES[sheet.type])} · {t('закрыт', 'жабылды')} {f.full(sheet.closedAt!)}
        </p>
        <table>
          <tbody>
            {sheet.marks.map((m) => (
              <tr key={m.department}>
                <td>{pick(DEPT_NAMES[m.department])}</td>
                <td>{pick(MARK_NAMES[m.state])}</td>
                <td>{m.by}</td>
                <td>{m.at && f.dateTime(m.at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="print-proof">
          <Seal number={sheet.number} closedAt={sheet.closedAt!} size={150} />
          <Qr text={url} size={130} />
          <p>
            {t('Проверка подлинности', 'Түпнұсқалықты тексеру')}: {url}
          </p>
        </div>
      </div>
    </section>
  )
}
