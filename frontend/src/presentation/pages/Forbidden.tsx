import { Link } from 'react-router-dom'
import { homeOf } from '../../domain/clearance'
import { useAuth } from '../auth'
import { Mark } from '../components/Mark'
import { AppShell } from '../components/Shell'
import { useT } from '../i18n'

// Показывается внутри кабинета, когда роль не позволяет открыть раздел
// (например, студент открыл ссылку учебной части): шапка и выход остаются на месте.
export function Forbidden() {
  const t = useT()
  const { user } = useAuth()
  return (
    <AppShell>
      <div className="forbidden">
        <Mark dept="academic" state="identity" size={72} />
        <h1>{t('Нет доступа к этому разделу', 'Бұл бөлімге рұқсат жоқ')}</h1>
        <p>{t('Раздел открыт для другой роли. Если доступ нужен по работе, обратитесь в учебную часть.', 'Бөлім басқа рөлге арналған. Жұмысқа қажет болса, оқу бөліміне жүгініңіз.')}</p>
        <Link className="btn btn--primary" to={user ? homeOf(user.role) : '/login'}>
          {t('В мой кабинет', 'Менің кабинетіме')}
        </Link>
      </div>
    </AppShell>
  )
}
