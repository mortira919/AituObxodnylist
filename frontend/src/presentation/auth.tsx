// Кто вошёл и куда ему можно. Права окончательно проверяет сервер, здесь только навигация:
// не показывать студенту кабинет учебной части и отправлять на вход без сессии.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import type { Role, User } from '../domain/clearance'
import { Forbidden } from './pages/Forbidden'
import { useService } from './services'

interface AuthState {
  user: User | null
  loading: boolean
  login: (login: string, password: string) => Promise<User>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthCtx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const service = useService()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      setUser(await service.me())
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [service])

  useEffect(() => {
    refresh()
  }, [refresh])

  const login = useCallback(
    async (login: string, password: string) => {
      const u = await service.login(login, password)
      setUser(u)
      return u
    },
    [service],
  )

  const logout = useCallback(async () => {
    try {
      await service.logout()
    } finally {
      setUser(null)
    }
  }, [service])

  return <AuthCtx.Provider value={{ user, loading, login, logout, refresh }}>{children}</AuthCtx.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth вызван вне AuthProvider')
  return ctx
}

// Обёртка маршрута: без сессии ведёт на вход и запоминает, куда человек шёл.
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <div className="splash" aria-busy="true" />
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  // с временным паролем пускаем только на его смену
  if (user.mustChangePassword && location.pathname !== '/account') return <Navigate to="/account" replace />
  if (!roles.includes(user.role)) return <Forbidden />
  return <>{children}</>
}
