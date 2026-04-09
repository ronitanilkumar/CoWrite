export interface StoredUser {
  id: string
  name: string
  color: string
}

export const getOrCreateUser = (): StoredUser => {
  const stored = localStorage.getItem('cowrite-user')
  if (stored) {
    try {
      return JSON.parse(stored)
    } catch {
      localStorage.removeItem('cowrite-user')
    }
  }

  const colors = [
    '#f783ac', '#74c0fc', '#63e6be',
    '#ffd43b', '#a9e34b', '#ff8c42', '#c77dff'
  ]
  const color = colors[Math.floor(Math.random() * colors.length)]

  const user: StoredUser = {
    id: crypto.randomUUID(),
    name: '',
    color,
  }

  localStorage.setItem('cowrite-user', JSON.stringify(user))
  return user
}

export const updateUserName = (name: string): StoredUser => {
  const user = getOrCreateUser()
  const updated = { ...user, name }
  localStorage.setItem('cowrite-user', JSON.stringify(updated))
  return updated
}

export const storedUser = getOrCreateUser()
