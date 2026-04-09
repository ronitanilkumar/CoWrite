import { useState, useEffect, useRef, useCallback, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { storedUser, updateUserName } from './user'
import { getUserDocuments, createDocument, deleteDocument, registerUser, getSharedDocuments } from './api'
import { FilePlus, ArrowRight, Plus, FileText, Search, Trash2 } from 'lucide-react'
import './Home.css'

interface Doc {
  room: string
  title: string
  updated_at: number
  created_at: number
  preview_blocks?: Array<{
    type: string
    text: string
  }>
}

interface SharedDoc extends Doc {
  owner_name: string
  owner_color: string
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms
  const s = Math.floor(diff / 1000)
  if (s < 60) return 'Just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function getExcerpt(doc: Doc): string {
  if (!doc.preview_blocks || doc.preview_blocks.length === 0) return ''
  // Skip heading that matches title, prefer paragraph/quote/list content
  for (const block of doc.preview_blocks) {
    if (block.type === 'heading' && block.text.trim() === (doc.title || '').trim()) continue
    if (block.text.trim()) return block.text.trim()
  }
  return ''
}

// Lightweight fuzzy match: all query chars appear in order in target
function fuzzyMatch(query: string, target: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  let qi = 0
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++
  }
  return qi === q.length
}

function filterDocs(docs: Doc[], query: string): Doc[] {
  if (!query.trim()) return docs
  const q = query.trim()
  return docs.filter(doc => {
    const title = doc.title || 'Untitled'
    const excerpt = getExcerpt(doc)
    // Exact substring match first (title or excerpt), fallback to fuzzy on title
    return (
      title.toLowerCase().includes(q.toLowerCase()) ||
      excerpt.toLowerCase().includes(q.toLowerCase()) ||
      fuzzyMatch(q, title)
    )
  })
}

function DocRow({
  doc, onOpen, onDelete, deleting, highlighted, style, hideDelete,
}: {
  doc: Doc
  onOpen: () => void
  onDelete: (e: React.MouseEvent) => void
  deleting: boolean
  highlighted: boolean
  style?: CSSProperties
  hideDelete?: boolean
}) {
  const excerpt = getExcerpt(doc)

  return (
    <div
      style={style}
      className={`doc-row${highlighted ? ' doc-row--highlighted' : ''}`}
      onClick={onOpen}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() }
      }}
      tabIndex={0}
      role="button"
      aria-label={`Open ${doc.title || 'Untitled'}`}
    >
      <div className="doc-row-icon" aria-hidden="true">
        <FileText size={17} strokeWidth={1.6} />
      </div>
      <div className="doc-row-body">
        <span className="doc-row-title">{doc.title || 'Untitled'}</span>
        {excerpt && <span className="doc-row-excerpt">{excerpt}</span>}
      </div>
      <span className="doc-row-meta">{timeAgo(doc.updated_at)}</span>
      {!hideDelete && (
        <button
          className={`doc-row-del${deleting ? ' del--busy' : ''}`}
          onClick={onDelete}
          title="Delete document"
          disabled={deleting}
          tabIndex={-1}
        >
          <Trash2 size={14} strokeWidth={1.75} />
        </button>
      )}
    </div>
  )
}

export default function Home() {
  const [docs, setDocs] = useState<Doc[]>([])
  const [sharedDocs, setSharedDocs] = useState<SharedDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingRoom, setDeletingRoom] = useState<string | null>(null)
  const [userName, setUserName] = useState(storedUser.name || '')
  const [nameDraft, setNameDraft] = useState(storedUser.name || '')
  const [isEditingName, setIsEditingName] = useState(false)
  const [resolvedTheme, setResolvedTheme] = useState<'dark' | 'light'>('dark')
  const [query, setQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1)
  const nameRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  const hasName = !!userName
  const filteredDocs = filterDocs(docs, query)

  useEffect(() => {
    const saved = localStorage.getItem('cowrite-theme') as string
    const resolved = saved === 'light' ? 'light'
      : saved === 'dark' ? 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    setResolvedTheme(resolved)
    document.documentElement.setAttribute('data-theme', resolved)
  }, [])

  useEffect(() => {
    const app = document.querySelector('.app') as HTMLElement | null
    const prev = app?.style.overflow ?? ''
    const prevH = app?.style.height ?? ''
    document.body.style.overflow = 'auto'
    if (app) { app.style.overflow = 'auto'; app.style.height = 'auto' }
    return () => {
      document.body.style.overflow = ''
      if (app) { app.style.overflow = prev; app.style.height = prevH }
    }
  }, [])

  useEffect(() => {
    if (!isEditingName) return
    const frame = requestAnimationFrame(() => {
      nameRef.current?.focus()
      nameRef.current?.setSelectionRange(nameDraft.length, nameDraft.length)
    })
    return () => cancelAnimationFrame(frame)
  }, [isEditingName])

  // Keyboard shortcut: / or Cmd+K focuses search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!hasName) return
      const active = document.activeElement
      const isInput = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
      if (e.key === '/' && !isInput) {
        e.preventDefault()
        searchRef.current?.focus()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [hasName])

  // Arrow key navigation through results
  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex(i => Math.min(i + 1, filteredDocs.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex(i => Math.max(i - 1, -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (highlightedIndex >= 0 && filteredDocs[highlightedIndex]) {
        navigate(`/doc/${filteredDocs[highlightedIndex].room}`)
      } else if (filteredDocs.length === 1) {
        navigate(`/doc/${filteredDocs[0].room}`)
      }
    } else if (e.key === 'Escape') {
      setQuery('')
      setHighlightedIndex(-1)
      searchRef.current?.blur()
    }
  }, [filteredDocs, highlightedIndex, navigate])

  // Reset highlight when query changes
  useEffect(() => { setHighlightedIndex(-1) }, [query])

  const startNameEdit = () => {
    setNameDraft(userName)
    setIsEditingName(true)
  }

  const commitName = () => {
    const name = nameDraft.trim()
    setIsEditingName(false)
    if (!name) { setNameDraft(userName); return }
    const updated = updateUserName(name)
    setUserName(name)
    setNameDraft(name)
    registerUser({ id: updated.id, name, color: updated.color })
  }

  const cancelNameEdit = () => {
    setNameDraft(userName)
    setIsEditingName(false)
  }

  useEffect(() => {
    if (!storedUser.id || !hasName) return
    Promise.all([
      getUserDocuments(storedUser.id).then(setDocs),
      getSharedDocuments(storedUser.id).then(setSharedDocs),
    ]).finally(() => setLoading(false))
    const t = setTimeout(() => {
      getUserDocuments(storedUser.id).then(setDocs)
      getSharedDocuments(storedUser.id).then(setSharedDocs)
    }, 1200)
    return () => clearTimeout(t)
  }, [hasName])

  const handleCreate = async () => {
    const id = crypto.randomUUID()
    await createDocument(id, storedUser.id)
    navigate(`/doc/${id}`)
  }

  const handleDelete = async (room: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setDeletingRoom(room)
    const result = await deleteDocument(room, storedUser.id)
    if (result?.success) setDocs(prev => prev.filter(d => d.room !== room))
    setDeletingRoom(null)
  }

  const logoSrc = resolvedTheme === 'light' ? '/cowrite_lightmode.svg' : '/cowrite_darkmode.svg'

  // Smart empty-state suggestions: show most recent 3 when focused and no query
  const showSuggestions = searchFocused && !query && docs.length > 0
  const suggestions = docs.slice(0, 3)

  return (
    <div className="home">
      <nav className="home-nav">
        <img src={logoSrc} alt="CoWrite" className="home-nav-logo" />
        <div className="home-nav-right">
          {hasName && (
            <div className="home-avatar" style={{ background: storedUser.color }} aria-label={userName}>
              {userName[0].toUpperCase()}
            </div>
          )}
          {hasName && (
            <button className="home-btn-new" onClick={handleCreate}>
              <Plus size={15} strokeWidth={2} />
              New
            </button>
          )}
        </div>
      </nav>

      <section className="home-hero">
        <div className="home-hero-inner">
          <div className="home-hero-content">
            <p className="home-greeting">{greeting()}</p>
            {isEditingName ? (
              <>
                <h1 className="home-hero-name">
                  <input
                    ref={nameRef}
                    className="home-hero-name-editor"
                    type="text"
                    dir="ltr"
                    inputMode="text"
                    autoCapitalize="words"
                    autoComplete="name"
                    spellCheck={false}
                    aria-label="Your name"
                    aria-describedby="home-name-helper"
                    value={nameDraft}
                    onBlur={commitName}
                    onChange={e => setNameDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); commitName() }
                      if (e.key === 'Escape') { e.preventDefault(); cancelNameEdit() }
                    }}
                    maxLength={32}
                    style={{ width: `${Math.max(nameDraft.length || 0, 8)}ch` }}
                  />
                </h1>
                <p className="home-hero-helper" id="home-name-helper">
                  Enter to save · Esc to cancel
                </p>
              </>
            ) : hasName ? (
              <button className="home-hero-name-button" onClick={startNameEdit} type="button">
                <span className="home-hero-name">{userName}.</span>
              </button>
            ) : (
              <button
                className="home-hero-name-button home-hero-name-button--placeholder"
                onClick={startNameEdit}
                type="button"
              >
                <span className="home-hero-name home-hero-name--placeholder">Your name</span>
              </button>
            )}
          </div>
        </div>
      </section>

      {hasName && (
        <main className="home-main">
          <section className="home-section">

            {/* Search bar */}
            <div className={`doc-search-wrap${searchFocused ? ' focused' : ''}`}>
              <Search size={16} strokeWidth={2} className="doc-search-icon" aria-hidden="true" />
              <input
                ref={searchRef}
                className="doc-search-input"
                type="text"
                placeholder="Search documents…"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => { setSearchFocused(false); setHighlightedIndex(-1) }}
                onKeyDown={handleSearchKeyDown}
                aria-label="Search documents"
                autoComplete="off"
                spellCheck={false}
              />
              <kbd className="doc-search-hint">
                {typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘K' : '/'}
              </kbd>

              {/* Smart suggestions dropdown */}
              {showSuggestions && (
                <div className="doc-search-suggestions">
                  <div className="doc-search-suggestions-label">Recent</div>
                  {suggestions.map(doc => (
                    <button
                      key={doc.room}
                      className="doc-search-suggestion-item"
                      onMouseDown={e => { e.preventDefault(); navigate(`/doc/${doc.room}`) }}
                    >
                      <FileText size={15} strokeWidth={1.65} />
                      <span className="doc-search-suggestion-title">{doc.title || 'Untitled'}</span>
                      <span className="doc-search-suggestion-meta">{timeAgo(doc.updated_at)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Document list */}
            <div className="home-section-body">
              {loading ? (
                <div className="home-loading"><div className="home-spinner" /></div>
              ) : docs.length === 0 ? (
                <div className="home-empty">
                  <FilePlus size={32} strokeWidth={1.25} className="home-empty-icon" />
                  <p className="home-empty-text">No documents yet</p>
                  <button className="home-empty-btn" onClick={handleCreate}>
                    Start writing <ArrowRight size={13} strokeWidth={2} />
                  </button>
                </div>
              ) : (
                <div className="doc-list" onMouseMove={() => setHighlightedIndex(-1)}>
                  {/* New document row */}
                  <button
                    className="doc-row doc-row--new"
                    onClick={handleCreate}
                    style={{ '--stagger': '80ms' } as CSSProperties}
                  >
                    <div className="doc-row-icon doc-row-icon--new" aria-hidden="true">
                      <Plus size={16} strokeWidth={2.1} />
                    </div>
                    <div className="doc-row-body">
                      <span className="doc-row-title">New document</span>
                    </div>
                  </button>

                  {/* No results */}
                  {query && filteredDocs.length === 0 && (
                    <div className="doc-list-empty-search">
                      No documents matching <strong>"{query}"</strong>
                    </div>
                  )}

                  {filteredDocs.map((doc, index) => (
                    <DocRow
                      key={doc.room}
                      doc={doc}
                      onOpen={() => navigate(`/doc/${doc.room}`)}
                      onDelete={e => handleDelete(doc.room, e)}
                      deleting={deletingRoom === doc.room}
                      highlighted={index === highlightedIndex}
                      style={{ '--stagger': `${140 + index * 40}ms` } as CSSProperties}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Shared with you */}
          {!loading && sharedDocs.length > 0 && (
            <section className="home-section">
              <h2 className="home-section-heading">Shared with you</h2>
              <div className="home-section-body">
                <div className="doc-list">
                  {filterDocs(sharedDocs, query).map((doc, index) => (
                    <div key={doc.room} className="doc-row-shared-wrap" style={{ '--stagger': `${140 + index * 40}ms` } as CSSProperties}>
                      <DocRow
                        doc={doc}
                        onOpen={() => navigate(`/doc/${doc.room}`)}
                        onDelete={() => {}}
                        deleting={false}
                        highlighted={false}
                        hideDelete
                      />
                      <div className="doc-row-shared-by">
                        <div className="doc-row-shared-avatar" style={{ background: (doc as SharedDoc).owner_color }}>
                          {(doc as SharedDoc).owner_name[0]}
                        </div>
                        <span>{(doc as SharedDoc).owner_name}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}
        </main>
      )}
    </div>
  )
}
