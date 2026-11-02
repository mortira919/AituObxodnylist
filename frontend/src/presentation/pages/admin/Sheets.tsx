// Учебная часть `/admin`: сводка, открытие нового листа и список всех листов с фильтрами.
import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Search } from 'lucide-react'
import { SHEET_TYPES, type SheetStatus, type SheetType, type Student } from '../../../domain/clearance'
import { Empty, LoadError, Pager, Skeleton } from '../../components/Feedback'
import { Mark } from '../../components/Mark'
import { AppShell, Spinner } from '../../components/Shell'
import { useErrorText } from '../../errorText'
import { DEPT_NAMES, MARK_NAMES, SHEET_TYPE_NAMES, STATUS_NAMES, useFormat, usePick, useT } from '../../i18n'
import { useDebounced, useQuery, useService } from '../../services'

const PAGE_SIZE = 25

// Поиск студента по справочнику: при сотнях студентов обычный выпадающий список неудобен.
function StudentPicker({ value, onChange }: { value: Student | null; onChange: (s: Student | null) => void }) {
  const t = useT()
  const service = useService()
  const [q, setQ] = useState('')
  const needle = useDebounced(q.trim())
  const found = useQuery(['pick', needle], () => (needle.length >= 2 ? service.listStudents({ q: needle, pageSize: 8 }) : Promise.resolve({ items: [], total: 0 })))

  if (value)
    return (
      <div className="picked">
        <span>
          {value.name}, {value.group}
        </span>
        <button className="btn btn--quiet btn--sm" type="button" onClick={() => onChange(null)}>
          {t('Изменить', 'Өзгерту')}
        </button>
      </div>
    )

  const items = found.data?.items ?? []
  return (
    <div className="picker">
      <input
        id="c-student"
        type="search"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={needle.length >= 2}
        aria-controls={needle.length >= 2 ? 'c-student-list' : undefined}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('ФИО или группа', 'Аты-жөні немесе тобы')}
      />
      {needle.length >= 2 && (
        <ul className="picker-list" id="c-student-list" role="listbox" aria-label={t('Найденные студенты', 'Табылған студенттер')}>
          {found.loading && items.length === 0 && <li className="muted">{t('Ищем…', 'Іздеп жатырмыз…')}</li>}
          {!found.loading && items.length === 0 && <li className="muted">{t('Никого не нашли. Студента можно добавить в разделе «Студенты».', 'Ешкім табылмады. Студентті «Студенттер» бөлімінде қосуға болады.')}</li>}
          {items.map((s) => (
            <li key={s.id} role="option" aria-selected={false}>
              <button type="button" onClick={() => onChange(s)}>
                <b>{s.name}</b> <span className="muted">{s.group}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function CreateForm({ onCreated }: { onCreated: () => void }) {
  const t = useT()
  const pick = usePick()
  const errorText = useErrorText()
  const service = useService()
  const templates = useQuery(['templates'], () => service.getTemplates())
  const [student, setStudent] = useState<Student | null>(null)
  const [type, setType] = useState<SheetType>('graduation')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ text: string; error?: boolean; number?: string } | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!student) return setResult({ text: t('Выберите студента.', 'Студентті таңдаңыз.'), error: true })
    setBusy(true)
    setResult(null)
    try {
      const s = await service.createSheet(student.id, type)
      setResult({ text: t(`Лист № ${s.number} открыт. Отделы уже видят его в своей очереди.`, `№ ${s.number} парақ ашылды. Бөлімдер оны кезегінде көріп отыр.`), number: s.number })
      setStudent(null)
      onCreated()
    } catch (err) {
      setResult({ text: errorText(err), error: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="create" onSubmit={submit} noValidate>
      <h2>{t('Открыть лист', 'Парақ ашу')}</h2>
      <div className="create-fields">
        <div className="field field--grow">
          <label htmlFor="c-student">{t('Студент', 'Студент')}</label>
          <StudentPicker value={student} onChange={setStudent} />
        </div>
        <div className="field">
          <label htmlFor="c-type">{t('Тип листа', 'Парақ түрі')}</label>
          <select id="c-type" value={type} onChange={(e) => setType(e.target.value as SheetType)}>
            {SHEET_TYPES.map((x) => (
              <option key={x} value={x}>
                {pick(SHEET_TYPE_NAMES[x])}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn--primary" type="submit" disabled={busy} aria-busy={busy}>
          {busy && <Spinner />}
          {t('Открыть лист', 'Парақ ашу')}
        </button>
      </div>
      {templates.data && (
        <p className="create-hint muted">
          {t('Отделы по шаблону', 'Үлгі бойынша бөлімдер')}: {templates.data[type].map((d) => pick(DEPT_NAMES[d])).join(', ')}
        </p>
      )}
      <p className={`flash ${result?.error ? 'is-error' : ''}`} role="status" aria-live="polite">
        {result?.text} {result?.number && <Link to={`/sheets/${result.number}`}>{t('Открыть карточку', 'Карточканы ашу')}</Link>}
      </p>
    </form>
  )
}

export default function AdminSheets() {
  const t = useT()
  const pick = usePick()
  const f = useFormat()
  const service = useService()
  const [status, setStatus] = useState<'all' | SheetStatus>('all')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const needle = useDebounced(q.trim())
  const summary = useQuery(['summary'], () => service.summary())
  const list = useQuery(['sheets', status, needle, page], () => service.listSheets({ status: status === 'all' ? undefined : status, q: needle, page, pageSize: PAGE_SIZE }))

  useEffect(() => {
    document.title = `${t('Учебная часть', 'Оқу бөлімі')} · AITU`
  })
  useEffect(() => setPage(1), [status, needle])

  const rows = list.data?.items ?? []

  return (
    <AppShell>
      <div className="admin">
        <h1 className="sr-only">{t('Обходные листы', 'Айналма парақтар')}</h1>
        {summary.data && (
          <p className="summary">
            {t('Открыто листов', 'Ашық парақтар')} <b>{summary.data.active}</b>, {t('из них с долгом', 'оның ішінде берешекпен')} <b className="is-debt">{summary.data.withDebt}</b>. {t('Закрыто в этом году', 'Биыл жабылды')} <b>{summary.data.closed}</b>.
          </p>
        )}
        <CreateForm
          onCreated={() => {
            list.reload()
            summary.reload()
          }}
        />
        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label={t('Статус листа', 'Парақ мәртебесі')}>
            {(['all', 'created', 'progress', 'debt', 'closed'] as const).map((id) => (
              <button key={id} role="tab" type="button" aria-selected={status === id} className="tab" onClick={() => setStatus(id)}>
                {id === 'all' ? t('Все', 'Барлығы') : pick(STATUS_NAMES[id])}
              </button>
            ))}
          </div>
          <label className="search">
            <Search size={18} aria-hidden="true" />
            <span className="sr-only">{t('Поиск', 'Іздеу')}</span>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ФИО, группа или №', 'Аты-жөні, тобы не №')} />
          </label>
        </div>
        {list.loading && !list.data ? (
          <Skeleton />
        ) : list.error && !list.data ? (
          <LoadError error={list.error} onRetry={list.reload} />
        ) : rows.length === 0 ? (
          <Empty title={needle || status !== 'all' ? t('Листов не найдено', 'Парақтар табылмады') : t('Листов пока нет', 'Әзірге парақтар жоқ')}>
            {needle || status !== 'all' ? t('Смените фильтр или уточните поиск.', 'Сүзгіні өзгертіңіз немесе іздеуді нақтылаңыз.') : t('Откройте первый лист формой выше: выберите студента и тип листа.', 'Алғашқы парақты жоғарыдағы формамен ашыңыз: студент пен парақ түрін таңдаңыз.')}
          </Empty>
        ) : (
          <>
            <table className="queue sheets-table">
              <thead>
                <tr>
                  <th>{t('Лист', 'Парақ')}</th>
                  <th>{t('Студент', 'Студент')}</th>
                  <th>{t('Отметки отделов', 'Бөлім белгілері')}</th>
                  <th>{t('Статус', 'Мәртебе')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.number}>
                    <td>
                      <Link className="num row-link" to={`/sheets/${s.number}`}>
                        № {s.number}
                      </Link>
                      <span className="muted">{pick(SHEET_TYPE_NAMES[s.type])}</span>
                    </td>
                    <td>
                      <span>{s.student.name}</span>
                      <span className="muted">{s.student.group}</span>
                    </td>
                    <td>
                      <span className="mark-strip">
                        {s.marks.map((m) => (
                          <Mark key={m.department} dept={m.department} state={m.state} size={30} label={`${pick(DEPT_NAMES[m.department])}: ${pick(MARK_NAMES[m.state])}`} />
                        ))}
                      </span>
                    </td>
                    <td>
                      <span className={`status status--${s.status}`}>{pick(STATUS_NAMES[s.status])}</span>
                      <span className="muted">{s.closedAt ? f.date(s.closedAt) : f.date(s.createdAt)}</span>
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
