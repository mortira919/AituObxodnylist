// Учебная часть `/admin/audit`: кто, когда и какую отметку поставил. Журнал только читается.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search } from 'lucide-react'
import type { AuditEntry } from '../../../domain/clearance'
import { Empty, LoadError, Pager, Skeleton } from '../../components/Feedback'
import { AppShell } from '../../components/Shell'
import { DEPT_NAMES, useFormat, usePick, useT } from '../../i18n'
import { useDebounced, useQuery, useService } from '../../services'

const PAGE_SIZE = 50

export function AuditList({ entries, linkSheets = false, showSheet = true }: { entries: AuditEntry[]; linkSheets?: boolean; showSheet?: boolean }) {
  const t = useT()
  const pick = usePick()
  const f = useFormat()
  const action = (a: AuditEntry) => {
    if (a.action === 'create') return t('Открыл(а) лист', 'Парақ ашты')
    if (a.action === 'close') return t('Лист закрыт автоматически', 'Парақ автоматты түрде жабылды')
    const dept = a.department ? pick(DEPT_NAMES[a.department]) : ''
    if (a.action === 'clear') return `${dept}: ${t('нет задолженности', 'берешек жоқ')}`
    return `${dept}: ${t('долг', 'берешек')}${a.note ? ` (${a.note})` : ''}`
  }
  return (
    <ol className={`audit ${showSheet ? '' : 'audit--single'}`}>
      {entries.map((a, i) => (
        <li key={`${a.at}-${i}`} className={`is-${a.action}`}>
          <time dateTime={a.at}>{f.dateTime(a.at)}</time>
          {!showSheet ? null : linkSheets ? (
            <Link className="num nowrap" to={`/sheets/${a.sheet}`}>
              № {a.sheet}
            </Link>
          ) : (
            <span className="num nowrap">№ {a.sheet}</span>
          )}
          <span className="audit-actor">{a.actor}</span>
          <span>{action(a)}</span>
        </li>
      ))}
    </ol>
  )
}

export default function AdminAudit() {
  const t = useT()
  const service = useService()
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const needle = useDebounced(q.trim())
  const list = useQuery(['audit', needle, page], () => service.listAudit({ sheet: needle || undefined, page, pageSize: PAGE_SIZE }))

  useEffect(() => {
    document.title = `${t('Журнал действий', 'Әрекеттер журналы')} · AITU`
  })
  useEffect(() => setPage(1), [needle])

  const rows = list.data?.items ?? []
  return (
    <AppShell>
      <div className="admin">
        <header className="page-head">
          <h1>{t('Журнал действий', 'Әрекеттер журналы')}</h1>
        </header>
        <label className="search search--narrow">
          <Search size={18} aria-hidden="true" />
          <span className="sr-only">{t('Номер листа', 'Парақ нөмірі')}</span>
          <input type="search" inputMode="numeric" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Номер листа', 'Парақ нөмірі')} />
        </label>
        {list.loading && !list.data ? (
          <Skeleton rows={8} />
        ) : list.error && !list.data ? (
          <LoadError error={list.error} onRetry={list.reload} />
        ) : rows.length === 0 ? (
          <Empty title={needle ? t('Записей по этому номеру нет', 'Бұл нөмір бойынша жазбалар жоқ') : t('Журнал пуст', 'Журнал бос')} />
        ) : (
          <>
            <AuditList entries={rows} linkSheets />
            <Pager page={page} pageSize={PAGE_SIZE} total={list.data?.total ?? 0} onPage={setPage} />
          </>
        )}
      </div>
    </AppShell>
  )
}
