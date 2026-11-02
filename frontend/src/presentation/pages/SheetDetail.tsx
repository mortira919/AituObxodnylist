// Карточка листа `/sheets/:number` для учебной части и отделов: все отметки, журнал по листу,
// а сотрудник отдела может поставить свою отметку прямо отсюда.
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { homeOf, markOf } from '../../domain/clearance'
import { useAuth } from '../auth'
import { LoadError, Skeleton } from '../components/Feedback'
import { ClosedBlock, Headline, MarkList, SheetMeta } from '../components/SheetParts'
import { AppShell, Spinner } from '../components/Shell'
import { useErrorText } from '../errorText'
import { DEPT_NAMES, usePick, useT } from '../i18n'
import { useQuery, useService } from '../services'
import { DebtForm } from './Office'
import { AuditList } from './admin/Audit'

const AUDIT_PREVIEW = 20

export default function SheetDetail() {
  const t = useT()
  const pick = usePick()
  const errorText = useErrorText()
  const service = useService()
  const { user } = useAuth()
  const { number = '' } = useParams()
  const sheet = useQuery(['sheet', number], () => service.getSheet(number))
  const [debtOpen, setDebtOpen] = useState(false)
  const [allAudit, setAllAudit] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)

  useEffect(() => {
    document.title = `№ ${number} · AITU`
  })

  const s = sheet.data
  const dept = user?.role === 'officer' ? user.departmentId : undefined
  const myMark = s && dept ? markOf(s, dept) : undefined

  const clear = async () => {
    setBusy(true)
    try {
      await service.setMark(number, dept!, { state: 'clear' })
      setMessage({ text: t('Отмечено без задолженности.', 'Берешек жоқ деп белгіленді.') })
      sheet.reload()
    } catch (e) {
      setMessage({ text: errorText(e), error: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppShell>
      <div className="student">
        <Link className="back" to={user ? homeOf(user.role) : '/'}>
          <ArrowLeft size={16} aria-hidden="true" />
          {t('К списку', 'Тізімге')}
        </Link>
        {sheet.loading && !s ? (
          <Skeleton rows={6} />
        ) : sheet.error && !s ? (
          <LoadError error={sheet.error} onRetry={sheet.reload} />
        ) : s ? (
          <article className="sheet">
            <Headline sheet={s} />
            <SheetMeta sheet={s} />
            {s.closedAt && <ClosedBlock sheet={s} />}

            {myMark && !s.closedAt && (
              <section className="my-mark">
                <h2>
                  {t('Отметка отдела', 'Бөлім белгісі')} «{pick(DEPT_NAMES[dept!])}»
                </h2>
                <div className="row-actions">
                  {myMark.state !== 'clear' && (
                    <button className="btn btn--primary" type="button" disabled={busy} onClick={clear}>
                      {busy && <Spinner />}
                      {myMark.state === 'debt' ? t('Долг погашен', 'Берешек өтелді') : t('Нет задолженности', 'Берешек жоқ')}
                    </button>
                  )}
                  <button className="btn btn--quiet" type="button" aria-expanded={debtOpen} onClick={() => setDebtOpen(!debtOpen)}>
                    {myMark.state === 'debt' ? t('Изменить долг', 'Берешекті өзгерту') : t('Есть долг', 'Берешек бар')}
                  </button>
                </div>
                {debtOpen && (
                  <DebtForm
                    sheet={s}
                    dept={dept!}
                    onDone={(msg) => {
                      setDebtOpen(false)
                      if (msg) {
                        setMessage({ text: msg })
                        sheet.reload()
                      }
                    }}
                  />
                )}
                <p className={`flash ${message?.error ? 'is-error' : ''}`} role="status" aria-live="polite">
                  {message?.text}
                </p>
              </section>
            )}

            <MarkList sheet={s} />

            <section className="history">
              <h2>{t('Журнал по листу', 'Парақ журналы')}</h2>
              {/* обычно у листа 10–20 записей, но длинную историю не вываливаем целиком */}
              <AuditList entries={allAudit ? s.audit : s.audit.slice(0, AUDIT_PREVIEW)} showSheet={false} />
              {!allAudit && s.audit.length > AUDIT_PREVIEW && (
                <button className="btn btn--quiet btn--sm audit-more" type="button" onClick={() => setAllAudit(true)}>
                  {t(`Показать все записи (${s.audit.length})`, `Барлық жазбаны көрсету (${s.audit.length})`)}
                </button>
              )}
            </section>
          </article>
        ) : null}
      </div>
    </AppShell>
  )
}
