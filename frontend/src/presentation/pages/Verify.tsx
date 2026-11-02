// Публичная проверка `/verify/:номер` по QR-коду: только закрытые листы и минимум личных данных.
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ScanLine } from 'lucide-react'
import { NUMBER_RE, type Verification } from '../../domain/clearance'
import { LoadError } from '../components/Feedback'
import { Mark, Seal } from '../components/Mark'
import { Brand, LangSwitch, Spinner } from '../components/Shell'
import { DEPT_NAMES, SHEET_TYPE_NAMES, useFormat, usePick, useT } from '../i18n'
import { useService } from '../services'

export default function Verify() {
  const t = useT()
  const pick = usePick()
  const f = useFormat()
  const nav = useNavigate()
  const service = useService()
  const { number = '' } = useParams()
  const [value, setValue] = useState(number)
  const [inputError, setInputError] = useState('')
  const [result, setResult] = useState<Verification | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    document.title = `${t('Проверка обходного листа', 'Айналма парақты тексеру')} · AITU`
  })

  useEffect(() => {
    setValue(number)
    setResult(null)
    setError(null)
    if (!NUMBER_RE.test(number)) return
    let live = true
    setLoading(true)
    service
      .verify(number)
      .then((r) => live && setResult(r))
      .catch((e) => live && setError(e))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [number, service, attempt])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const v = value.trim()
    if (!NUMBER_RE.test(v)) return setInputError(t('Номер выглядит так: 2026-0139', 'Нөмір мынадай болады: 2026-0139'))
    nav(`/verify/${v}`)
  }

  return (
    <div className="verify on-dark">
      <header className="topbar">
        <Brand />
        <LangSwitch />
      </header>
      <main className="verify-main" id="main">
        <h1>{t('Проверка обходного листа', 'Айналма парақты тексеру')}</h1>
        <form className="verify-inline" onSubmit={submit} noValidate>
          <label htmlFor="v-number">{t('Номер с QR-кода или из PDF', 'QR-кодтағы немесе PDF-тегі нөмір')}</label>
          <div className="field-row">
            <input
              id="v-number"
              inputMode="numeric"
              placeholder="2026-0139"
              value={value}
              aria-invalid={!!inputError}
              aria-describedby={inputError ? 'v-err' : undefined}
              onChange={(e) => {
                setValue(e.target.value)
                setInputError('')
              }}
            />
            <button className="btn btn--primary" type="submit" disabled={loading}>
              {loading ? <Spinner /> : <ScanLine size={18} aria-hidden="true" />}
              {t('Проверить', 'Тексеру')}
            </button>
          </div>
          {inputError && (
            <p className="field-error" id="v-err" role="alert">
              {inputError}
            </p>
          )}
        </form>

        <section className="verdict" aria-live="polite" aria-busy={loading}>
          {loading && <p className="verdict-wait">{t('Ищем лист в реестре колледжа…', 'Парақты колледж тізілімінен іздеп жатырмыз…')}</p>}
          {!loading && error != null && <LoadError error={error} onRetry={() => setAttempt((a) => a + 1)} />}
          {!loading && result && !result.found && (
            <div className="verdict-bad">
              <h2>{t('Лист с таким номером не найден', 'Мұндай нөмірлі парақ табылмады')}</h2>
              <p>{t('Проверьте номер. Если он совпадает с документом, документ мог быть подделан: свяжитесь с учебной частью колледжа.', 'Нөмірді тексеріңіз. Егер ол құжатпен сәйкес келсе, құжат қолдан жасалған болуы мүмкін: колледждің оқу бөлімімен байланысыңыз.')}</p>
            </div>
          )}
          {!loading && result?.found && !result.closed && (
            <div className="verdict-bad">
              <h2>{t('Лист ещё не закрыт', 'Парақ әлі жабылмаған')}</h2>
              <p>
                {result.shortName}. {t('Не все отделы подтвердили отсутствие задолженности, поэтому документ пока недействителен.', 'Барлық бөлім берешек жоқ екенін растаған жоқ, сондықтан құжат әзірге жарамсыз.')}
              </p>
            </div>
          )}
          {!loading && result?.closed && result.number && result.closedAt && (
            <div className="verdict-ok">
              <Seal number={result.number} closedAt={result.closedAt} size={220} />
              <div>
                <h2>{t('Документ подлинный', 'Құжат түпнұсқа')}</h2>
                <dl className="verdict-facts">
                  <div>
                    <dt>{t('Студент', 'Студент')}</dt>
                    <dd>{result.shortName}</dd>
                  </div>
                  <div>
                    <dt>{t('Лист', 'Парақ')}</dt>
                    <dd>
                      {result.type && pick(SHEET_TYPE_NAMES[result.type])}, № {result.number}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('Закрыт', 'Жабылды')}</dt>
                    <dd>{f.full(result.closedAt)}</dd>
                  </div>
                </dl>
                <ul className="verdict-marks" aria-label={t('Отделы, подтвердившие отсутствие задолженности', 'Берешек жоқ екенін растаған бөлімдер')}>
                  {(result.departments ?? []).map((d) => (
                    <li key={d}>
                      <Mark dept={d} state="clear" size={28} />
                      {pick(DEPT_NAMES[d])}
                    </li>
                  ))}
                </ul>
                <p className="verdict-note">{t('Номер и дата на печати документа должны совпадать с этой страницей.', 'Құжаттағы мөрдің нөмірі мен күні осы бетпен сәйкес келуі керек.')}</p>
              </div>
            </div>
          )}
          {!loading && !result && !error && !number && <p className="verdict-wait">{t('Введите номер, чтобы увидеть, действителен ли лист.', 'Парақтың жарамдылығын көру үшін нөмірді енгізіңіз.')}</p>}
        </section>
      </main>
      <footer className="verify-foot">{t('Дипломный проект студентов колледжа Astana IT University, не официальный сервис университета.', 'Astana IT University колледжі студенттерінің дипломдық жобасы, университеттің ресми сервисі емес.')}</footer>
    </div>
  )
}
