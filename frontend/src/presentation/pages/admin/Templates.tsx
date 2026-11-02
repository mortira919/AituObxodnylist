// Учебная часть `/admin/templates`: какие отделы проверяют студента для каждого типа листа.
import { useEffect, useState } from 'react'
import { DEPTS, DomainError, SHEET_TYPES, type DeptId, type SheetType, type Templates } from '../../../domain/clearance'
import { LoadError, Skeleton } from '../../components/Feedback'
import { Mark } from '../../components/Mark'
import { AppShell } from '../../components/Shell'
import { useErrorText } from '../../errorText'
import { DEPT_NAMES, SHEET_TYPE_NAMES, usePick, useT } from '../../i18n'
import { useQuery, useService } from '../../services'

export default function AdminTemplates() {
  const t = useT()
  const pick = usePick()
  const errorText = useErrorText()
  const service = useService()
  const templates = useQuery(['templates'], () => service.getTemplates())
  const [busy, setBusy] = useState(false)
  // галочка меняется сразу, не дожидаясь сервера; при ошибке возвращается назад
  const [local, setLocal] = useState<Templates | null>(null)
  const shown = local ?? templates.data
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)

  useEffect(() => {
    document.title = `${t('Шаблоны', 'Үлгілер')} · AITU`
  })

  const toggle = async (type: SheetType, dept: DeptId) => {
    const cur = shown![type]
    const next = cur.includes(dept) ? cur.filter((d) => d !== dept) : [...cur, dept]
    if (!next.length) return setMessage({ text: errorText(new DomainError('no_depts')), error: true })
    const before = shown!
    setLocal({ ...before, [type]: DEPTS.filter((d) => next.includes(d)) })
    setBusy(true)
    try {
      setLocal(await service.setTemplate(type, DEPTS.filter((d) => next.includes(d))))
      setMessage({ text: t('Шаблон сохранён. Изменение касается только новых листов.', 'Үлгі сақталды. Өзгеріс тек жаңа парақтарға қатысты.') })
    } catch (e) {
      setLocal(before)
      setMessage({ text: errorText(e), error: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppShell>
      <div className="admin">
        <header className="page-head">
          <h1>{t('Шаблоны листов', 'Парақ үлгілері')}</h1>
        </header>
        <p className="measure muted">{t('Отметьте, какие отделы проверяют студента для каждого типа листа. Уже открытые листы не меняются.', 'Әр парақ түрі үшін студентті қай бөлімдер тексеретінін белгілеңіз. Ашылған парақтар өзгермейді.')}</p>
        <p className={`flash ${message?.error ? 'is-error' : ''}`} role="status" aria-live="polite">
          {message?.text}
        </p>
        {templates.loading && !templates.data ? (
          <Skeleton rows={5} />
        ) : templates.error && !templates.data ? (
          <LoadError error={templates.error} onRetry={templates.reload} />
        ) : (
          <div className="matrix-wrap">
            <table className="matrix">
              <thead>
                <tr>
                  <th>{t('Тип листа', 'Парақ түрі')}</th>
                  {DEPTS.map((d) => (
                    <th key={d}>
                      <Mark dept={d} state="identity" size={30} />
                      <span>{pick(DEPT_NAMES[d])}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SHEET_TYPES.map((type) => (
                  <tr key={type}>
                    <th scope="row">{pick(SHEET_TYPE_NAMES[type])}</th>
                    {DEPTS.map((d) => (
                      <td key={d}>
                        <input
                          type="checkbox"
                          checked={shown![type].includes(d)}
                          disabled={busy}
                          aria-label={`${pick(SHEET_TYPE_NAMES[type])}: ${pick(DEPT_NAMES[d])}`}
                          onChange={() => toggle(type, d)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  )
}
