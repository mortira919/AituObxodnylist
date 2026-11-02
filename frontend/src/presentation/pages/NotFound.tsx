import { Link } from 'react-router-dom'
import { useT } from '../i18n'
import { Mark } from '../components/Mark'

export default function NotFound() {
  const t = useT()
  return (
    <main className="notfound on-dark">
      <Mark dept="academic" state="identity" size={96} />
      <h1>{t('Такой страницы нет', 'Мұндай бет жоқ')}</h1>
      <p>{t('Возможно, ссылка устарела.', 'Сілтеме ескірген болуы мүмкін.')}</p>
      <Link className="btn btn--primary" to="/">
        {t('На главную', 'Басты бетке')}
      </Link>
    </main>
  )
}
