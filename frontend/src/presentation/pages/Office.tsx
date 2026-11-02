// Кабинет отдела `/office`: очередь листов своего отдела, отметка одной кнопкой, долг с описанием, массовая отметка.
import { Fragment, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Lock, Search } from 'lucide-react'
import { markOf, NOTE_MAX, type DeptId, type MarkState, type Sheet } from '../../domain/clearance'
import { useAuth } from '../auth'
import { Empty, LoadError, Pager, Skeleton } from '../components/Feedback'
import { Mark } from '../components/Mark'
import { AppShell, Spinner } from '../components/Shell'
import { errorField, useErrorText } from '../errorText'
import { DEPT_NAMES, SHEET_TYPE_NAMES, useFormat, usePick, useT } from '../i18n'
import { useDebounced, useQuery, useService } from '../services'

const PAGE_SIZE = 25

export function DebtForm({ sheet, dept, onDone }: { sheet: Sheet; dept: DeptId; onDone: (msg?: string) => void }) {
  const t = useT()
  const errorText = useErrorText()
  const service = useService()
  const current = markOf(sheet, dept)
  const [note, setNote] = useState(current?.state === 'debt' ? (current.note ?? '') : '')
  const [due, setDue] = useState(current?.state === 'debt' ? (current.due ?? '') : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const today = new Date().toISOString().slice(0, 10)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await service.setMark(sheet.number, dept, { state: 'debt', note, due })
      onDone(t('Долг записан. Студент увидит его в своём кабинете.', 'Берешек жазылды. Студент оны өз кабинетінде көреді.'))
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  const field = errorField(error)

  return (
    <form className="debt-form" onSubmit={submit} onKeyDown={(e) => e.key === 'Escape' && onDone()} noValidate>
      <div className="field">
        <label htmlFor={`note-${sheet.number}`}>{t('Что должен студент', 'Студенттің берешегі')}</label>
        <textarea
          id={`note-${sheet.number}`}
          autoFocus
          rows={2}
          maxLength={NOTE_MAX}
          value={note}
          placeholder={t('Например: вернуть книгу «Базы данных», инв. № 2210', 'Мысалы: «Деректер базасы» кітабын қайтару, инв. № 2210')}
          aria-invalid={field === 'note'}
          onChange={(e) => setNote(e.target.value)}
        />
        <span className="counter">
          {note.length}/{NOTE_MAX}
        </span>
      </div>
      <div className="field field--date">
        <label htmlFor={`due-${sheet.number}`}>{t('Срок', 'Мерзім')}</label>
        <input id={`due-${sheet.number}`} type="date" min={today} value={due} aria-invalid={field === 'due'} onChange={(e) => setDue(e.target.value)} />
      </div>
      <div className="debt-form-actions">
        <button className="btn btn--danger" type="submit" disabled={busy} aria-busy={busy}>
          {busy && <Spinner />}
          {t('Записать долг', 'Берешекті жазу')}
        </button>
        <button className="btn btn--quiet" type="button" onClick={() => onDone()}>
          {t('Отмена', 'Болдырмау')}
        </button>
      </div>
      {error != null && (
        <p className="field-error" role="alert">
          {errorText(error)}
        </p>
      )}
    </form>
  )
}

export default function Office() {
  const t = useT()
  const pick = usePick()
  const f = useFormat()
  const errorText = useErrorText()
  const service = useService()
  const { user } = useAuth()
  const dept = user!.departmentId!
  const [tab, setTab] = useState<MarkState>('pending')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)
  const needle = useDebounced(q.trim())

  const counts = useQuery(['queueCounts'], () => service.queueCounts())
  const list = useQuery(['queue', tab, needle, page], () => service.listSheets({ department: dept, markState: tab, q: needle, page, pageSize: PAGE_SIZE }))
  const reloadAll = () => {
    counts.reload()
    list.reload()
  }

  useEffect(() => {
    document.title = `${pick(DEPT_NAMES[dept])} · AITU`
  })
  // Новый поиск снимает выделение, чтобы массовая отметка не задела скрытые строки.
  // Открытую форму долга закрывает только смена вкладки: поиск догоняет ввод с задержкой
  // и не должен захлопывать форму, которую человек уже открыл.
  useEffect(() => {
    setSelected(new Set())
    setPage(1)
  }, [tab, needle])
  useEffect(() => setEditing(null), [tab])

  const withBusy = async (numbers: string[], fn: () => Promise<void>) => {
    setBusy((b) => new Set([...b, ...numbers]))
    try {
      await fn()
    } finally {
      setBusy((b) => new Set([...b].filter((n) => !numbers.includes(n))))
      reloadAll()
    }
  }

  const clear = (s: Sheet) =>
    withBusy([s.number], async () => {
      try {
        const next = await service.setMark(s.number, dept, { state: 'clear' })
        setMessage({
          text: next.closedAt
            ? t(`${s.student.name}: все отделы отметились, лист закрыт.`, `${s.student.name}: барлық бөлім белгі қойды, парақ жабылды.`)
            : t(`${s.student.name}: отмечено без задолженности.`, `${s.student.name}: берешек жоқ деп белгіленді.`),
        })
      } catch (e) {
        setMessage({ text: errorText(e), error: true })
      }
    })

  const clearSelected = () => {
    const numbers = [...selected]
    withBusy(numbers, async () => {
      try {
        const res = await service.bulkClear(numbers)
        setSelected(new Set())
        setMessage(
          res.failed.length === 0
            ? { text: t(`Отмечено без задолженности: ${res.updated.length}.`, `Берешек жоқ деп белгіленді: ${res.updated.length}.`) }
            : { text: t(`Отмечено ${res.updated.length} из ${numbers.length}. Остальные листы изменились, проверьте их.`, `${numbers.length} парақтың ${res.updated.length}-і белгіленді. Қалғандары өзгерген, тексеріңіз.`), error: true },
        )
      } catch (e) {
        setMessage({ text: errorText(e), error: true })
      }
    })
  }

  const tabs: [MarkState, string][] = [
    ['pending', t('Ожидают', 'Күтуде')],
    ['debt', t('С долгом', 'Берешекпен')],
    ['clear', t('Отмечены', 'Белгіленген')],
  ]
  const rows = list.data?.items ?? []
  const allSelected = rows.length > 0 && rows.every((s) => selected.has(s.number))

  return (
    <AppShell>
      <div className="office">
        <header className="page-head">
          <Mark dept={dept} state="identity" size={52} />
          <div>
            <h1>{pick(DEPT_NAMES[dept])}</h1>
            <p className="muted">{t('Вы видите только отметки своего отдела.', 'Сіз тек өз бөліміңіздің белгілерін көресіз.')}</p>
          </div>
        </header>

        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label={t('Фильтр по отметке', 'Белгі бойынша сүзгі')}>
            {tabs.map(([id, label]) => (
              <button key={id} role="tab" type="button" aria-selected={tab === id} className={`tab tab--${id}`} onClick={() => setTab(id)}>
                {label} <span className="tab-count">{counts.data?.[id] ?? '…'}</span>
              </button>
            ))}
          </div>
          <label className="search">
            <Search size={18} aria-hidden="true" />
            <span className="sr-only">{t('Поиск', 'Іздеу')}</span>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ФИО, группа или №', 'Аты-жөні, тобы не №')} />
          </label>
        </div>

        <p className={`flash ${message?.error ? 'is-error' : ''}`} role="status" aria-live="polite">
          {message?.text}
        </p>

        {tab === 'pending' && selected.size > 0 && (
          <div className="bulk">
            <span>
              {t('Выбрано', 'Таңдалды')}: <b>{selected.size}</b>
            </span>
            <button className="btn btn--primary" type="button" onClick={clearSelected} disabled={busy.size > 0}>
              {busy.size > 0 && <Spinner />}
              {t('Отметить без задолженности', 'Берешек жоқ деп белгілеу')}
            </button>
            <button className="btn btn--quiet" type="button" onClick={() => setSelected(new Set())}>
              {t('Снять выбор', 'Таңдауды алу')}
            </button>
          </div>
        )}

        {list.loading && !list.data ? (
          <Skeleton />
        ) : list.error && !list.data ? (
          <LoadError error={list.error} onRetry={list.reload} />
        ) : rows.length === 0 ? (
          <Empty
            title={
              needle
                ? t('Ничего не нашлось', 'Ештеңе табылмады')
                : tab === 'pending'
                  ? t('Очередь пуста', 'Кезек бос')
                  : tab === 'debt'
                    ? t('Должников нет', 'Берешегі барлар жоқ')
                    : t('Отметок пока нет', 'Әзірге белгілер жоқ')
            }
          >
            {needle
              ? t('Проверьте написание или ищите по номеру листа.', 'Жазылуын тексеріңіз немесе парақ нөмірі бойынша іздеңіз.')
              : tab === 'pending'
                ? t('Новые листы появятся здесь, как только учебная часть их откроет.', 'Оқу бөлімі жаңа парақтарды ашқан бойда олар осында пайда болады.')
                : tab === 'debt'
                  ? t('Если у студента есть долг, нажмите «Есть долг» в очереди и опишите, что вернуть.', 'Студентте берешек болса, кезекте «Берешек бар» батырмасын басып, нені қайтару керегін жазыңыз.')
                  : t('Здесь будут листы, которые вы отметили без задолженности.', 'Мұнда сіз берешегі жоқ деп белгілеген парақтар болады.')}
          </Empty>
        ) : (
          <>
            <table className="queue">
              <thead>
                <tr>
                  {tab === 'pending' && (
                    <th className="col-check">
                      <input type="checkbox" aria-label={t('Выбрать все', 'Бәрін таңдау')} checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((s) => s.number)))} />
                    </th>
                  )}
                  <th>{t('Студент', 'Студент')}</th>
                  <th>{t('Лист', 'Парақ')}</th>
                  <th>{tab === 'pending' ? t('Открыт', 'Ашылды') : t('Отметка', 'Белгі')}</th>
                  <th className="col-actions">
                    <span className="sr-only">{t('Действия', 'Әрекеттер')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const m = markOf(s, dept)!
                  const isBusy = busy.has(s.number)
                  return (
                    <Fragment key={s.number}>
                      <tr className={selected.has(s.number) ? 'is-selected' : ''}>
                        {tab === 'pending' && (
                          <td className="col-check">
                            <input
                              type="checkbox"
                              aria-label={s.student.name}
                              checked={selected.has(s.number)}
                              onChange={() =>
                                setSelected((cur) => {
                                  const next = new Set(cur)
                                  if (next.has(s.number)) next.delete(s.number)
                                  else next.add(s.number)
                                  return next
                                })
                              }
                            />
                          </td>
                        )}
                        <td>
                          <b>{s.student.name}</b>
                          <span className="muted">{s.student.group}</span>
                        </td>
                        <td>
                          <span>{pick(SHEET_TYPE_NAMES[s.type])}</span>
                          <Link className="muted num" to={`/sheets/${s.number}`}>
                            № {s.number}
                          </Link>
                        </td>
                        <td>
                          {tab === 'pending' && <span className="num">{f.dateTime(s.createdAt)}</span>}
                          {tab === 'debt' && (
                            <>
                              <span className="is-debt">{m.note}</span>
                              {m.due && (
                                <span className="muted">
                                  {t('до', 'дейін')} {f.date(m.due)}
                                </span>
                              )}
                            </>
                          )}
                          {tab === 'clear' && (
                            <span className="muted">
                              {m.by} · {m.at && f.dateTime(m.at)}
                            </span>
                          )}
                        </td>
                        <td className="col-actions">
                          {s.closedAt ? (
                            <span className="locked">
                              <Lock size={16} aria-hidden="true" />
                              {t('Лист закрыт', 'Парақ жабық')}
                            </span>
                          ) : (
                            <div className="row-actions">
                              {m.state !== 'clear' && (
                                <button className="btn btn--primary btn--sm" type="button" disabled={isBusy} aria-busy={isBusy} onClick={() => clear(s)}>
                                  {isBusy && <Spinner />}
                                  {m.state === 'debt' ? t('Долг погашен', 'Берешек өтелді') : t('Нет задолженности', 'Берешек жоқ')}
                                </button>
                              )}
                              <button className="btn btn--quiet btn--sm" type="button" disabled={isBusy} aria-expanded={editing === s.number} onClick={() => setEditing(editing === s.number ? null : s.number)}>
                                {m.state === 'debt' ? t('Изменить', 'Өзгерту') : t('Есть долг', 'Берешек бар')}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                      {editing === s.number && (
                        <tr className="edit-row">
                          <td colSpan={tab === 'pending' ? 5 : 4}>
                            <DebtForm
                              sheet={s}
                              dept={dept}
                              onDone={(msg) => {
                                setEditing(null)
                                if (msg) {
                                  setMessage({ text: msg })
                                  reloadAll()
                                }
                              }}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
            <Pager page={page} pageSize={PAGE_SIZE} total={list.data?.total ?? 0} onPage={setPage} />
          </>
        )}
      </div>
    </AppShell>
  )
}
