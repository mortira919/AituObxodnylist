// Публичный лендинг `/` для администрации колледжа: показывает процесс, ведёт ко входу и к проверке документа.
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, FileText, ScanLine } from 'lucide-react'
import { DEPTS, NUMBER_RE, type DeptId, type MarkState } from '../../domain/clearance'
import { DEPT_NAMES, usePick, useT } from '../i18n'
import { Mark, Seal } from '../components/Mark'
import { Qr, verifyUrl } from '../components/Qr'
import { Brand, LangSwitch } from '../components/Shell'

// Сценарий живого листа в первом экране: отделы отмечают параллельно,
// библиотека сначала ставит долг, потом снимает его, и закрытый лист получает печать.
const SCRIPT: [number, DeptId, MarkState][] = [
  [700, 'accounting', 'clear'],
  [1000, 'it', 'clear'],
  [1300, 'library', 'debt'],
  [1700, 'academic', 'clear'],
  [2300, 'dorm', 'clear'],
  [2700, 'military', 'clear'],
  [4700, 'library', 'clear'],
]
const ASSEMBLE_AT = 5600
const LOOP = 11000
const YEAR = new Date().getFullYear()
const DEMO_NUMBER = `${YEAR}-0142`
const DEMO_CLOSED = new Date().toISOString()

function useHeroSheet() {
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const [tick, setTick] = useState(reduced ? LOOP : 0)
  useEffect(() => {
    if (reduced) return
    const t0 = performance.now()
    const id = setInterval(() => setTick((performance.now() - t0) % LOOP), 100)
    return () => clearInterval(id)
  }, [reduced])
  const states = Object.fromEntries(DEPTS.map((d) => [d, 'pending'])) as Record<DeptId, MarkState>
  for (const [at, d, s] of SCRIPT) if (tick >= at) states[d] = s
  return { states, assembled: tick >= ASSEMBLE_AT }
}

function HeroSheet() {
  const t = useT()
  const pick = usePick()
  const { states, assembled } = useHeroSheet()
  const done = DEPTS.filter((d) => states[d] === 'clear').length
  const debt = states.library === 'debt'
  return (
    <figure className={`hero-sheet ${assembled ? 'is-closed' : ''}`} aria-label={t('Пример обходного листа', 'Айналма парақ үлгісі')}>
      <div className="hero-sheet-head">
        <span>{t('Обходной лист', 'Айналма парақ')} № {DEMO_NUMBER}</span>
        <span>{t('Выпуск · Айгерим С., ПО-2201', 'Бітіру · Айгерим С., ПО-2201')}</span>
      </div>
      <div className="hero-stage">
        <ol className="hero-marks" aria-live="polite">
          {DEPTS.map((d) => (
            <li key={d} className={`hero-mark is-${states[d]}`}>
              <Mark dept={d} state={states[d]} size={72} />
              <span className="hero-mark-name">{pick(DEPT_NAMES[d])}</span>
            </li>
          ))}
        </ol>
        <div className="hero-closed" aria-hidden={!assembled}>
          <Seal number={DEMO_NUMBER} closedAt={DEMO_CLOSED} size={250} stamped={assembled} />
        </div>
      </div>
      <figcaption className="hero-sheet-foot">
        {assembled ? (
          <span className="hero-foot-closed">
            <Qr text={verifyUrl(DEMO_NUMBER)} size={64} className="qr--light" />
            <span>
              <strong>{t('Лист закрыт', 'Парақ жабық')}</strong>
              {t('Все шесть отделов подтвердили: задолженностей нет. Печать и QR-код подтверждают подлинность.', 'Алты бөлімнің бәрі растады: берешек жоқ. Мөр мен QR-код түпнұсқалықты растайды.')}
            </span>
          </span>
        ) : debt ? (
          <span className="is-debt">{t('Библиотека: вернуть «Python. Основы», до 20 мая', 'Кітапхана: «Python. Негіздері» кітабын 20 мамырға дейін қайтару')}</span>
        ) : (
          <span>
            {t('Отметок', 'Белгілер')}: <b>{done}</b> / 6
          </span>
        )}
      </figcaption>
    </figure>
  )
}

function RoleEntries({ dark = false }: { dark?: boolean }) {
  const t = useT()
  return (
    <div className={`role-entries ${dark ? 'on-dark' : ''}`}>
      <Link className="btn btn--primary btn--lg" to="/login">
        {t('Войти', 'Кіру')}
        <ArrowRight size={18} aria-hidden="true" />
      </Link>
      <Link className="btn btn--ghost btn--lg" to="/verify">
        {t('Проверить документ', 'Құжатты тексеру')}
      </Link>
    </div>
  )
}

function Routes() {
  const t = useT()
  const pick = usePick()
  return (
    <div className="routes">
      <div className="route route--paper">
        <h3>{t('Сейчас: по очереди', 'Қазір: кезекпен')}</h3>
        <p>{t('Студент носит бумагу из кабинета в кабинет и подстраивается под часы приёма каждого отдела.', 'Студент қағазды кабинеттен кабинетке тасиды және әр бөлімнің қабылдау уақытына бейімделеді.')}</p>
        <ol className="route-line" aria-label={t('Последовательный маршрут', 'Кезекті бағыт')}>
          {DEPTS.map((d, i) => (
            <li key={d}>
              <Mark dept={d} state={i < 2 ? 'clear' : i === 2 ? 'debt' : 'pending'} size={36} />
              <span>{pick(DEPT_NAMES[d])}</span>
            </li>
          ))}
        </ol>
        <p className="route-note">{t('Долг в третьем кабинете останавливает весь маршрут, а узнаёт студент о нём только у двери.', 'Үшінші кабинеттегі берешек бүкіл бағытты тоқтатады, ал студент ол туралы есік алдында ғана біледі.')}</p>
      </div>
      <div className="route route--online">
        <h3>{t('Онлайн: одновременно', 'Онлайн: бір мезгілде')}</h3>
        <p>{t('Учебная часть открывает лист, и все отделы видят его у себя сразу. Студент приходит только туда, где есть долг.', 'Оқу бөлімі парақты ашады, барлық бөлім оны бірден көреді. Студент тек берешек бар жерге барады.')}</p>
        <div className="route-fan" aria-label={t('Параллельная обработка', 'Қатар өңдеу')}>
          <svg className="route-fan-lines" viewBox="0 0 300 200" preserveAspectRatio="none" aria-hidden="true">
            {DEPTS.map((d, i) => (
              <path key={d} d={`M4 100 C 110 100, 150 ${(i + 0.5) * 33.33}, 300 ${(i + 0.5) * 33.33}`} />
            ))}
          </svg>
          <span className="route-fan-origin">
            <span className="doc-origin" role="img" aria-label={t('Обходной лист', 'Айналма парақ')}>
              <FileText size={32} strokeWidth={1.75} aria-hidden="true" />
            </span>
          </span>
          <ul>
            {DEPTS.map((d) => (
              <li key={d}>
                <Mark dept={d} state={d === 'library' ? 'debt' : 'clear'} size={30} />
                <span>{pick(DEPT_NAMES[d])}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="route-note">{t('Долг виден заранее, с описанием и сроком. Остальные отделы не ждут своей очереди.', 'Берешек сипаттамасы мен мерзімімен алдын ала көрінеді. Басқа бөлімдер кезек күтпейді.')}</p>
      </div>
    </div>
  )
}

function VerifyForm() {
  const t = useT()
  const nav = useNavigate()
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const v = value.trim()
    if (!NUMBER_RE.test(v)) return setError(t('Номер выглядит так: 2026-0139', 'Нөмір мынадай болады: 2026-0139'))
    nav(`/verify/${v}`)
  }
  return (
    <form className="verify-inline" onSubmit={submit} noValidate>
      <label htmlFor="vnum">{t('Номер листа', 'Парақ нөмірі')}</label>
      <div className="field-row">
        <input
          id="vnum"
          inputMode="numeric"
          placeholder="2026-0139"
          value={value}
          aria-invalid={!!error}
          aria-describedby={error ? 'vnum-err' : undefined}
          onChange={(e) => {
            setValue(e.target.value)
            setError('')
          }}
        />
        <button className="btn btn--primary" type="submit">
          <ScanLine size={18} aria-hidden="true" />
          {t('Проверить', 'Тексеру')}
        </button>
      </div>
      {error && (
        <p className="field-error" id="vnum-err" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}

export default function Landing() {
  const t = useT()
  const pick = usePick()
  return (
    <div className="landing">
      <a className="skip" href="#hero">
        {t('К содержанию', 'Мазмұнға өту')}
      </a>
      <section className="hero on-dark" id="hero">
        <header className="topbar">
          <Brand />
          <nav aria-label={t('Разделы', 'Бөлімдер')}>
            <a href="#how">{t('Как это работает', 'Қалай жұмыс істейді')}</a>
            <a href="#roles">{t('Роли', 'Рөлдер')}</a>
            <a href="#verify">{t('Подлинность', 'Түпнұсқалық')}</a>
          </nav>
          <LangSwitch />
        </header>
        <div className="hero-grid">
          <div className="hero-copy">
            <h1>{t('Обходной лист без очереди по кабинетам', 'Кабинеттерді кезекпен аралаусыз айналма парақ')}</h1>
            <p className="lead">
              {t(
                'Отделы колледжа AITU ставят отметки одновременно, а студент сразу видит, кто его держит и почему.',
                'AITU колледжінің бөлімдері белгілерді бір мезгілде қояды, ал студент кім неге ұстап тұрғанын бірден көреді.',
              )}
            </p>
            <RoleEntries dark />
            <p className="hero-note">
              {t('Студенты, сотрудники отделов и учебная часть входят под логином колледжа.', 'Студенттер, бөлім қызметкерлері және оқу бөлімі колледж логинімен кіреді.')}
            </p>
          </div>
          <HeroSheet />
        </div>
      </section>

      <section className="band" id="how" aria-labelledby="how-h">
        <div className="band-inner">
          <h2 id="how-h">{t('Тот же процесс, только параллельно', 'Сол процесс, тек қатар')}</h2>
          <Routes />
        </div>
      </section>

      <section className="band band--alt" id="roles" aria-labelledby="roles-h">
        <div className="band-inner">
          <h2 id="roles-h">{t('Каждый видит только своё', 'Әркім тек өзінікін көреді')}</h2>
          <div className="role-rows">
            <article className="role-row">
              <h3>{t('Студент', 'Студент')}</h3>
              <p>{t('Открывает лист с телефона и видит, кто его держит, что вернуть или оплатить, где кабинет и до какого числа. Уведомления приходят в Telegram.', 'Парақты телефоннан ашып, кім ұстап тұрғанын, нені қайтару не төлеу керегін, кабинет қайда және қай күнге дейін екенін көреді. Хабарламалар Telegram-ға келеді.')}</p>
              <div className="role-sample">
                <Mark dept="library" state="debt" size={36} />
                <div>
                  <b>{pick(DEPT_NAMES.library)}</b>
                  <span className="is-debt">{t('Вернуть «Python. Основы», до 20 мая', '«Python. Негіздері» кітабын 20 мамырға дейін қайтару')}</span>
                </div>
              </div>
            </article>
            <article className="role-row">
              <h3>{t('Сотрудник отдела', 'Бөлім қызметкері')}</h3>
              <p>{t('Видит очередь листов своего отдела и закрывает отметку одной кнопкой. В сезон выпуска отмечает сразу пачку студентов без долгов.', 'Өз бөлімінің парақтар кезегін көріп, белгіні бір батырмамен қояды. Бітіру маусымында берешегі жоқ студенттерді бірден топпен белгілейді.')}</p>
              <div className="role-sample role-sample--pair">
                <span className="sample-state">
                  <Mark dept="it" state="clear" size={30} />
                  {t('Нет задолженности', 'Берешек жоқ')}
                </span>
                <span className="sample-state is-debt">
                  <Mark dept="dorm" state="debt" size={30} />
                  {t('Есть долг', 'Берешек бар')}
                </span>
              </div>
            </article>
            <article className="role-row">
              <h3>{t('Учебная часть', 'Оқу бөлімі')}</h3>
              <p>{t('Открывает листы, настраивает, какие отделы входят в каждый тип листа, и видит, где листы застряли. Каждое действие попадает в журнал.', 'Парақтарды ашады, әр парақ түріне қай бөлімдер кіретінін баптайды және парақтар қай жерде тұрып қалғанын көреді. Әр әрекет журналға жазылады.')}</p>
              <div className="role-sample role-sample--marks">
                {DEPTS.map((d, i) => (
                  <Mark key={d} dept={d} state={i < 4 ? 'clear' : i === 4 ? 'debt' : 'pending'} size={26} label={pick(DEPT_NAMES[d])} />
                ))}
              </div>
            </article>
          </div>
        </div>
      </section>

      <section className="band" id="verify" aria-labelledby="verify-h">
        <div className="band-inner verify-band">
          <div>
            <h2 id="verify-h">{t('Закрытый лист нельзя подделать незаметно', 'Жабық парақты байқатпай қолдан жасау мүмкін емес')}</h2>
            <p className="measure">
              {t(
                'Когда все отделы подтвердили отсутствие долгов, лист закрывается и больше не меняется. Студент получает PDF с печатью и QR-кодом. Отдел кадров или другой колледж сканирует код и видит, что лист настоящий.',
                'Барлық бөлім берешек жоқ екенін растағанда парақ жабылады және енді өзгермейді. Студент мөрі мен QR-коды бар PDF алады. Кадр бөлімі немесе басқа колледж кодты сканерлеп, парақтың түпнұсқа екенін көреді.',
              )}
            </p>
            <VerifyForm />
          </div>
          <div>
            <div className="verify-proof">
              <Seal number={`${YEAR}-0139`} closedAt={DEMO_CLOSED} size={150} />
              <p>{t('На печати номер листа и дата закрытия. Проверяющий сканирует QR-код и видит ту же печать на сайте колледжа.', 'Мөрде парақ нөмірі мен жабылған күні бар. Тексеруші QR-кодты сканерлеп, колледж сайтынан дәл сол мөрді көреді.')}</p>
            </div>
          <dl className="facts">
            <div>
              <dt>{t('Неизменяемость', 'Өзгермейтіндік')}</dt>
              <dd>{t('Закрытый лист заблокирован для правок, в том числе для учебной части.', 'Жабық парақты ешкім өзгерте алмайды, оқу бөлімі де.')}</dd>
            </div>
            <div>
              <dt>{t('Журнал действий', 'Әрекеттер журналы')}</dt>
              <dd>{t('Кто, когда и какую отметку поставил или снял.', 'Кім, қашан, қандай белгі қойды немесе алды.')}</dd>
            </div>
            <div>
              <dt>{t('Минимум данных', 'Деректер барынша аз')}</dt>
              <dd>{t('Страница проверки показывает имя с первой буквой фамилии, тип листа и дату закрытия. Долги и суммы не показывает.', 'Тексеру беті аты мен тегінің бірінші әрпін, парақ түрін және жабылған күнін көрсетеді. Берешек пен соманы көрсетпейді.')}</dd>
            </div>
            <div>
              <dt>{t('Два языка', 'Екі тіл')}</dt>
              <dd>{t('Интерфейс на русском и казахском.', 'Интерфейс орыс және қазақ тілдерінде.')}</dd>
            </div>
          </dl>
          </div>
        </div>
      </section>

      <section className="close on-dark" aria-labelledby="close-h">
        <div className="band-inner">
          <h2 id="close-h">{t('Обходной лист колледжа теперь онлайн', 'Колледждің айналма парағы енді онлайн')}</h2>
          <RoleEntries dark />
        </div>
        <footer className="landing-foot">
          <Brand />
          <span>{t('Дипломный проект студентов колледжа Astana IT University. Это не официальный сервис университета. Пример листа на этой странице вымышлен.', 'Astana IT University колледжі студенттерінің дипломдық жобасы. Бұл университеттің ресми сервисі емес. Бұл беттегі парақ үлгісі ойдан алынған.')}</span>
        </footer>
      </section>
    </div>
  )
}
