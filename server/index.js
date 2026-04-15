const http = require('http')
const { WebSocketServer } = require('ws')
const { setupWSConnection, getYDoc } = require('y-websocket/bin/utils')
require('dotenv').config()
const Database = require('better-sqlite3')
const Y = require('yjs')
const Anthropic = require('@anthropic-ai/sdk')
const { OAuth2Client } = require('google-auth-library')
const cookie = require('cookie')
const { v4: uuidv4 } = require('uuid')

const oauthClient = new OAuth2Client(
  process.env.OAUTH_CLIENT_ID,
  process.env.OAUTH_CLIENT_SECRET,
  'http://localhost:1234/auth/google/callback'
)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const PREVIEW_BLOCK_LIMIT = 8
const PREVIEW_TEXT_LIMIT = 140

const db = new Database('cowrite.db')

db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    google_id TEXT UNIQUE,
    name TEXT NOT NULL,
    email TEXT,
    avatar_url TEXT,
    color TEXT NOT NULL,
    created_at INTEGER
  )
`)


db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  )
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    room TEXT PRIMARY KEY,
    state BLOB,
    updated_at INTEGER,
    title TEXT DEFAULT 'Untitled',
    preview_json TEXT DEFAULT '[]',
    owner_id TEXT REFERENCES users(id),
    created_at INTEGER
  )
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS document_shares (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id TEXT NOT NULL REFERENCES documents(room) ON DELETE CASCADE,
    owner_id    TEXT NOT NULL REFERENCES users(id),
    shared_with TEXT NOT NULL REFERENCES users(id),
    created_at  INTEGER NOT NULL,
    UNIQUE(document_id, shared_with)
  )
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS user_document_prefs (
    user_id     TEXT NOT NULL REFERENCES users(id),
    room        TEXT NOT NULL REFERENCES documents(room) ON DELETE CASCADE,
    prefs_json  TEXT NOT NULL DEFAULT '{}',
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (user_id, room)
  )
`)


console.log('Database ready')

const saveTimeouts = new Map()

const upsertDoc = db.prepare(`
  INSERT INTO documents (room, state, updated_at, title, preview_json)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(room) DO UPDATE SET
    state = excluded.state,
    updated_at = excluded.updated_at,
    title = excluded.title,
    preview_json = excluded.preview_json
`)

const selectDoc = db.prepare('SELECT state FROM documents WHERE room = ?')
const getDocsMissingPreview = db.prepare(`
  SELECT room, state
  FROM documents
  WHERE state IS NOT NULL
    AND (preview_json IS NULL OR preview_json = '' OR preview_json = '[]')
`)
const updateDocPreview = db.prepare(`
  UPDATE documents
  SET preview_json = ?
  WHERE room = ?
`)

const upsertUser = db.prepare(`
  INSERT INTO users (id, google_id, name, email, avatar_url, color, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(google_id) DO UPDATE SET
    name = excluded.name,
    email = excluded.email,
    avatar_url = excluded.avatar_url
`)

const getUserByGoogleId = db.prepare(`SELECT * FROM users WHERE google_id = ?`)
const getUserById = db.prepare(`SELECT * FROM users WHERE id = ?`)

const createSession = db.prepare(`
  INSERT INTO sessions (id, user_id, created_at, last_seen)
  VALUES (?, ?, ?, ?)
`)

const getSession = db.prepare(`SELECT * FROM sessions WHERE id = ?`)

const touchSession = db.prepare(`
  UPDATE sessions SET last_seen = ? WHERE id = ?
`)

const deleteSession = db.prepare(`DELETE FROM sessions WHERE id = ?`)

const getUserDocs = db.prepare(`
  SELECT room, title, updated_at, created_at, owner_id, preview_json
  FROM documents
  WHERE owner_id = ?
  ORDER BY updated_at DESC
`)

const getDocSharesForDocs = db.prepare(`
  SELECT s.document_id, u.id, u.name, u.color
  FROM document_shares s
  JOIN users u ON u.id = s.shared_with
  WHERE s.owner_id = ?
`)

const createDoc = db.prepare(`
  INSERT INTO documents (room, owner_id, title, created_at, updated_at)
  VALUES (?, ?, 'Untitled', ?, ?)
  ON CONFLICT(room) DO NOTHING
`)

const deleteDoc = db.prepare(`
  DELETE FROM documents WHERE room = ? AND owner_id = ?
`)

const renameDoc = db.prepare(`
  UPDATE documents SET title = ?, updated_at = ? WHERE room = ? AND owner_id = ?
`)

const getAllUsers = db.prepare(`SELECT id, name, color FROM users ORDER BY name`)

const getDocMeta = db.prepare(`SELECT owner_id FROM documents WHERE room = ?`)

const insertShare = db.prepare(`
  INSERT INTO document_shares (document_id, owner_id, shared_with, created_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(document_id, shared_with) DO NOTHING
`)

const deleteShare = db.prepare(`
  DELETE FROM document_shares WHERE document_id = ? AND owner_id = ? AND shared_with = ?
`)

const getDocShares = db.prepare(`
  SELECT u.id, u.name, u.color
  FROM document_shares s
  JOIN users u ON u.id = s.shared_with
  WHERE s.document_id = ?
`)

const getDocPrefs = db.prepare(`
  SELECT prefs_json FROM user_document_prefs WHERE user_id = ? AND room = ?
`)

const upsertDocPrefs = db.prepare(`
  INSERT INTO user_document_prefs (user_id, room, prefs_json, updated_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(user_id, room) DO UPDATE SET
    prefs_json = excluded.prefs_json,
    updated_at = excluded.updated_at
`)

const getSharedDocs = db.prepare(`
  SELECT d.room, d.title, d.updated_at, d.created_at, d.owner_id, d.preview_json,
         u.name AS owner_name, u.color AS owner_color
  FROM document_shares s
  JOIN documents d ON d.room = s.document_id
  JOIN users u ON u.id = s.owner_id
  WHERE s.shared_with = ?
  ORDER BY d.updated_at DESC
`)

function normalizePreviewText(text = '') {
  return text.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_TEXT_LIMIT)
}

function getNodeText(node) {
  if (node instanceof Y.XmlText) {
    return node.toDelta()
      .map(part => typeof part.insert === 'string' ? part.insert : '')
      .join('')
  }

  if (node instanceof Y.XmlElement || node instanceof Y.XmlFragment) {
    return node.toArray().map(getNodeText).join(' ')
  }

  return ''
}

function pushPreviewBlock(blocks, type, text) {
  if (blocks.length >= PREVIEW_BLOCK_LIMIT) return
  const normalized = normalizePreviewText(text)
  if (!normalized) return
  blocks.push({ type, text: normalized })
}

function summarizeTable(node) {
  let rowCount = 0
  let colCount = 0
  const firstRow = []

  node.toArray().forEach((rowNode, rowIndex) => {
    if (!(rowNode instanceof Y.XmlElement) || rowNode.nodeName !== 'tableRow') return
    rowCount += 1

    const cells = rowNode.toArray().filter(child =>
      child instanceof Y.XmlElement && (child.nodeName === 'tableCell' || child.nodeName === 'tableHeader')
    )

    if (rowIndex === 0) {
      colCount = cells.length
      cells.slice(0, 3).forEach(cell => {
        const text = normalizePreviewText(getNodeText(cell))
        if (text) firstRow.push(text)
      })
    }
  })

  if (firstRow.length > 0) return firstRow.join(' · ')
  if (rowCount > 0 && colCount > 0) return `${rowCount} x ${colCount} table`
  return 'Table'
}

function appendListBlocks(node, blocks, type) {
  if (blocks.length >= PREVIEW_BLOCK_LIMIT || !(node instanceof Y.XmlElement)) return

  if (node.nodeName === 'listItem' || node.nodeName === 'taskItem') {
    pushPreviewBlock(blocks, type, getNodeText(node))
    return
  }

  node.toArray().forEach(child => appendListBlocks(child, blocks, type))
}

function appendPreviewBlocks(node, blocks) {
  if (blocks.length >= PREVIEW_BLOCK_LIMIT || !(node instanceof Y.XmlElement)) return

  switch (node.nodeName) {
    case 'heading': {
      const level = Number(node.getAttributes().level || 1)
      pushPreviewBlock(blocks, level === 1 ? 'heading' : 'subheading', getNodeText(node))
      return
    }
    case 'paragraph':
      pushPreviewBlock(blocks, 'paragraph', getNodeText(node))
      return
    case 'blockquote':
      pushPreviewBlock(blocks, 'quote', getNodeText(node))
      return
    case 'codeBlock':
      pushPreviewBlock(blocks, 'code', getNodeText(node))
      return
    case 'bulletList':
      node.toArray().forEach(child => appendListBlocks(child, blocks, 'list'))
      return
    case 'orderedList':
      node.toArray().forEach(child => appendListBlocks(child, blocks, 'ordered'))
      return
    case 'taskList':
      node.toArray().forEach(child => appendListBlocks(child, blocks, 'task'))
      return
    case 'table':
      pushPreviewBlock(blocks, 'table', summarizeTable(node))
      return
    case 'horizontalRule':
      return
    default:
      node.toArray().forEach(child => appendPreviewBlocks(child, blocks))
  }
}

function extractPreviewBlocks(ydoc) {
  const fragment = ydoc.getXmlFragment('default')
  const blocks = []
  fragment.toArray().forEach(node => appendPreviewBlocks(node, blocks))
  return blocks
}

function backfillDocumentPreviews() {
  const rows = getDocsMissingPreview.all()
  rows.forEach(row => {
    try {
      const ydoc = new Y.Doc()
      Y.applyUpdate(ydoc, row.state)
      updateDocPreview.run(JSON.stringify(extractPreviewBlocks(ydoc)), row.room)
    } catch (err) {
      console.error(`Failed to backfill preview for ${row.room}:`, err)
    }
  })
}

function saveDocument(roomName) {
    try {
        const ydoc = getYDoc(roomName)
        if (!ydoc) {
            console.warn(`saveDocument: no ydoc found for room ${roomName}`)
            return
        }
        const state = Y.encodeStateAsUpdate(ydoc)
        const title = ydoc.getText('title').toString() || 'Untitled'
        const preview = JSON.stringify(extractPreviewBlocks(ydoc))
        upsertDoc.run(roomName, state, Date.now(), title, preview)
        console.log(`Saved: ${roomName}`)
    } catch (err) {
        console.error(`Failed to save document ${roomName}:`, err)
    }
}

const loadedRooms = new Set()

function loadDocument(roomName) {
    if (loadedRooms.has(roomName)) return
    loadedRooms.add(roomName)
    try {
        const row = selectDoc.get(roomName)
        if (row?.state) {
            const ydoc = getYDoc(roomName)
            Y.applyUpdate(ydoc, row.state)
            console.log(`Loaded: ${roomName}`)
        }
    } catch (err) {
        loadedRooms.delete(roomName)
        console.error(`Failed to load document ${roomName}:`, err)
    }
}

function scheduleSave(roomName) {
    if (saveTimeouts.has(roomName)) {
        clearTimeout(saveTimeouts.get(roomName))
    }
    saveTimeouts.set(roomName, setTimeout(() => {
        saveDocument(roomName)
        saveTimeouts.delete(roomName)
    }, 2000))
}

backfillDocumentPreviews()

function gracefulShutdown() {
    console.log('Shutting down - saving all documents . . .')
    for (const [roomName] of saveTimeouts) {
        clearTimeout(saveTimeouts.get(roomName))
        saveDocument(roomName)
    }
    db.close()
    process.exit(0)
}

process.on('SIGINT', gracefulShutdown)
process.on('SIGTERM', gracefulShutdown)

// ── Session helpers ──────────────────────────────────────────────────
const SESSION_COOKIE = 'cw_sid'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

function getSessionUser(req) {
  const cookies = cookie.parse(req.headers.cookie || '')
  const sid = cookies[SESSION_COOKIE]
  if (!sid) return null
  const session = getSession.get(sid)
  if (!session) return null
  if (Date.now() - session.last_seen > SESSION_TTL_MS) {
    deleteSession.run(sid)
    return null
  }
  touchSession.run(Date.now(), sid)
  return getUserById.get(session.user_id)
}

function setSessionCookie(res, sid) {
  res.setHeader('Set-Cookie', cookie.serialize(SESSION_COOKIE, sid, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  }))
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', cookie.serialize(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  }))
}

const COLORS = ['#f783ac', '#74c0fc', '#63e6be', '#ffd43b', '#a9e34b', '#ff8c42', '#c77dff']

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || 'http://localhost:5173'
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS, PUT, PATCH')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = new URL(req.url || '/', `http://localhost`)

  // ── Auth routes (no session required) ───────────────────────────────

  // GET /auth/google — redirect to Google consent screen
  if (req.method === 'GET' && url.pathname === '/auth/google') {
    const authUrl = oauthClient.generateAuthUrl({
      access_type: 'offline',
      scope: ['profile', 'email'],
      prompt: 'select_account',
    })
    res.writeHead(302, { Location: authUrl })
    res.end()
    return
  }

  // GET /auth/google/callback — exchange code, create session, redirect home
  if (req.method === 'GET' && url.pathname === '/auth/google/callback') {
    const code = url.searchParams.get('code')
    if (!code) {
      res.writeHead(400); res.end('Missing code')
      return
    }
    try {
      const { tokens } = await oauthClient.getToken(code)
      oauthClient.setCredentials(tokens)
      const ticket = await oauthClient.verifyIdToken({
        idToken: tokens.id_token,
        audience: process.env.OAUTH_CLIENT_ID,
      })
      const payload = ticket.getPayload()
      const googleId = payload.sub
      const name = payload.name || payload.email.split('@')[0]
      const email = payload.email
      const avatarUrl = payload.picture || null

      let user = getUserByGoogleId.get(googleId)
      if (!user) {
        const id = uuidv4()
        const color = COLORS[Math.floor(Math.random() * COLORS.length)]
        upsertUser.run(id, googleId, name, email, avatarUrl, color, Date.now())
        user = getUserById.get(id)
      } else {
        // Always refresh name/email/avatar from Google on login
        upsertUser.run(user.id, googleId, name, email, avatarUrl, user.color, user.created_at)
        user = getUserById.get(user.id)
      }

      const sid = uuidv4()
      createSession.run(sid, user.id, Date.now(), Date.now())
      setSessionCookie(res, sid)
      res.writeHead(302, { Location: 'http://localhost:5173/' })
      res.end()
    } catch (err) {
      console.error('OAuth callback error:', err)
      res.writeHead(302, { Location: 'http://localhost:5173/login?error=auth_failed' })
      res.end()
    }
    return
  }

  // GET /auth/me — return current user from session
  if (req.method === 'GET' && url.pathname === '/auth/me') {
    const user = getSessionUser(req)
    if (!user) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not authenticated' }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      id: user.id,
      name: user.name,
      email: user.email,
      color: user.color,
      avatar_url: user.avatar_url,
    }))
    return
  }

  // POST /auth/logout
  if (req.method === 'POST' && url.pathname === '/auth/logout') {
    const cookies = cookie.parse(req.headers.cookie || '')
    const sid = cookies[SESSION_COOKIE]
    if (sid) deleteSession.run(sid)
    clearSessionCookie(res)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ success: true }))
    return
  }

  // ── All routes below require a valid session ─────────────────────────

  const user = getSessionUser(req)
  if (!user) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not authenticated' }))
    return
  }
  const userId = user.id

  // GET /events — SSE stream for real-time home page updates
  if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })
    res.write(':\n\n') // initial comment to open stream
    sseSubscribe(userId, res)
    const keepalive = setInterval(() => { try { res.write(':\n\n') } catch {} }, 25000)
    req.on('close', () => {
      clearInterval(keepalive)
      sseUnsubscribe(userId, res)
    })
    return
  }

  // GET /users — list all registered users (for share picker)
  if (req.method === 'GET' && url.pathname === '/users') {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(getAllUsers.all()))
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Server error' }))
    }
    return
  }

  // GET /users/me/documents
  if (req.method === 'GET' && url.pathname === '/users/me/documents') {
    try {
      const shareRows = getDocSharesForDocs.all(userId)
      const sharesByRoom = {}
      for (const { document_id, id, name, color } of shareRows) {
        if (!sharesByRoom[document_id]) sharesByRoom[document_id] = []
        sharesByRoom[document_id].push({ id, name, color })
      }
      const docs = getUserDocs.all(userId).map(({ preview_json, ...doc }) => ({
        ...doc,
        preview_blocks: (() => { try { return JSON.parse(preview_json || '[]') } catch { return [] } })(),
        collaborators: sharesByRoom[doc.room] ?? [],
      }))
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(docs))
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Server error' }))
    }
    return
  }

  // GET /users/me/shared-documents
  if (req.method === 'GET' && url.pathname === '/users/me/shared-documents') {
    try {
      const docs = getSharedDocs.all(userId).map(({ preview_json, ...doc }) => ({
        ...doc,
        preview_blocks: (() => { try { return JSON.parse(preview_json || '[]') } catch { return [] } })(),
      }))
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(docs))
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Server error' }))
    }
    return
  }

  // POST /documents
  if (req.method === 'POST' && url.pathname === '/documents') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      try {
        const { room } = JSON.parse(body)
        if (!room) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'room required' }))
          return
        }
        const now = Date.now()
        createDoc.run(room, userId, now, now)
        const meta = getDocMeta.get(room)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ room, owner_id: meta?.owner_id ?? userId }))
      } catch {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Server error' }))
      }
    })
    return
  }

  // DELETE /documents/:room/share/:targetUserId
  if (req.method === 'DELETE' && url.pathname.match(/^\/documents\/[^/]+\/share\/[^/]+$/)) {
    const parts = url.pathname.split('/')
    const room = parts[2]
    const targetUserId = parts[4]
    try {
      const result = deleteShare.run(room, userId, targetUserId)
      if (result.changes === 0) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Not authorized or share not found' }))
        return
      }
      kickUserFromRoom(room, targetUserId)
      ssePush(targetUserId, 'doc:unshared', { room })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true }))
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Server error' }))
    }
    return
  }

  // DELETE /documents/:room
  if (req.method === 'DELETE' && url.pathname.match(/^\/documents\/[^/]+$/) &&
      !url.pathname.includes('/share') && !url.pathname.includes('/prefs') &&
      !url.pathname.includes('/title') && !url.pathname.includes('/shares') &&
      !url.pathname.includes('/ai')) {
    const room = url.pathname.split('/')[2]
    try {
      // Get collaborators before deleting so we can notify them
      const collaborators = getDocShares.all(room).map(u => u.id)
      const result = deleteDoc.run(room, userId)
      if (result.changes === 0) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Not authorized or document not found' }))
        return
      }
      // Kick any collaborators currently in the doc and notify them
      for (const collabId of collaborators) {
        kickUserFromRoom(room, collabId)
        ssePush(collabId, 'doc:deleted', { room })
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true }))
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Server error' }))
    }
    return
  }

  // GET /documents/:room/shares
  if (req.method === 'GET' && url.pathname.match(/^\/documents\/[^/]+\/shares$/)) {
    const room = url.pathname.split('/')[2]
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(getDocShares.all(room)))
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Server error' }))
    }
    return
  }

  // POST /documents/:room/share
  if (req.method === 'POST' && url.pathname.match(/^\/documents\/[^/]+\/share$/)) {
    const room = url.pathname.split('/')[2]
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      try {
        const { shared_with_id } = JSON.parse(body)
        if (!shared_with_id) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'shared_with_id required' }))
          return
        }
        if (userId === shared_with_id) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Cannot share with yourself' }))
          return
        }
        const doc = getDocMeta.get(room)
        if (!doc || doc.owner_id !== userId) {
          res.writeHead(403, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Not authorized' }))
          return
        }
        insertShare.run(room, userId, shared_with_id, Date.now())
        // Push the full shared doc to the new collaborator
        const sharedDoc = db.prepare(`
          SELECT d.room, d.title, d.updated_at, d.created_at, d.preview_json,
                 u.name AS owner_name, u.color AS owner_color
          FROM documents d JOIN users u ON u.id = d.owner_id
          WHERE d.room = ?
        `).get(room)
        if (sharedDoc) {
          const { preview_json, ...rest } = sharedDoc
          ssePush(shared_with_id, 'doc:shared', {
            ...rest,
            preview_blocks: (() => { try { return JSON.parse(preview_json || '[]') } catch { return [] } })(),
          })
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
      } catch {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Server error' }))
      }
    })
    return
  }

  // PATCH /documents/:room/title
  if (req.method === 'PATCH' && url.pathname.match(/^\/documents\/[^/]+\/title$/)) {
    const room = url.pathname.split('/')[2]
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      try {
        const { title } = JSON.parse(body)
        if (typeof title !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'title string required' }))
          return
        }
        const result = renameDoc.run(title.trim() || 'Untitled', Date.now(), room, userId)
        if (result.changes === 0) {
          res.writeHead(403, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Not authorized or document not found' }))
          return
        }
        try {
          const ydoc = getYDoc(room)
          if (ydoc) {
            const yTitle = ydoc.getText('title')
            ydoc.transact(() => {
              yTitle.delete(0, yTitle.length)
              yTitle.insert(0, title.trim() || 'Untitled')
            })
          }
        } catch {}
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
      } catch {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Server error' }))
      }
    })
    return
  }

  // GET /documents/:room/prefs
  if (req.method === 'GET' && url.pathname.match(/^\/documents\/[^/]+\/prefs$/)) {
    const room = url.pathname.split('/')[2]
    try {
      const row = getDocPrefs.get(userId, room)
      let prefs = {}
      if (row?.prefs_json) { try { prefs = JSON.parse(row.prefs_json) } catch { prefs = {} } }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ prefs }))
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Server error' }))
    }
    return
  }

  // PUT /documents/:room/prefs
  if (req.method === 'PUT' && url.pathname.match(/^\/documents\/[^/]+\/prefs$/)) {
    const room = url.pathname.split('/')[2]
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      try {
        const { prefs } = JSON.parse(body)
        if (!prefs || typeof prefs !== 'object') {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'prefs object required' }))
          return
        }
        upsertDocPrefs.run(userId, room, JSON.stringify(prefs), Date.now())
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
      } catch {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Server error' }))
      }
    })
    return
  }

  // POST /documents/:room/ai
  if (req.method === 'POST' && url.pathname.match(/^\/documents\/[^/]+\/ai$/)) {
    const room = url.pathname.split('/')[2]
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', async () => {
      try {
        const { prompt, before, after, mode } = JSON.parse(body)

        const hasContent = (before || '').trim().length > 0

        const systemPrompt = `You are a writing assistant embedded inside a collaborative document editor called CoWrite. Your output is inserted directly into the document at the cursor — it must read as a seamless continuation of the author's own writing.

Rules:
- Match the author's voice, tone, vocabulary, and sentence rhythm exactly. If they write casually, write casually. If they write formally, write formally.
- Never add preamble, meta-commentary, or explanations. Output only the text to insert.
- Use markdown formatting (headers, bullets, bold, code blocks) only if the surrounding document already uses it.
- Do not repeat content already in the document.
- Be substantive. Produce complete, useful content — not filler.`

        let userMessage
        if (mode === 'continue') {
          if (hasContent) {
            userMessage = `Continue writing naturally from where this text ends. Match the style and flow exactly. Only output the continuation — nothing else.\n\n<document_before_cursor>\n${before}\n</document_before_cursor>${after ? `\n\n<document_after_cursor>\n${after}\n</document_after_cursor>` : ''}`
          } else {
            userMessage = `Start writing a document. Output the opening paragraphs.`
          }
        } else if (mode === 'summarize') {
          userMessage = `Write a concise summary of the following document. Match its tone. Output only the summary text.\n\n<document>\n${before}\n</document>`
        } else if (mode === 'rewrite') {
          userMessage = `Rewrite the following passage to be clearer and more engaging, keeping the same meaning and voice.\n\n<text>\n${before.slice(-1500)}\n</text>`
        } else {
          // write mode — user gave a prompt
          if (hasContent) {
            userMessage = `The author is writing a document. Here is what they've written so far:\n\n<document_before_cursor>\n${before}\n</document_before_cursor>\n\nThey want you to write the following at the cursor position: "${prompt}"\n\nOutput only the requested text, written in the author's voice and style.`
          } else {
            userMessage = `Write the following for a new document: "${prompt}"\n\nOutput only the text.`
          }
        }
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        })
        const stream = anthropic.messages.stream({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
        })
        stream.on('text', (text) => {
          res.write(`data: ${JSON.stringify({ token: text })}\n\n`)
        })
        stream.on('error', (err) => {
          console.error('Stream error:', err)
          res.write(`data: ${JSON.stringify({ error: err.message || 'Stream failed' })}\n\n`)
          res.end()
        })
        await stream.finalMessage()
        res.write('data: [DONE]\n\n')
        res.end()
      } catch (err) {
        console.error('AI endpoint error:', err)
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'AI request failed' }))
        }
      }
    })
    return
  }

  res.writeHead(200)
  res.end('CoWrite WebSocket Server')
})

// SSE connections: userId -> Set<res>
const sseClients = new Map()

function sseSubscribe(userId, res) {
  if (!sseClients.has(userId)) sseClients.set(userId, new Set())
  sseClients.get(userId).add(res)
}

function sseUnsubscribe(userId, res) {
  sseClients.get(userId)?.delete(res)
  if (sseClients.get(userId)?.size === 0) sseClients.delete(userId)
}

function ssePush(userId, event, data) {
  sseClients.get(userId)?.forEach(res => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    } catch {}
  })
}

// Track active WS connections: room -> Map<userId, Set<ws>>
const roomConnections = new Map()

function trackConnection(room, userId, ws) {
  if (!roomConnections.has(room)) roomConnections.set(room, new Map())
  const byUser = roomConnections.get(room)
  if (!byUser.has(userId)) byUser.set(userId, new Set())
  byUser.get(userId).add(ws)
}

function untrackConnection(room, userId, ws) {
  const byUser = roomConnections.get(room)
  if (!byUser) return
  byUser.get(userId)?.delete(ws)
  if (byUser.get(userId)?.size === 0) byUser.delete(userId)
  if (byUser.size === 0) roomConnections.delete(room)
}

function kickUserFromRoom(room, userId) {
  const byUser = roomConnections.get(room)
  if (!byUser) return
  byUser.get(userId)?.forEach(ws => {
    try { ws.close(4403, 'Access revoked') } catch {}
  })
}

const wss = new WebSocketServer({ server })

wss.on('connection', (ws, req) => {
    const roomName = req.url?.slice(1).split('?')[0] || 'default'

    // Identify connecting user from session cookie
    const cookies = cookie.parse(req.headers.cookie || '')
    const sid = cookies[SESSION_COOKIE]
    const session = sid ? getSession.get(sid) : null
    const connUserId = session ? session.user_id : null

    if (connUserId) trackConnection(roomName, connUserId, ws)

    const isFirstLoad = !loadedRooms.has(roomName)

    // Load persisted state before client syncs
    loadDocument(roomName)

    // Set up Yjs WebSocket sync
    setupWSConnection(ws, req)

    // Schedule save on every document update
    const ydoc = getYDoc(roomName)
    const updateHandler = () => scheduleSave(roomName)
    ydoc.on('update', updateHandler)

    // On first connection for a room that already has state, re-save to ensure
    // preview_json is up to date (backfill may have missed it if state was added
    // while the server was running)
    if (isFirstLoad) {
        setTimeout(() => saveDocument(roomName), 500)
    }

    ws.on('close', () => {
        if (connUserId) untrackConnection(roomName, connUserId, ws)
        saveDocument(roomName)
        ydoc.off('update', updateHandler)
        console.log(`Client disconnected from ${roomName}`)
    })

    console.log(`Client connected to ${roomName}`)
})

const PORT = process.env.PORT || 1234
server.listen(PORT, () => {
    console.log(`CoWrite server running on port ${PORT}`)
})
