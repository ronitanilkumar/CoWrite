import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { getMe, type AuthUser } from './api'

interface AuthState {
  user: AuthUser | null
  loading: boolean
}

const AuthContext = createContext<AuthState>({ user: null, loading: true })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getMe().then(u => {
      setUser(u)
      setLoading(false)
    })
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
