// Точка сборки приложения: здесь слои соединяются между собой.
// Адрес API задаёт VITE_API_URL (по умолчанию /api/v1, в разработке его проксирует Vite).
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geologica/full.css'
import './presentation/styles.css'
import { createClearance } from './application/clearance'
import { createHttpApi } from './infrastructure/httpApi'
import App from './presentation/App'
import { LangProvider } from './presentation/i18n'
import { ServiceProvider } from './presentation/services'

const api = createHttpApi(import.meta.env.VITE_API_URL ?? '/api/v1', () => {
  // сессия истекла посреди работы: на вход, с возвратом на текущую страницу
  if (!location.pathname.startsWith('/login')) location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}`)
})
const service = createClearance(api)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LangProvider>
      <ServiceProvider service={service}>
        <App />
      </ServiceProvider>
    </LangProvider>
  </StrictMode>,
)
