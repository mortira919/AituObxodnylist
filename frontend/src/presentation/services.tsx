// Мост между React и слоем сценариев: сервис из контекста и хук загрузки данных.
// Страницы не знают, откуда приходят данные, поэтому их можно тестировать с любой реализацией порта.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Clearance } from '../application/clearance'

const ServiceCtx = createContext<Clearance | null>(null)

export function ServiceProvider({ service, children }: { service: Clearance; children: ReactNode }) {
  return <ServiceCtx.Provider value={service}>{children}</ServiceCtx.Provider>
}

export function useService(): Clearance {
  const service = useContext(ServiceCtx)
  if (!service) throw new Error('useService вызван вне ServiceProvider')
  return service
}

export interface Query<T> {
  data: T | undefined
  error: unknown
  loading: boolean
  reload: () => void
}

// Загружает данные при изменении ключа и при возврате на вкладку: отметка, поставленная
// в другом окне, появится, как только пользователь вернётся к этому.
export function useQuery<T>(key: unknown[], fetcher: () => Promise<T>): Query<T> {
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean }>({ loading: true })
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const keyStr = JSON.stringify(key)
  const run = useRef(0)
  const lastKey = useRef(keyStr)

  const reload = useCallback(() => {
    const id = ++run.current
    // новый ключ (другая вкладка, поиск, страница): данные прошлого запроса больше не про это,
    // иначе при сбое сети человек увидит чужой список и примет его за нужный
    const sameKey = lastKey.current === keyStr
    lastKey.current = keyStr
    setState((s) => (sameKey ? { ...s, loading: true } : { loading: true }))
    fetcherRef.current().then(
      (data) => id === run.current && setState({ data, loading: false }),
      (error) => id === run.current && setState((s) => ({ data: s.data, error, loading: false })),
    )
  }, [keyStr])

  useEffect(reload, [reload])

  useEffect(() => {
    const onFocus = () => document.visibilityState === 'visible' && reload()
    document.addEventListener('visibilitychange', onFocus)
    return () => document.removeEventListener('visibilitychange', onFocus)
  }, [reload])

  return { data: state.data, error: state.error, loading: state.loading, reload }
}

// Значение с задержкой: поиск уходит на сервер, когда человек перестал печатать.
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}
