import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { logout, getUserDocuments, createDocument, deleteDocument, getSharedDocuments, renameDocument, connectEvents, submitAgentJob, type ServerEvent } from './api'
import { FilePlus, ArrowRight, ArrowUp, Check, ChevronDown, Gauge, Plus, FileText, Search, Sparkles, Trash2, Pencil, Code2, Table2, ListChecks, LogOut, type LucideIcon } from 'lucide-react'
import './Home.css'

interface Collaborator {
  id: string
  name: string
  color: string
}

interface Doc {
  room: string
  title: string
  updated_at: number
  created_at: number
  preview_blocks?: Array<{
    type: string
    text: string
  }>
  collaborators?: Collaborator[]
}

interface SharedDoc extends Doc {
  owner_name: string
  owner_color: string
}

type AgentTaskMode = 'auto' | 'review' | 'expand' | 'proofread' | 'summarize'
type AgentEffortMode = 'auto' | 'low' | 'balanced' | 'high' | 'extra-high'

interface ComposerDoc extends Doc {
  source: 'Owned' | 'Shared'
  owner_name?: string
}

interface DropdownOption<T extends string> {
  value: T
  label: string
  description: string
  icon: LucideIcon
}

const AGENT_TASK_OPTIONS: Array<DropdownOption<AgentTaskMode>> = [
  { value: 'auto', label: 'Auto', description: 'Infer the job from the instruction.', icon: Sparkles },
  { value: 'review', label: 'Review', description: 'Find clarity, logic, and structure issues.', icon: Sparkles },
  { value: 'expand', label: 'Expand', description: 'Add depth, examples, or explanation.', icon: Sparkles },
  { value: 'proofread', label: 'Proofread', description: 'Catch grammar and punctuation issues.', icon: Sparkles },
  { value: 'summarize', label: 'Summarize', description: 'Create a concise standalone summary.', icon: Sparkles },
]

const AGENT_EFFORT_OPTIONS: Array<DropdownOption<AgentEffortMode>> = [
  { value: 'auto', label: 'Auto', description: 'Route model choice from the request.', icon: Gauge },
  { value: 'low', label: 'Low', description: 'Prefer speed over depth.', icon: Gauge },
  { value: 'balanced', label: 'Balanced', description: 'Default quality and speed tradeoff.', icon: Gauge },
  { value: 'high', label: 'High', description: 'Spend more effort on harder prompts.', icon: Gauge },
  { value: 'extra-high', label: 'Extra High', description: 'Use the deepest pass for demanding work.', icon: Gauge },
]

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

function getContentTypeBadge(doc: Doc): { Icon: LucideIcon; label: string } | null {
  if (!doc.preview_blocks || doc.preview_blocks.length === 0) return null
  const types = doc.preview_blocks.map(b => b.type)
  if (types.includes('code')) return { Icon: Code2, label: 'Code' }
  if (types.includes('table')) return { Icon: Table2, label: 'Table' }
  if (types.includes('task')) return { Icon: ListChecks, label: 'Tasks' }
  return null
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


function inferAgentTask(prompt: string): Exclude<AgentTaskMode, 'auto'> {
  const lower = prompt.toLowerCase()
  if (/(proof|grammar|spelling|punctuation|typo|copyedit)/.test(lower)) return 'proofread'
  if (/(summary|summarize|tl;dr|overview|recap|brief)/.test(lower)) return 'summarize'
  if (/(expand|deepen|detail|elaborate|example|flesh out)/.test(lower)) return 'expand'
  return 'review'
}

function resolveAgentTask(task: AgentTaskMode, prompt: string): Exclude<AgentTaskMode, 'auto'> {
  return task === 'auto' ? inferAgentTask(prompt) : task
}


function InlineDropdown<T extends string>({
  label,
  value,
  options,
  open,
  onToggle,
  onSelect,
  searchable,
}: {
  label: string
  value: T
  options: Array<DropdownOption<T>>
  open: boolean
  onToggle: () => void
  onSelect: (value: T) => void
  searchable?: boolean
}) {
  const selected = options.find(option => option.value === value) ?? options[0]
  const TriggerIcon = selected.icon
  const [dropdownQuery, setDropdownQuery] = useState('')
  const dropdownSearchRef = useRef<HTMLInputElement>(null)

  const filteredOptions = searchable && dropdownQuery.trim()
    ? options.filter(o =>
        o.label.toLowerCase().includes(dropdownQuery.toLowerCase()) ||
        o.description.toLowerCase().includes(dropdownQuery.toLowerCase())
      )
    : options

  useEffect(() => {
    if (open && searchable) {
      requestAnimationFrame(() => dropdownSearchRef.current?.focus())
    }
    if (!open) setDropdownQuery('')
  }, [open, searchable])

  return (
    <div className="agent-dropdown" data-agent-dropdown-root="true">
      <button
        type="button"
        className={`agent-dropdown-trigger${open ? ' open' : ''}`}
        onClick={onToggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
      >
        <TriggerIcon size={14} strokeWidth={2} className="agent-dropdown-trigger-icon" />
        <span>{selected.label}</span>
        <ChevronDown size={14} strokeWidth={2.2} className="agent-dropdown-trigger-chevron" />
      </button>

      {open && (
        <div className="agent-dropdown-menu" role="menu">
          {searchable && (
            <div className="agent-dropdown-search-wrap">
              <Search size={14} strokeWidth={2} className="agent-dropdown-search-icon" />
              <input
                ref={dropdownSearchRef}
                className="agent-dropdown-search"
                type="text"
                placeholder="Search…"
                value={dropdownQuery}
                onChange={e => setDropdownQuery(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          )}
          <div className={searchable ? 'agent-dropdown-list' : undefined}>
            {filteredOptions.length === 0 ? (
              <div className="agent-dropdown-empty">No results</div>
            ) : (
              filteredOptions.map(option => (
                <button
                  key={option.value}
                  type="button"
                  className={`agent-dropdown-item${option.value === value ? ' selected' : ''}`}
                  onClick={() => onSelect(option.value)}
                  role="menuitemradio"
                  aria-checked={option.value === value}
                >
                  <div className="agent-dropdown-copy">
                    <div className="agent-dropdown-title">{option.label}</div>
                    <div className="agent-dropdown-subtitle">{option.description}</div>
                  </div>
                  {option.value === value && <Check size={14} strokeWidth={2.4} className="agent-dropdown-check" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function DocRow({
  doc, onOpen, onDelete, onRename, deleting, highlighted, hideDelete, sharedBy,
}: {
  doc: Doc
  onOpen: () => void
  onDelete: (e: React.MouseEvent) => void
  onRename: (newTitle: string) => void
  deleting: boolean
  highlighted: boolean
  hideDelete?: boolean
  sharedBy?: string
}) {
  const excerpt = getExcerpt(doc)
  const badge = getContentTypeBadge(doc)
  const collaborators = doc.collaborators ?? []

  const [renaming, setRenaming] = useState(false)
  const [renameDraft, setRenameDraft] = useState(doc.title || '')
  const renameRef = useRef<HTMLInputElement>(null)

  const startRename = (e: React.MouseEvent) => {
    e.stopPropagation()
    setRenameDraft(doc.title || '')
    setRenaming(true)
  }

  const commitRename = () => {
    setRenaming(false)
    const trimmed = renameDraft.trim()
    if (trimmed && trimmed !== doc.title) onRename(trimmed)
    else setRenameDraft(doc.title || '')
  }

  const cancelRename = () => {
    setRenaming(false)
    setRenameDraft(doc.title || '')
  }

  useEffect(() => {
    if (renaming) {
      requestAnimationFrame(() => {
        renameRef.current?.focus()
        renameRef.current?.select()
      })
    }
  }, [renaming])

  // Keep draft in sync if title changes externally
  useEffect(() => {
    if (!renaming) setRenameDraft(doc.title || '')
  }, [doc.title, renaming])

  return (
    <div
      className={`doc-row${highlighted ? ' doc-row--highlighted' : ''}${renaming ? ' doc-row--renaming' : ''}`}
      onClick={renaming ? undefined : onOpen}
      onKeyDown={e => {
        if (renaming) return
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() }
      }}
      tabIndex={renaming ? -1 : 0}
      role="button"
      aria-label={`Open ${doc.title || 'Untitled'}`}
    >
      <div className="doc-row-icon" aria-hidden="true">
        {badge ? <badge.Icon size={16} strokeWidth={1.65} /> : <FileText size={17} strokeWidth={1.6} />}
      </div>

      <div className="doc-row-body">
        {renaming ? (
          <input
            ref={renameRef}
            className="doc-row-rename-input"
            value={renameDraft}
            onChange={e => setRenameDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commitRename() }
              if (e.key === 'Escape') { e.preventDefault(); cancelRename() }
            }}
            onClick={e => e.stopPropagation()}
            maxLength={128}
          />
        ) : (
          <span className="doc-row-title">{doc.title || 'Untitled'}</span>
        )}
        {!renaming && excerpt && <span className="doc-row-excerpt">{excerpt}</span>}
      </div>

      {collaborators.length > 0 && !sharedBy && (
        <div className="doc-row-avatars">
          {collaborators.slice(0, 3).map(c => (
            <div key={c.id} className="doc-row-avatar" style={{ background: c.color }} title={c.name}>
              {c.name[0].toUpperCase()}
            </div>
          ))}
          {collaborators.length > 3 && (
            <div className="doc-row-avatar doc-row-avatar--overflow">+{collaborators.length - 3}</div>
          )}
        </div>
      )}

      {sharedBy && <span className="doc-row-shared-by">from {sharedBy.split(' ')[0]}</span>}

      <span className="doc-row-meta">{timeAgo(doc.updated_at)}</span>

      {!hideDelete && !renaming && (
        <button
          className="doc-row-rename-btn"
          onClick={startRename}
          title="Rename document"
          tabIndex={-1}
        >
          <Pencil size={13} strokeWidth={1.75} />
        </button>
      )}
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
  const { user } = useAuth()
  const [docs, setDocs] = useState<Doc[]>([])
  const [sharedDocs, setSharedDocs] = useState<SharedDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingRoom, setDeletingRoom] = useState<string | null>(null)
  const [resolvedTheme, setResolvedTheme] = useState<'dark' | 'light'>('dark')
  const [query, setQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1)
  const [agentPrompt, setAgentPrompt] = useState('')
  const [agentTask, setAgentTask] = useState<AgentTaskMode>('auto')
  const [agentEffort, setAgentEffort] = useState<AgentEffortMode>('auto')
  const [openAgentDropdown, setOpenAgentDropdown] = useState<'document' | 'task' | 'effort' | null>(null)
  const [selectedAgentRoom, setSelectedAgentRoom] = useState('')
  const [agentComposerStatus, setAgentComposerStatus] = useState('')
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  type ListDoc = Doc & { _sharedBy?: string }
  const uniqueSharedDocs = sharedDocs.filter(s => !docs.some(d => d.room === s.room))
  const allDocs: ListDoc[] = [
    ...docs,
    ...uniqueSharedDocs.map(s => ({ ...s, _sharedBy: s.owner_name })),
  ]
  const filteredDocs: ListDoc[] = filterDocs(allDocs, query)
  const ownedComposerDocs: ComposerDoc[] = docs.map(doc => ({ ...doc, source: 'Owned' }))
  const sharedComposerDocs: ComposerDoc[] = sharedDocs
    .filter(sharedDoc => !docs.some(doc => doc.room === sharedDoc.room))
    .map(doc => ({ ...doc, source: 'Shared', owner_name: doc.owner_name }))
  const composerDocs = [...ownedComposerDocs, ...sharedComposerDocs]
  const selectedComposerDoc = composerDocs.find(doc => doc.room === selectedAgentRoom) ?? null
  const documentDropdownOptions: Array<DropdownOption<string>> = composerDocs.length > 0
    ? composerDocs.map(doc => ({
      value: doc.room,
      label: doc.title || 'Untitled',
      description: doc.source === 'Owned'
        ? `Your document · updated ${timeAgo(doc.updated_at)}.`
        : `Shared${doc.owner_name ? ` by ${doc.owner_name}` : ''} · updated ${timeAgo(doc.updated_at)}.`,
      icon: FileText,
    }))
    : [{
      value: '',
      label: 'No documents',
      description: 'Create a document first to target an agent.',
      icon: FileText,
    }]
  const resolvedAgentTask = resolveAgentTask(agentTask, agentPrompt)
  const canSubmitAgent = !!selectedComposerDoc && agentPrompt.trim().length > 0

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

  // Real-time SSE updates
  useEffect(() => {
    return connectEvents((e: ServerEvent) => {
      if (e.type === 'doc:shared') {
        const doc = e.payload as unknown as SharedDoc
        setSharedDocs(prev => prev.some(d => d.room === doc.room) ? prev : [doc, ...prev])
      } else if (e.type === 'doc:unshared') {
        setSharedDocs(prev => prev.filter(d => d.room !== e.payload.room))
      } else if (e.type === 'doc:deleted') {
        setSharedDocs(prev => prev.filter(d => d.room !== e.payload.room))
      } else if (e.type === 'job:complete') {
        setAgentComposerStatus('Agent finished — open the document to review the result.')
      } else if (e.type === 'job:failed') {
        setAgentComposerStatus('Agent job failed. Try again.')
      }
    })
  }, [])

  // Keyboard shortcut: / or Cmd+K focuses search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
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
  }, [])

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

  useEffect(() => {
    if (composerDocs.length === 0) {
      if (selectedAgentRoom) setSelectedAgentRoom('')
      return
    }

    setBannerDismissed(false)
    if (!selectedAgentRoom || !composerDocs.some(doc => doc.room === selectedAgentRoom)) {
      setSelectedAgentRoom(composerDocs[0].room)
    }
  }, [composerDocs, selectedAgentRoom])

  useEffect(() => {
    if (!agentComposerStatus) return
    const timeout = window.setTimeout(() => setAgentComposerStatus(''), 2200)
    return () => window.clearTimeout(timeout)
  }, [agentComposerStatus])

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (!target.closest('[data-agent-dropdown-root="true"]')) {
        setOpenAgentDropdown(null)
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenAgentDropdown(null)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [])

  useEffect(() => {
    Promise.all([
      getUserDocuments().then(setDocs),
      getSharedDocuments().then(setSharedDocs),
    ]).finally(() => setLoading(false))
    const t = setTimeout(() => {
      getUserDocuments().then(setDocs)
      getSharedDocuments().then(setSharedDocs)
    }, 1200)
    return () => clearTimeout(t)
  }, [])

  const handleCreate = async () => {
    const id = crypto.randomUUID()
    await createDocument(id)
    navigate(`/doc/${id}`)
  }

  const handleDelete = async (room: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setDeletingRoom(room)
    const result = await deleteDocument(room)
    if (result?.success) setDocs(prev => prev.filter(d => d.room !== room))
    setDeletingRoom(null)
  }

  const handleRename = async (room: string, newTitle: string) => {
    setDocs(prev => prev.map(d => d.room === room ? { ...d, title: newTitle } : d))
    await renameDocument(room, newTitle)
  }

  const handleAgentComposerSubmit = async () => {
    if (!selectedComposerDoc || !agentPrompt.trim()) return
    const task = agentPrompt.trim()
    setAgentPrompt('')
    try {
      await submitAgentJob({
        room: selectedAgentRoom,
        task,
        mode: resolvedAgentTask,
        effort: agentEffort,
      })
      setAgentComposerStatus('Agent job queued — you\'ll be notified when it\'s done.')
    } catch {
      setAgentComposerStatus('Failed to queue agent job. Try again.')
    }
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
          {user?.avatar_url ? (
            <img
              src={user.avatar_url}
              alt={user.name}
              className="home-avatar home-avatar--photo"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="home-avatar" style={{ background: user?.color }} aria-label={user?.name}>
              {user?.name?.[0]?.toUpperCase()}
            </div>
          )}
          <button className="home-btn-new" onClick={handleCreate}>
            <Plus size={15} strokeWidth={2} />
            New
          </button>
          <button
            className="home-btn-logout"
            onClick={async () => { await logout(); window.location.href = '/login' }}
            title="Sign out"
          >
            <LogOut size={15} strokeWidth={2} />
          </button>
        </div>
      </nav>

      <section className="home-hero">
        <div className="home-hero-inner">
          <div className="home-hero-content">
            <p className="home-greeting">{greeting()}</p>
            <h1 className="home-hero-name">{user?.name?.split(' ')[0]}.</h1>
          </div>
        </div>
      </section>

      <main className="home-main">
          <section className="agent-composer-inline">
            <div className="agent-composer-wrap">
            <form
              className="agent-composer-shell"
              onSubmit={e => {
                e.preventDefault()
                handleAgentComposerSubmit()
              }}
            >
              <textarea
                id="agent-prompt"
                className="agent-composer-input"
                value={agentPrompt}
                onChange={e => setAgentPrompt(e.target.value)}
                placeholder="Tell an agent what to do with one of your documents..."
                rows={2}
              />

              <div className="agent-toolbar">
                <div className="agent-toolbar-controls">
                  <InlineDropdown
                    label="Select document"
                    value={selectedAgentRoom}
                    options={documentDropdownOptions}
                    open={openAgentDropdown === 'document'}
                    onToggle={() => setOpenAgentDropdown(current => current === 'document' ? null : 'document')}
                    onSelect={value => {
                      setSelectedAgentRoom(value)
                      setOpenAgentDropdown(null)
                    }}
                    searchable
                  />

                  <InlineDropdown
                    label="Select work type"
                    value={agentTask}
                    options={AGENT_TASK_OPTIONS}
                    open={openAgentDropdown === 'task'}
                    onToggle={() => setOpenAgentDropdown(current => current === 'task' ? null : 'task')}
                    onSelect={value => {
                      setAgentTask(value)
                      setOpenAgentDropdown(null)
                    }}
                  />

                  <InlineDropdown
                    label="Select thinking effort"
                    value={agentEffort}
                    options={AGENT_EFFORT_OPTIONS}
                    open={openAgentDropdown === 'effort'}
                    onToggle={() => setOpenAgentDropdown(current => current === 'effort' ? null : 'effort')}
                    onSelect={value => {
                      setAgentEffort(value)
                      setOpenAgentDropdown(null)
                    }}
                  />
                </div>

                <div className="agent-toolbar-actions">
                  <button
                    type="submit"
                    className="agent-send-button"
                    disabled={!canSubmitAgent}
                    aria-label="Run agent"
                  >
                    <ArrowUp size={18} strokeWidth={2.4} />
                  </button>
                </div>
              </div>

            </form>
            {(agentComposerStatus || (composerDocs.length === 0 && !bannerDismissed)) && (
              <div className="agent-composer-banner">
                <span>{agentComposerStatus || 'Create a document first to target an agent.'}</span>
                <button
                  className="agent-composer-banner-close"
                  onClick={() => { setAgentComposerStatus(''); setBannerDismissed(true) }}
                  aria-label="Dismiss"
                >
                  ✕
                </button>
              </div>
            )}
            </div>
          </section>

          <section className="home-section">
            <div className="home-docs-panel">
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

              <div className="home-section-body">
                {loading ? (
                  <div className="home-loading"><div className="home-spinner" /></div>
                ) : allDocs.length === 0 ? (
                  <div className="home-empty home-empty--panel">
                    <FilePlus size={32} strokeWidth={1.25} className="home-empty-icon" />
                    <p className="home-empty-text">No documents yet</p>
                    <button className="home-empty-btn" onClick={handleCreate}>
                      Start writing <ArrowRight size={13} strokeWidth={2} />
                    </button>
                  </div>
                ) : (
                  <div className="doc-list doc-list--flush" onMouseMove={() => setHighlightedIndex(-1)}>
                    <button
                      className="doc-row doc-row--new"
                      onClick={handleCreate}
                    >
                      <div className="doc-row-icon doc-row-icon--new" aria-hidden="true">
                        <Plus size={16} strokeWidth={2.1} />
                      </div>
                      <div className="doc-row-body">
                        <span className="doc-row-title">New document</span>
                      </div>
                    </button>

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
                        onDelete={e => doc._sharedBy ? e.stopPropagation() : handleDelete(doc.room, e)}
                        onRename={newTitle => doc._sharedBy ? undefined : handleRename(doc.room, newTitle)}
                        deleting={deletingRoom === doc.room}
                        highlighted={index === highlightedIndex}
                        hideDelete={!!doc._sharedBy}
                        sharedBy={doc._sharedBy}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

        </main>
    </div>
  )
}
