const BASE = 'http://localhost:1234'

export async function registerUser(user: {
  id: string
  name: string
  color: string
}) {
  try {
    await fetch(`${BASE}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user),
    })
  } catch (err) {
    console.error('Failed to register user:', err)
  }
}

export async function getUserDocuments(userId: string) {
  try {
    const res = await fetch(`${BASE}/users/${userId}/documents`)
    if (!res.ok) return []
    return res.json()
  } catch (err) {
    console.error('Failed to get documents:', err)
    return []
  }
}

export async function createDocument(room: string, ownerId: string) {
  try {
    const res = await fetch(`${BASE}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room, owner_id: ownerId }),
    })
    return res.json()
  } catch (err) {
    console.error('Failed to create document:', err)
    return null
  }
}

export async function deleteDocument(room: string, userId: string) {
  try {
    const res = await fetch(
      `${BASE}/documents/${room}?user_id=${userId}`,
      { method: 'DELETE' }
    )
    return res.json()
  } catch (err) {
    console.error('Failed to delete document:', err)
    return null
  }
}

export async function getAllUsers(): Promise<{ id: string; name: string; color: string }[]> {
  try {
    const res = await fetch(`${BASE}/users`)
    if (!res.ok) return []
    return res.json()
  } catch (err) {
    console.error('Failed to get users:', err)
    return []
  }
}

export async function getDocShares(room: string): Promise<{ id: string; name: string; color: string }[]> {
  try {
    const res = await fetch(`${BASE}/documents/${room}/shares`)
    if (!res.ok) return []
    return res.json()
  } catch (err) {
    console.error('Failed to get doc shares:', err)
    return []
  }
}

export async function shareDocument(room: string, ownerId: string, sharedWithId: string) {
  try {
    const res = await fetch(`${BASE}/documents/${room}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner_id: ownerId, shared_with_id: sharedWithId }),
    })
    return res.json()
  } catch (err) {
    console.error('Failed to share document:', err)
    return null
  }
}

export async function unshareDocument(room: string, ownerId: string, sharedWithId: string) {
  try {
    const res = await fetch(
      `${BASE}/documents/${room}/share/${sharedWithId}?owner_id=${ownerId}`,
      { method: 'DELETE' }
    )
    return res.json()
  } catch (err) {
    console.error('Failed to unshare document:', err)
    return null
  }
}

export async function getSharedDocuments(userId: string) {
  try {
    const res = await fetch(`${BASE}/users/${userId}/shared-documents`)
    if (!res.ok) return []
    return res.json()
  } catch (err) {
    console.error('Failed to get shared documents:', err)
    return []
  }
}
