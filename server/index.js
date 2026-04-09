const http = require('http')
const { WebSocketServer } = require('ws')
const { setupWSConnection, getYDoc } = require('y-websocket/bin/utils')
require('dotenv').config()
const Database = require('better-sqlite3')
const Y = require('yjs')

const PREVIEW_BLOCK_LIMIT = 8
const PREVIEW_TEXT_LIMIT = 140

const db = new Database('cowrite.db')

db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    created_at INTEGER
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

try { db.exec(`ALTER TABLE documents ADD COLUMN owner_id TEXT`) } catch {}
try { db.exec(`ALTER TABLE documents ADD COLUMN created_at INTEGER`) } catch {}
try { db.exec(`ALTER TABLE documents ADD COLUMN title TEXT DEFAULT 'Untitled'`) } catch {}
try { db.exec(`ALTER TABLE documents ADD COLUMN preview_json TEXT DEFAULT '[]'`) } catch {}

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
  INSERT INTO users (id, name, color, created_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    color = excluded.color
`)

const getUserDocs = db.prepare(`
  SELECT room, title, updated_at, created_at, owner_id, preview_json
  FROM documents
  WHERE owner_id = ?
  ORDER BY updated_at DESC
`)

const createDoc = db.prepare(`
  INSERT INTO documents (room, owner_id, title, created_at, updated_at)
  VALUES (?, ?, 'Untitled', ?, ?)
  ON CONFLICT(room) DO NOTHING
`)

const deleteDoc = db.prepare(`
  DELETE FROM documents WHERE room = ? AND owner_id = ?
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

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS, PUT')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = new URL(req.url || '/', `http://localhost`)

  // POST /users
  if (req.method === 'POST' && url.pathname === '/users') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      try {
        const { id, name, color } = JSON.parse(body)
        if (!id || !name || !color) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'id, name, color required' }))
          return
        }
        upsertUser.run(id, name, color, Date.now())
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
      } catch {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Server error' }))
      }
    })
    return
  }

  // GET /users/:id/documents
  if (req.method === 'GET' && url.pathname.match(/^\/users\/[^/]+\/documents$/)) {
    const userId = url.pathname.split('/')[2]
    try {
      const docs = getUserDocs.all(userId).map(({ preview_json, ...doc }) => ({
        ...doc,
        preview_blocks: (() => {
          try {
            return JSON.parse(preview_json || '[]')
          } catch {
            return []
          }
        })(),
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
        const { room, owner_id } = JSON.parse(body)
        if (!room || !owner_id) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'room and owner_id required' }))
          return
        }
        const now = Date.now()
        createDoc.run(room, owner_id, now, now)
        const meta = getDocMeta.get(room)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ room, owner_id: meta?.owner_id ?? owner_id }))
      } catch {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Server error' }))
      }
    })
    return
  }

  // DELETE /documents/:room/share/:userId?owner_id=xxx  (must come before the generic DELETE)
  if (req.method === 'DELETE' && url.pathname.match(/^\/documents\/[^/]+\/share\/[^/]+$/)) {
    const parts = url.pathname.split('/')
    const room = parts[2]
    const targetUserId = parts[4]
    const ownerId = url.searchParams.get('owner_id')
    if (!ownerId) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'owner_id required' }))
      return
    }
    try {
      const result = deleteShare.run(room, ownerId, targetUserId)
      if (result.changes === 0) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Not authorized or share not found' }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true }))
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Server error' }))
    }
    return
  }

  // DELETE /documents/:room?user_id=xxx
  if (req.method === 'DELETE' && url.pathname.startsWith('/documents/')) {
    const room = url.pathname.replace('/documents/', '')
    const userId = url.searchParams.get('user_id')
    if (!userId) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'user_id required' }))
      return
    }
    try {
      const result = deleteDoc.run(room, userId)
      if (result.changes === 0) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Not authorized or document not found' }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true }))
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Server error' }))
    }
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

  // GET /users/:id/shared-documents — docs shared with a user
  if (req.method === 'GET' && url.pathname.match(/^\/users\/[^/]+\/shared-documents$/)) {
    const userId = url.pathname.split('/')[2]
    try {
      const docs = getSharedDocs.all(userId).map(({ preview_json, ...doc }) => ({
        ...doc,
        preview_blocks: (() => {
          try { return JSON.parse(preview_json || '[]') } catch { return [] }
        })(),
      }))
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(docs))
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Server error' }))
    }
    return
  }

  // GET /documents/:room/shares — list users this doc is shared with
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

  // POST /documents/:room/share — share doc with another user
  if (req.method === 'POST' && url.pathname.match(/^\/documents\/[^/]+\/share$/)) {
    const room = url.pathname.split('/')[2]
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      try {
        const { owner_id, shared_with_id } = JSON.parse(body)
        if (!owner_id || !shared_with_id) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'owner_id and shared_with_id required' }))
          return
        }
        if (owner_id === shared_with_id) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Cannot share with yourself' }))
          return
        }
        const doc = getDocMeta.get(room)
        if (!doc || doc.owner_id !== owner_id) {
          res.writeHead(403, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Not authorized' }))
          return
        }
        insertShare.run(room, owner_id, shared_with_id, Date.now())
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
      } catch {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Server error' }))
      }
    })
    return
  }

  res.writeHead(200)
  res.end('CoWrite WebSocket Server')
})

const wss = new WebSocketServer({ server })

wss.on('connection', (ws, req) => {
    const roomName = req.url?.slice(1).split('?')[0] || 'default'

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
