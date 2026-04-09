import { useEditor, EditorContent, Extension, NodeViewWrapper, NodeViewContent, ReactNodeViewRenderer } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import Suggestion from '@tiptap/suggestion'
import { common, createLowlight } from 'lowlight'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  Heading1, Heading2, Heading3, List, ListOrdered,
  ListTodo, Quote, Code, Code2, Minus, Table2,
  AlignJustify, Settings, FileText,
  AlignLeft, CalendarDays, Clock,
  Bold, Italic, Strikethrough,
  Copy, Check, ChevronDown, ArrowRight,
  GripVertical, Trash2, CopyPlus, Plus,
} from 'lucide-react'
import './App.css'

const lowlight = createLowlight(common)

const LANGUAGES = [
  'plaintext', 'javascript', 'typescript', 'python', 'css', 'html', 'json',
  'bash', 'sql', 'rust', 'go', 'java', 'c', 'cpp', 'ruby', 'php', 'swift',
  'kotlin', 'yaml', 'markdown', 'xml',
]

// ── Code block with language selector ───────────────────────────────
function CodeBlockView({ node, updateAttributes }: any) {
  const lang = node.attrs.language || ''
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [search, setSearch] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const filtered = LANGUAGES.filter(l =>
    l.toLowerCase().includes(search.toLowerCase())
  )

  useEffect(() => {
    if (!dropdownOpen) return
    setSearch('')
    setTimeout(() => searchRef.current?.focus(), 0)
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [dropdownOpen])

  const handleCopy = () => {
    const text = node.textContent || ''
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const selectLang = (l: string) => {
    updateAttributes({ language: l === 'plaintext' ? '' : l })
    setDropdownOpen(false)
  }

  return (
    <NodeViewWrapper as="div" className="code-block-wrapper">
      <div className="code-block-header" contentEditable={false}>
        <div className="code-block-lang-wrap" ref={wrapRef}>
          <button
            className="code-block-lang-btn"
            onClick={() => setDropdownOpen(o => !o)}
            type="button"
          >
            <span className="code-block-lang-label">{lang || 'plaintext'}</span>
            <ChevronDown size={10} strokeWidth={2.5} />
          </button>
          {dropdownOpen && (
            <div className="code-block-dropdown" ref={dropdownRef}>
              <div className="code-block-dropdown-search-wrap">
                <input
                  ref={searchRef}
                  className="code-block-dropdown-search"
                  placeholder="Filter…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Escape') setDropdownOpen(false)
                    if (e.key === 'Enter' && filtered.length > 0) selectLang(filtered[0])
                  }}
                />
              </div>
              <div className="code-block-dropdown-list">
                {filtered.length === 0 ? (
                  <div className="code-block-dropdown-empty">No match</div>
                ) : filtered.map(l => (
                  <button
                    key={l}
                    className={`code-block-dropdown-item ${(lang || 'plaintext') === l ? 'active' : ''}`}
                    onMouseDown={e => { e.preventDefault(); selectLang(l) }}
                    type="button"
                  >
                    {l}
                    {(lang || 'plaintext') === l && <Check size={11} strokeWidth={2.5} />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <button
          className={`code-block-copy ${copied ? 'copied' : ''}`}
          onClick={handleCopy}
          type="button"
          title="Copy code"
        >
          {copied ? <Check size={12} strokeWidth={2.5} /> : <Copy size={12} strokeWidth={2} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre spellCheck={false}><NodeViewContent as="code" /></pre>
    </NodeViewWrapper>
  )
}

const ydoc = new Y.Doc()
const provider = new WebsocketProvider('ws://localhost:1234', 'cowrite-doc', ydoc)
const yTitle = ydoc.getText('title')

// ── Persistent user identity ─────────────────────────────────────────
const getOrCreateUser = () => {
  const stored = localStorage.getItem('cowrite-user')
  if (stored) {
    try { return JSON.parse(stored) } catch { localStorage.removeItem('cowrite-user') }
  }
  const colors = ['#f783ac', '#74c0fc', '#63e6be', '#ffd43b', '#a9e34b', '#ff8c42', '#c77dff']
  const color = colors[Math.floor(Math.random() * colors.length)]
  const user = { id: crypto.randomUUID(), name: '', color }
  localStorage.setItem('cowrite-user', JSON.stringify(user))
  return user
}

const storedUser = getOrCreateUser()
const currentUser = { name: storedUser.name, color: storedUser.color }

interface AwarenessUser { name: string; color: string; isYou?: boolean; anchor?: number; lastActive?: number; status?: 'active' | 'idle' }
interface AwarenessState { user?: AwarenessUser; cursor?: { anchor: number; head: number }; lastActive?: number }

function throttle<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let last = 0
  return ((...args: any[]) => { const now = Date.now(); if (now - last >= ms) { last = now; fn(...args) } }) as T
}

function timeAgo(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return 'Just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ago`
}

// ── Slash command items ──────────────────────────────────────────────
const slashItems = [
  { title: 'Heading 1', subtitle: 'Large section heading', icon: Heading1, command: (e: any) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { title: 'Heading 2', subtitle: 'Medium section heading', icon: Heading2, command: (e: any) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { title: 'Heading 3', subtitle: 'Small section heading', icon: Heading3, command: (e: any) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { title: 'Bullet List', subtitle: 'Unordered list', icon: List, command: (e: any) => e.chain().focus().toggleBulletList().run() },
  { title: 'Numbered List', subtitle: 'Ordered list', icon: ListOrdered, command: (e: any) => e.chain().focus().toggleOrderedList().run() },
  { title: 'To-do List', subtitle: 'Checklist with checkboxes', icon: ListTodo, command: (e: any) => e.chain().focus().toggleTaskList().run() },
  { title: 'Blockquote', subtitle: 'Highlighted quote block', icon: Quote, command: (e: any) => e.chain().focus().toggleBlockquote().run() },
  { title: 'Inline Code', subtitle: 'Monospace inline code', icon: Code, command: (e: any) => e.chain().focus().toggleCode().run() },
  { title: 'Code Block', subtitle: 'Multi-line code block', icon: Code2, command: (e: any) => e.chain().focus().toggleCodeBlock().run() },
  { title: 'Table', subtitle: 'Insert a table', icon: Table2, command: (e: any) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { title: 'Divider', subtitle: 'Horizontal rule', icon: Minus, command: (e: any) => e.chain().focus().setHorizontalRule().run() },
  { title: 'Current Date', subtitle: "Insert today's date", icon: CalendarDays, command: (e: any) => e.chain().focus().insertContent(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })).run() },
  { title: 'Current Time', subtitle: 'Insert current time', icon: Clock, command: (e: any) => e.chain().focus().insertContent(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })).run() },
  { title: 'Paragraph', subtitle: 'Plain text block', icon: AlignLeft, command: (e: any) => e.chain().focus().setParagraph().run() },
]

// ── SlashAlignJustify ────────────────────────────────────────────────────────
function SlashAlignJustify({ items, selectedIndex, position, onSelect }: {
  items: typeof slashItems
  selectedIndex: number
  position: { top: number; left: number }
  onSelect: (item: typeof slashItems[0]) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current?.querySelector('.selected')
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  return createPortal(
    <div className="slash-menu" style={{ top: position.top, left: position.left }} ref={ref}>
      {items.length === 0
        ? <div className="slash-menu-empty">No results</div>
        : items.map((item, i) => {
          const Icon = item.icon
          return (
            <div
              key={item.title}
              className={`slash-menu-item ${i === selectedIndex ? 'selected' : ''}`}
              onMouseDown={e => { e.preventDefault(); onSelect(item) }}
            >
              <div className="slash-menu-icon"><Icon size={14} strokeWidth={2} /></div>
              <div className="slash-menu-text">
                <div className="slash-menu-title">{item.title}</div>
                <div className="slash-menu-subtitle">{item.subtitle}</div>
              </div>
            </div>
          )
        })
      }
    </div>,
    document.body
  )
}

// ── Slash extension ──────────────────────────────────────────────────
function makeSlashExtension(
  suggestionRef: { current: any },
  onOpenOrUpdate: (props: any) => void,
  onClose: () => void,
) {
  return Extension.create({
    name: 'slashCommands',
    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          char: '/',
          startOfLine: false,
          command: ({ editor, range, props }: any) => {
            editor.chain().focus().deleteRange(range).run()
            props.command(editor)
          },
          items: ({ query }: { query: string }) =>
            slashItems.filter(i => i.title.toLowerCase().includes(query.toLowerCase())),
          render: () => ({
            onStart: (props: any) => { suggestionRef.current = props; onOpenOrUpdate(props) },
            onUpdate: (props: any) => { suggestionRef.current = props; onOpenOrUpdate(props) },
            onExit: () => { suggestionRef.current = null; onClose() },
            onKeyDown: () => false as const,
          }),
        }),
      ]
    },
  })
}

// ── Word count helpers ───────────────────────────────────────────────
function countWords(text: string) {
  return text.trim() === '' ? 0 : text.trim().split(/\s+/).length
}
function readingTime(words: number) {
  if (words < 200) return '< 1 min'
  return `${Math.ceil(words / 200)} min`
}

function cursorLabel(editor: any, anchor: number | undefined): string {
  if (!editor || anchor == null) return ''
  try {
    const resolved = editor.state.doc.resolve(anchor)
    const depth = resolved.depth
    for (let d = depth; d >= 0; d--) {
      const node = resolved.node(d)
      if (node.type.name === 'heading') return `Heading ${node.attrs.level}`
      if (node.type.name === 'codeBlock') return 'Code Block'
      if (node.type.name === 'blockquote') return 'Blockquote'
      if (node.type.name === 'bulletList' || node.type.name === 'orderedList' || node.type.name === 'taskList') return 'List'
      if (node.type.name === 'table') return 'Table'
    }
    return 'Paragraph'
  } catch { return '' }
}

// ── Turn-into block types ────────────────────────────────────────────
// Helper: clear all block-level and inline-mark formatting, then apply the target
function clearAndApply(e: any, apply: (chain: any) => any) {
  let chain = e.chain().focus()
  // Clear inline marks that would persist
  if (e.isActive('code')) chain = chain.unsetCode()
  if (e.isActive('bold')) chain = chain.unsetBold()
  if (e.isActive('italic')) chain = chain.unsetItalic()
  if (e.isActive('strike')) chain = chain.unsetStrike()
  // Unwrap blockquote before normalizing (toggleBlockquote removes the wrapper when active)
  if (e.isActive('blockquote')) chain = chain.toggleBlockquote()
  // Normalize to paragraph first to clear any block-level node
  chain = chain.setParagraph()
  // Now apply the target
  apply(chain).run()
}

const turnIntoItems = [
  { title: 'Paragraph', icon: AlignLeft, check: (e: any) => e.isActive('paragraph'), command: (e: any) => clearAndApply(e, c => c) },
  { title: 'Heading 1', icon: Heading1, check: (e: any) => e.isActive('heading', { level: 1 }), command: (e: any) => clearAndApply(e, c => c.setHeading({ level: 1 })) },
  { title: 'Heading 2', icon: Heading2, check: (e: any) => e.isActive('heading', { level: 2 }), command: (e: any) => clearAndApply(e, c => c.setHeading({ level: 2 })) },
  { title: 'Heading 3', icon: Heading3, check: (e: any) => e.isActive('heading', { level: 3 }), command: (e: any) => clearAndApply(e, c => c.setHeading({ level: 3 })) },
  { title: 'Bullet List', icon: List, check: (e: any) => e.isActive('bulletList'), command: (e: any) => clearAndApply(e, c => c.toggleBulletList()) },
  { title: 'Numbered List', icon: ListOrdered, check: (e: any) => e.isActive('orderedList'), command: (e: any) => clearAndApply(e, c => c.toggleOrderedList()) },
  { title: 'To-do List', icon: ListTodo, check: (e: any) => e.isActive('taskList'), command: (e: any) => clearAndApply(e, c => c.toggleTaskList()) },
  { title: 'Blockquote', icon: Quote, check: (e: any) => e.isActive('blockquote'), command: (e: any) => clearAndApply(e, c => c.toggleBlockquote()) },
  { title: 'Code Block', icon: Code2, check: (e: any) => e.isActive('codeBlock'), command: (e: any) => clearAndApply(e, c => c.toggleCodeBlock()) },
]

// ── Floating selection toolbar ───────────────────────────────────────
function FloatingToolbar({ editor }: { editor: any }) {
  const [state, setState] = useState<{ visible: boolean; top: number; left: number }>({
    visible: false, top: 0, left: 0,
  })

  useEffect(() => {
    const update = () => {
      if (!editor || editor.state.selection.empty) {
        setState(s => ({ ...s, visible: false }))
        return
      }
      const { from, to } = editor.state.selection
      const fromCoords = editor.view.coordsAtPos(from)
      const toCoords = editor.view.coordsAtPos(to)
      const rawTop = Math.min(fromCoords.top, toCoords.top) - 44
      const rawLeft = (fromCoords.left + toCoords.left) / 2 - 120
      setState({
        visible: true,
        top: Math.max(8, rawTop),
        left: Math.max(8, Math.min(rawLeft, window.innerWidth - 248)),
      })
    }
    editor.on('selectionUpdate', update)
    editor.on('transaction', update)
    return () => {
      editor.off('selectionUpdate', update)
      editor.off('transaction', update)
    }
  }, [editor])

  if (!state.visible) return null

  return createPortal(
    <div
      className="floating-toolbar"
      style={{ top: state.top, left: state.left }}
      onMouseDown={e => e.preventDefault()}
    >
      <button
        className={`floating-toolbar-btn ${editor.isActive('bold') ? 'active' : ''}`}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="Bold"
      >
        <Bold size={14} strokeWidth={2} />
      </button>
      <button
        className={`floating-toolbar-btn ${editor.isActive('italic') ? 'active' : ''}`}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="Italic"
      >
        <Italic size={14} strokeWidth={2} />
      </button>
      <button
        className={`floating-toolbar-btn ${editor.isActive('strike') ? 'active' : ''}`}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        title="Strikethrough"
      >
        <Strikethrough size={14} strokeWidth={2} />
      </button>
      <div className="floating-toolbar-divider" />
      <button
        className={`floating-toolbar-btn ${editor.isActive('heading', { level: 1 }) ? 'active' : ''}`}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        title="Heading 1"
      >
        <Heading1 size={14} strokeWidth={2} />
      </button>
      <button
        className={`floating-toolbar-btn ${editor.isActive('heading', { level: 2 }) ? 'active' : ''}`}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        title="Heading 2"
      >
        <Heading2 size={14} strokeWidth={2} />
      </button>
      <div className="floating-toolbar-divider" />
      <button
        className={`floating-toolbar-btn ${editor.isActive('code') ? 'active' : ''}`}
        onClick={() => editor.chain().focus().toggleCode().run()}
        title="Inline Code"
      >
        <Code size={14} strokeWidth={2} />
      </button>
    </div>,
    document.body
  )
}

// ── Table bubble menu ────────────────────────────────────────────────
function TableAlignJustify({ editor }: { editor: any }) {
  if (!editor) return null

  const inTable = editor.isActive('table')
  if (!inTable) return null

  const rect = editor.view.dom.getBoundingClientRect()
  const sel = editor.view.state.selection
  const pos = editor.view.coordsAtPos(sel.from)

  return createPortal(
    <div
      className="table-menu"
      style={{ top: pos.top - 40, left: pos.left }}
      onMouseDown={e => e.preventDefault()}
    >
      <button onClick={() => editor.chain().focus().addColumnBefore().run()} title="Add column before">col ←</button>
      <button onClick={() => editor.chain().focus().addColumnAfter().run()} title="Add column after">col →</button>
      <button onClick={() => editor.chain().focus().addRowBefore().run()} title="Add row above">row ↑</button>
      <button onClick={() => editor.chain().focus().addRowAfter().run()} title="Add row below">row ↓</button>
      <button onClick={() => editor.chain().focus().deleteColumn().run()} title="Delete column" className="table-menu-del">del col</button>
      <button onClick={() => editor.chain().focus().deleteRow().run()} title="Delete row" className="table-menu-del">del row</button>
      <button onClick={() => editor.chain().focus().deleteTable().run()} title="Delete table" className="table-menu-del">del table</button>
    </div>,
    document.body
  )
}

// ── Block handle (Notion-style gutter actions) ──────────────────────
function BlockHandle({ editor }: { editor: any }) {
  const [hoveredPos, setHoveredPos] = useState<number | null>(null)
  const [handleCoords, setHandleCoords] = useState<{ top: number; left: number } | null>(null)
  const [blockRect, setBlockRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastNodePos = useRef<number | null>(null)
  const rafId = useRef<number>(0)


  // When the editor content changes (e.g. block deleted via Backspace), clear the handle
  useEffect(() => {
    if (!editor) return
    const onUpdate = () => {
      lastNodePos.current = null
      setHoveredPos(null)
      setHandleCoords(null)
      setBlockRect(null)
      setMenuOpen(false)
    }
    editor.on('update', onUpdate)
    return () => editor.off('update', onUpdate)
  }, [editor])

  // Click outside to close menu
  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
        setBlockRect(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])



  // Mouse tracking — attach to .editor-inner so non-editable node views (code block header) are covered
  useEffect(() => {
    if (!editor?.view) return
    const editorInner = editor.view.dom.closest('.editor-inner') as HTMLElement | null
    const container = editorInner ?? editor.view.dom as HTMLElement

    const hide = () => {
      lastNodePos.current = null
      setHoveredPos(null)
      setHandleCoords(null)
      setBlockRect(null)
    }

    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(rafId.current)
      rafId.current = requestAnimationFrame(() => {
        try {
          // First try direct posAtCoords
          let posInfo = editor.view.posAtCoords({ left: e.clientX, top: e.clientY })

          // Over non-editable areas (e.g. code block header), posAtCoords returns null.
          // Walk up from event target to find the node view wrapper, then probe its content area.
          if (!posInfo) {
            const nodeViewEl = (e.target as HTMLElement)?.closest('[data-node-view-wrapper]') as HTMLElement | null
            if (!nodeViewEl) { hide(); return }
            const r = nodeViewEl.getBoundingClientRect()
            posInfo = editor.view.posAtCoords({ left: r.left + 10, top: r.bottom - 4 })
            if (!posInfo) { hide(); return }
          }

          const $pos = editor.state.doc.resolve(posInfo.pos)
          if ($pos.depth === 0) { hide(); return }

          const nodePos = $pos.before(1)
          if (nodePos < 0) { hide(); return }

          const nodeDom = editor.view.nodeDOM(nodePos) as HTMLElement | null
          if (!nodeDom) { hide(); return }

          // Only update state when block changes
          if (nodePos === lastNodePos.current) return
          lastNodePos.current = nodePos

          const rect = nodeDom.getBoundingClientRect()
          // Use clientHeight (excludes margin) to avoid covering the gap between blocks
          const contentHeight = nodeDom.clientHeight || rect.height
          setHoveredPos(nodePos)
          setHandleCoords({ top: rect.top, left: rect.left - 48 })
          // Only update blockRect when menu is closed — when open, highlight stays locked to the clicked block
          if (!menuOpen) {
            setBlockRect({ top: rect.top, left: rect.left, width: rect.width, height: contentHeight })
          }
        } catch { hide() }
      })
    }

    const onLeave = (e: MouseEvent) => {
      // Don't hide if moving to the handle portal (it's outside the container in the DOM)
      const related = e.relatedTarget as HTMLElement | null
      if (related?.closest('.block-handle')) return
      hideTimeout.current = setTimeout(() => { if (!menuOpen) hide() }, 200)
    }

    const onScroll = () => { if (!menuOpen) hide() }

    container.addEventListener('mousemove', onMove)
    container.addEventListener('mouseleave', onLeave)
    const scrollContainer = container.closest('.editor-container')
    scrollContainer?.addEventListener('scroll', onScroll)

    return () => {
      cancelAnimationFrame(rafId.current)
      container.removeEventListener('mousemove', onMove)
      container.removeEventListener('mouseleave', onLeave)
      scrollContainer?.removeEventListener('scroll', onScroll)
      if (hideTimeout.current) clearTimeout(hideTimeout.current)
    }
  }, [editor, menuOpen])

  const handleMouseEnter = () => {
    if (hideTimeout.current) { clearTimeout(hideTimeout.current); hideTimeout.current = null }
  }

  const handleMouseLeave = () => {
    if (!menuOpen) {
      lastNodePos.current = null
      setHoveredPos(null)
      setHandleCoords(null)
      setBlockRect(null)
    }
  }

  const handleDelete = () => {
    if (hoveredPos == null) return
    editor.chain().focus().setNodeSelection(hoveredPos).deleteSelection().run()
    setMenuOpen(false)
    setHoveredPos(null)
    setHandleCoords(null)
    setBlockRect(null)
    lastNodePos.current = null
  }

  const handleDuplicate = () => {
    if (hoveredPos == null) return
    const node = editor.state.doc.nodeAt(hoveredPos)
    if (!node) return
    const endPos = hoveredPos + node.nodeSize
    editor.chain().focus().insertContentAt(endPos, node.toJSON()).run()
    setMenuOpen(false)
    setBlockRect(null)
  }

  const handleCopy = () => {
    if (hoveredPos == null) return
    const node = editor.state.doc.nodeAt(hoveredPos)
    if (!node) return
    navigator.clipboard.writeText(node.textContent)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleTurnInto = (item: typeof turnIntoItems[0]) => {
    if (hoveredPos == null) return
    const { state } = editor
    const node = state.doc.nodeAt(hoveredPos)
    if (!node) return

    // Find the deepest textblock position inside this block
    let textPos = hoveredPos + 1
    const $start = state.doc.resolve(textPos)
    // For wrapped blocks like blockquote, descend into the inner textblock
    let found = $start
    state.doc.nodesBetween(hoveredPos, hoveredPos + node.nodeSize, (n, pos) => {
      if (n.isTextblock) { found = state.doc.resolve(pos + 1); return false }
    })
    textPos = found.pos

    editor.chain().focus().setTextSelection(textPos).run()
    // After focus+selection, state has updated — now command will see correct isActive
    item.command(editor)
    setMenuOpen(false)
    setBlockRect(null)
  }

  if (!handleCoords) return null

  const handleAdd = () => {
    if (hoveredPos == null) return
    const node = editor.state.doc.nodeAt(hoveredPos)
    if (!node) return
    const endPos = hoveredPos + node.nodeSize
    editor.chain().focus().insertContentAt(endPos, { type: 'paragraph' }).setTextSelection(endPos + 1).run()
  }

  return createPortal(
    <>
      {menuOpen && blockRect && (
        <div
          className="block-highlight-overlay"
          style={{ top: blockRect.top, left: blockRect.left, width: blockRect.width, height: blockRect.height }}
          onMouseEnter={handleMouseEnter}
        />
      )}
      <div
        className="block-handle"
        style={{ top: handleCoords.top, left: handleCoords.left }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        ref={menuRef}
      >
      <button
        className="block-handle-btn"
        onClick={handleAdd}
        onMouseDown={e => e.preventDefault()}
        type="button"
        title="Add block below"
      >
        <Plus size={14} strokeWidth={2} />
      </button>
      <button
        className="block-handle-btn"
        onClick={() => {
          if (hoveredPos != null) {
            // Set node selection so Backspace/Delete natively removes the block
            editor.chain().focus().setNodeSelection(hoveredPos).run()
          }
          setMenuOpen(o => !o)
        }}
        onMouseDown={e => e.preventDefault()}
        type="button"
        title="Block actions"
      >
        <GripVertical size={14} strokeWidth={2} />
      </button>
      {menuOpen && (
        <div className="block-handle-menu" onMouseDown={e => e.preventDefault()}>
          <div className="block-handle-menu-group">
            <div className="block-handle-menu-section">Turn into</div>
            {turnIntoItems.map(item => {
              const Icon = item.icon
              const isActive = item.check(editor)
              return (
                <button
                  key={item.title}
                  className={`block-handle-menu-item ${isActive ? 'active' : ''}`}
                  onClick={() => handleTurnInto(item)}
                  type="button"
                >
                  <div className="block-handle-menu-icon"><Icon size={14} strokeWidth={2} /></div>
                  <span>{item.title}</span>
                  {isActive && <Check size={11} strokeWidth={2.5} className="block-handle-check" />}
                </button>
              )
            })}
          </div>
          <div className="block-handle-menu-sep" />
          <div className="block-handle-menu-group">
            <div className="block-handle-menu-section">Actions</div>
            <button className="block-handle-menu-item" onClick={handleDuplicate} type="button">
              <div className="block-handle-menu-icon"><CopyPlus size={14} strokeWidth={2} /></div>
              <span>Duplicate</span>
            </button>
            <button className="block-handle-menu-item" onClick={handleCopy} type="button">
              <div className="block-handle-menu-icon">
                {copied ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={2} />}
              </div>
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
            <button className="block-handle-menu-item destructive" onClick={handleDelete} type="button">
              <div className="block-handle-menu-icon"><Trash2 size={14} strokeWidth={2} /></div>
              <span>Delete</span>
            </button>
          </div>
        </div>
      )}
    </div>
    </>,
    document.body
  )
}

// ── Cursor overlay: idle dimming + click-to-follow ───────────────────
const IDLE_CURSOR_MS = 180_000

function CursorOverlay({ editor }: { editor: any }) {
  const [following, setFollowing] = useState<{ name: string; color: string } | null>(null)
  const followRef = useRef<{ name: string; color: string } | null>(null)

  // Keep ref in sync for use inside awareness listener
  useEffect(() => { followRef.current = following }, [following])

  // Idle dimming: toggle .cursor-idle on caret elements
  useEffect(() => {
    if (!editor) return
    const applyIdle = () => {
      const now = Date.now()
      const states = provider.awareness.getStates() as Map<number, AwarenessState>
      const carets = document.querySelectorAll('.collaboration-cursor__caret') as NodeListOf<HTMLElement>

      carets.forEach(caret => {
        const label = caret.querySelector('.collaboration-cursor__label') as HTMLElement | null
        const userName = label?.textContent?.trim() || ''
        let isIdle = false

        states.forEach((state) => {
          if (state?.user?.name === userName) {
            const lastActive = state.lastActive ?? now
            isIdle = (now - lastActive) > IDLE_CURSOR_MS
          }
        })

        caret.classList.toggle('cursor-idle', isIdle)
      })
    }

    applyIdle()
    provider.awareness.on('change', applyIdle)
    const interval = setInterval(applyIdle, 5_000)
    return () => {
      provider.awareness.off('change', applyIdle)
      clearInterval(interval)
    }
  }, [editor])

  // Click-to-follow: clicking a cursor starts follow mode (persists until stopped)
  useEffect(() => {
    if (!editor) return

    const onClick = (e: MouseEvent) => {
      const caret = (e.target as HTMLElement).closest('.collaboration-cursor__caret') as HTMLElement | null
      if (!caret) return
      e.preventDefault()
      e.stopPropagation()

      const label = caret.querySelector('.collaboration-cursor__label') as HTMLElement | null
      const userName = label?.textContent?.trim() || ''
      const color = caret.style.borderColor || caret.style.color || '#888'

      // Toggle: clicking same user stops follow
      setFollowing(prev => prev?.name === userName ? null : { name: userName, color })
    }

    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [editor])

  // Stop following when the user interacts with the editor themselves
  useEffect(() => {
    if (!editor || !following) return
    const stopOnLocal = () => {
      // Only stop if triggered by local user input (not remote transactions)
      if (followRef.current) setFollowing(null)
    }
    const onKeyDown = () => stopOnLocal()
    const onMouseDown = (e: MouseEvent) => {
      // Don't stop if clicking a cursor or the toast
      const el = e.target as HTMLElement
      if (el.closest('.collaboration-cursor__caret') || el.closest('.cursor-follow-toast')) return
      stopOnLocal()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onMouseDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [editor, following])

  // Follow loop: poll caret position via rAF for reliable tracking
  useEffect(() => {
    if (!editor || !following) return

    let rafId: number

    const scrollToUser = () => {
      const target = followRef.current
      if (!target) return

      const carets = document.querySelectorAll('.collaboration-cursor__caret') as NodeListOf<HTMLElement>
      let caretEl: HTMLElement | null = null
      carets.forEach(caret => {
        const label = caret.querySelector('.collaboration-cursor__label') as HTMLElement | null
        if (label?.textContent?.trim() === target.name) caretEl = caret as HTMLElement
      })

      if (!caretEl) return
      const container = document.querySelector('.editor-container')
      if (!container) return

      const caretRect = caretEl.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()

      const margin = 100
      const isVisible = caretRect.top >= containerRect.top + margin
        && caretRect.bottom <= containerRect.bottom - margin

      if (!isVisible) {
        const scrollTarget = caretRect.top - containerRect.top + container.scrollTop - containerRect.height / 3
        container.scrollTo({ top: scrollTarget, behavior: 'smooth' })
      }
    }

    // Poll at ~4fps — lightweight but responsive
    const poll = () => {
      scrollToUser()
      rafId = requestAnimationFrame(() => {
        setTimeout(() => { rafId = requestAnimationFrame(poll) }, 250)
      })
    }
    // Initial scroll immediately
    scrollToUser()
    rafId = requestAnimationFrame(poll)

    return () => cancelAnimationFrame(rafId)
  }, [editor, following])

  if (!following) return null

  return createPortal(
    <div className="cursor-follow-toast">
      <span className="cursor-follow-toast-dot" style={{ background: following.color }} />
      <span className="cursor-follow-toast-text">
        Following <strong>{following.name}</strong>
      </span>
      <button
        className="cursor-follow-toast-stop"
        onClick={() => setFollowing(null)}
        type="button"
      >
        Stop
      </button>
    </div>,
    document.body
  )
}

// ── Name Modal ───────────────────────────────────────────────────────
function NameModal({ onConfirm }: { onConfirm: (name: string) => void }) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Typing animation for placeholder
    const text = 'Your name'
    let i = 0
    let timeout: ReturnType<typeof setTimeout>
    const type = () => {
      if (inputRef.current && i <= text.length) {
        inputRef.current.setAttribute('placeholder', text.slice(0, i))
        i++
        timeout = setTimeout(type, 60 + Math.random() * 40)
      }
    }
    // Small initial delay before typing starts
    timeout = setTimeout(type, 400)
    return () => clearTimeout(timeout)
  }, [])

  const handleSubmit = () => {
    const name = value.trim()
    if (!name) return
    onConfirm(name)
  }

  return createPortal(
    <div className="name-modal-overlay">
      <div className="name-modal">
        <h2 className="name-modal-title">What should we call you?</h2>
        <p className="name-modal-subtitle">This name will be visible to your collaborators.</p>
        <div className="name-modal-input-wrap">
          <input
            ref={inputRef}
            className="name-modal-input"
            placeholder=""
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            autoFocus
            maxLength={32}
          />
          <button
            className="name-modal-submit"
            onClick={handleSubmit}
            disabled={!value.trim()}
            aria-label="Join"
          >
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── App ──────────────────────────────────────────────────────────────
export default function App() {
  const [onlineUsers, setOnlineUsers] = useState<AwarenessUser[]>([])
  const [connected, setConnected] = useState(false)
  const [docTitle, setDocTitle] = useState(() => yTitle.toString() || '')
  const [theme, setTheme] = useState<'dark' | 'light' | 'system'>(() => {
    return (localStorage.getItem('cowrite-theme') as 'dark' | 'light' | 'system') || 'system'
  })
  const [resolvedTheme, setResolvedTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('cowrite-theme') as string
    if (saved === 'dark' || saved === 'light') return saved
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const [userName, setUserName] = useState(storedUser.name || '')
  const [showNameModal, setShowNameModal] = useState(false)

  const handleNameConfirm = useCallback((name: string) => {
    const updated = { ...storedUser, name }
    localStorage.setItem('cowrite-user', JSON.stringify(updated))
    currentUser.name = name
    setUserName(name)
    setShowNameModal(false)
    provider.awareness.setLocalStateField('user', { name, color: currentUser.color })
  }, [])

  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [words, setWords] = useState(0)
  const [inTable, setInTable] = useState(false)
  const [fullWidth, setFullWidth] = useState(false)
  const [spellCheck, setSpellCheck] = useState(false)
  const [editorFont, setEditorFont] = useState<'sans' | 'serif' | 'mono'>('sans')
  const [editorSize, setEditorSize] = useState<'sm' | 'md' | 'lg'>('md')
  const [editorLineHeight, setEditorLineHeight] = useState<'compact' | 'normal' | 'spacious'>('normal')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsRef = useRef<HTMLDivElement>(null)

  const [avatarPopoverOpen, setAvatarPopoverOpen] = useState(false)
  const [presenceSearch, setPresenceSearch] = useState('')
  const avatarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!avatarPopoverOpen) return
    const handler = (e: MouseEvent) => {
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) {
        setAvatarPopoverOpen(false)
        setPresenceSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [avatarPopoverOpen])

  const [slashOpen, setSlashOpen] = useState(false)
  const [slashItems_, setSlashItems] = useState(slashItems)
  const [slashIdx, setSlashIdx] = useState(0)
  const [slashPos, setSlashPos] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (!settingsOpen) return
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [settingsOpen])

  useEffect(() => {
    localStorage.setItem('cowrite-theme', theme)
    const apply = () => {
      const resolved = theme === 'system'
        ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : theme
      setResolvedTheme(resolved)
      document.documentElement.setAttribute('data-theme', resolved)
    }
    apply()
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
  }, [theme])

  useEffect(() => {
    const fontMap = {
      sans: "'Geist', -apple-system, sans-serif",
      serif: "Georgia, 'Times New Roman', serif",
      mono: "'Geist Mono', monospace",
    }
    const sizeMap = { sm: '13px', md: '15px', lg: '17px' }
    const lhMap = { compact: '1.5', normal: '1.75', spacious: '2.1' }
    const root = document.documentElement
    root.style.setProperty('--editor-font', fontMap[editorFont])
    root.style.setProperty('--editor-size', sizeMap[editorSize])
    root.style.setProperty('--editor-line-height', lhMap[editorLineHeight])
  }, [editorFont, editorSize, editorLineHeight])

  const suggestionPropsRef = useRef<any>(null)

  const handleSlashOpenOrUpdate = useCallback((props: any) => {
    const r = props.clientRect?.()
    if (!r) return
    setSlashItems(props.items)
    setSlashIdx(0)
    setSlashPos({ top: r.bottom + 6, left: r.left })
    setSlashOpen(true)
  }, [])

  const handleSlashClose = useCallback(() => setSlashOpen(false), [])

  const slashExtension = useRef(
    makeSlashExtension(suggestionPropsRef, handleSlashOpenOrUpdate, handleSlashClose)
  ).current

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ history: false, codeBlock: false }),
      Placeholder.configure({ placeholder: "Write something, or type '/' for commands…" }),
      TaskList,
      TaskItem.configure({ nested: true }),
      CodeBlockLowlight.extend({
        addNodeView() { return ReactNodeViewRenderer(CodeBlockView) },
      }).configure({ lowlight }),
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      Collaboration.configure({ document: ydoc }),
      CollaborationCursor.configure({
        provider,
        user: currentUser,
        selectionRender: (user: { color: string }) => ({
          style: `background-color: ${user.color}26`,
          class: 'ProseMirror-yjs-selection'
        })
      }),
      slashExtension,
    ],
    onUpdate({ editor }) {
      const text = editor.getText()
      setWords(countWords(text))
    },
    onSelectionUpdate({ editor }) {
      setInTable(editor.isActive('table'))
    },
  })

  useEffect(() => {
    if (!slashOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIdx(i => (i + 1) % slashItems_.length) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIdx(i => (i - 1 + slashItems_.length) % slashItems_.length) }
      else if (e.key === 'Enter') {
        e.preventDefault()
        if (slashItems_[slashIdx] && suggestionPropsRef.current) {
          suggestionPropsRef.current.command(slashItems_[slashIdx])
          setSlashOpen(false)
        }
      } else if (e.key === 'Escape') setSlashOpen(false)
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [slashOpen, slashItems_, slashIdx])

  useEffect(() => {
    if (currentUser.name) {
      provider.awareness.setLocalStateField('user', currentUser)
      provider.awareness.setLocalStateField('lastActive', Date.now())
    }
    provider.on('status', (event: { status: string }) => setConnected(event.status === 'connected'))

    const markActive = throttle(() => {
      provider.awareness.setLocalStateField('lastActive', Date.now())
    }, 1000)
    document.addEventListener('keydown', markActive)
    document.addEventListener('mousemove', markActive)

    const updateUsers = () => {
      const now = Date.now()
      const IDLE_MS = 180_000 // 3 minutes
      const states = provider.awareness.getStates() as Map<number, AwarenessState>
      const users: AwarenessUser[] = []
      states.forEach((state, clientID) => {
        if (state?.user) {
          const lastActive = state.lastActive ?? now
          const isIdle = now - lastActive > IDLE_MS
          users.push({
            ...state.user,
            isYou: clientID === provider.awareness.clientID,
            anchor: state.cursor?.anchor,
            lastActive,
            status: isIdle ? 'idle' : 'active',
          })
        }
      })
      setOnlineUsers(users)
    }
    updateUsers()
    provider.awareness.on('change', updateUsers)

    const idleInterval = setInterval(updateUsers, 30_000)

    const updateTitle = () => {
      const remote = yTitle.toString()
      if (remote) setDocTitle(remote)
    }
    yTitle.observe(updateTitle)

    return () => {
      provider.awareness.off('change', updateUsers)
      document.removeEventListener('keydown', markActive)
      document.removeEventListener('mousemove', markActive)
      yTitle.unobserve(updateTitle)
      clearInterval(idleInterval)
    }
  }, [])

  useEffect(() => {
    if (!userName) return
    provider.awareness.setLocalStateField('user', {
      name: userName,
      color: currentUser.color,
    })
    provider.awareness.setLocalStateField('lastActive', Date.now())
  }, [userName])

  const handleTitleChange = (newValue: string) => {
    setDocTitle(newValue)
    ydoc.transact(() => {
      yTitle.delete(0, yTitle.length)
      yTitle.insert(0, newValue)
    })
  }

  return (
    <div className="app">
      {/* Sidebar */}
      <div className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-inner">
          <div className="sidebar-header">
            <div className="sidebar-logo">
              <img
                src={resolvedTheme === 'dark' ? '/cowrite_darkmode.svg' : '/cowrite_lightmode.svg'}
                alt="CoWrite"
                className="sidebar-logo-img"
              />
            </div>
            <div className="sidebar-header-actions">
              <button className="sidebar-close" onClick={() => setSidebarOpen(false)} title="Close sidebar">
                <AlignJustify size={16} strokeWidth={2} />
              </button>
            </div>
          </div>

          <div className="sidebar-doc-title">
            <FileText size={14} />
            <span>{docTitle || 'Untitled'}</span>
          </div>

          <div className="sidebar-section-header">
            <span className="sidebar-section-title">Collaborators</span>
            <span className="sidebar-section-count">{onlineUsers.length}</span>
          </div>

          <div className="user-list">
            {onlineUsers.map((user, i) => (
              <div className={`user-item ${user.status === 'idle' ? 'idle' : ''}`} key={i}>
                <div className="user-avatar" style={{ background: user.color }}>
                  {user.name[0]}
                  <span className={`user-status-ring ${user.status}`} />
                </div>
                <div className="user-info">
                  <span className="user-name">
                    {user.name}
                    {user.isYou && <span className="you-badge">You</span>}
                  </span>
                  <span className="user-location">{cursorLabel(editor, user.anchor)}</span>
                </div>
                {user.status === 'idle' && !user.isYou && (
                  <span className="user-meta">{timeAgo(Date.now() - (user.lastActive ?? Date.now()))}</span>
                )}
              </div>
            ))}
          </div>

          <div className="sidebar-spacer" />

          <div className="sidebar-bottom">
            <div className="sidebar-divider" />
            <div className="sidebar-connection">
              <span className={`sidebar-connection-dot ${connected ? 'connected' : 'disconnected'}`} />
              <span>{connected ? 'Connected' : 'Reconnecting…'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main */}
      <div className="main">
        {/* Topbar */}
        <div className="topbar">
          {/* Left: logo + divider + title */}
          <div className="topbar-left">
            {!sidebarOpen && (
              <>
                <img
                  src={resolvedTheme === 'dark' ? '/cowrite_darkmode.svg' : '/cowrite_lightmode.svg'}
                  alt="CoWrite"
                  className="topbar-logo-img"
                />
                <div className="topbar-logo-divider" />
              </>
            )}
            <div className="topbar-title-wrapper">
              <span className="topbar-title-sizer">{docTitle || 'Untitled'}</span>
              <input
                className="topbar-title"
                value={docTitle}
                onChange={e => handleTitleChange(e.target.value)}
                placeholder="Untitled"
                spellCheck={false}
              />
            </div>
          </div>

          {/* Right: avatars + word count + sidebar toggle */}
          <div className="topbar-right">
            <div className="topbar-avatars-wrap" ref={avatarRef}>
              <div
                className="topbar-avatars"
                onClick={() => { setAvatarPopoverOpen(o => !o); setPresenceSearch('') }}
                style={{ cursor: 'pointer' }}
              >
                {onlineUsers.length > 4 && (
                  <div className="topbar-avatar topbar-avatar-overflow">+{onlineUsers.length - 4}</div>
                )}
                {onlineUsers.slice(0, 4).map((user, i) => (
                  <div
                    key={i}
                    className="topbar-avatar"
                    style={{ background: user.color, zIndex: 10 - i }}
                  >
                    {user.name[0]}
                  </div>
                ))}
              </div>
              {avatarPopoverOpen && (
                <div className="avatar-popover">
                  <div className="avatar-popover-header">
                    <span className="avatar-popover-title">{onlineUsers.length} online</span>
                  </div>
                  {onlineUsers.length > 5 && (
                    <div className="avatar-popover-search-wrap">
                      <input
                        className="avatar-popover-search"
                        placeholder="Search…"
                        value={presenceSearch}
                        onChange={e => setPresenceSearch(e.target.value)}
                        autoFocus
                      />
                    </div>
                  )}
                  <div className="avatar-popover-list">
                    {onlineUsers
                      .filter(u => u.name.toLowerCase().includes(presenceSearch.toLowerCase()))
                      .map((user, i) => (
                        <div key={i} className={`avatar-popover-row ${user.status === 'idle' ? 'idle' : ''}`}>
                          <div className="avatar-popover-avatar" style={{ background: user.color }}>
                            {user.name[0]}
                          </div>
                          <div className="avatar-popover-info">
                            <span className="avatar-popover-name">{user.name}{user.isYou ? ' (you)' : ''}</span>
                            <span className="avatar-popover-location">{cursorLabel(editor, user.anchor)}</span>
                          </div>
                          <div className="avatar-popover-meta">
                            <span className={`avatar-popover-status ${user.status}`} />
                            <span className="avatar-popover-time">
                              {user.isYou ? 'You' : user.status === 'idle' ? timeAgo(Date.now() - (user.lastActive ?? Date.now())) : 'Active'}
                            </span>
                          </div>
                        </div>
                      ))
                    }
                  </div>
                </div>
              )}
            </div>
            {words > 0 && (
              <div className="topbar-stats">
                <span className="topbar-stat-num">{words.toLocaleString()}</span>
                <span className="topbar-stat-unit">{words === 1 ? 'word' : 'words'}</span>
                <span className="topbar-stat-sep" />
                <span className="topbar-stat-num">{readingTime(words)}</span>
              </div>
            )}
            <div className="settings-wrap" ref={settingsRef}>
              <button className="topbar-menu-btn" onClick={() => setSettingsOpen(o => !o)} title="Settings">
                <Settings size={16} strokeWidth={2} />
              </button>
              {settingsOpen && (
                <div className="settings-popover">
                  <div className="settings-section">
                    <div className="settings-section-label">Appearance</div>
                    <div className="settings-row">
                      <span className="settings-label">Theme</span>
                      <div className="settings-segment">
                        <button className={`settings-segment-btn ${theme === 'light' ? 'active' : ''}`} onClick={() => setTheme('light')}>Light</button>
                        <button className={`settings-segment-btn ${theme === 'dark' ? 'active' : ''}`} onClick={() => setTheme('dark')}>Dark</button>
                        <button className={`settings-segment-btn ${theme === 'system' ? 'active' : ''}`} onClick={() => setTheme('system')}>System</button>
                      </div>
                    </div>
                  </div>
                  <div className="settings-section">
                    <div className="settings-section-label">Layout</div>
                    <div className="settings-row">
                      <span className="settings-label">Full width</span>
                      <label className="settings-toggle">
                        <input type="checkbox" checked={fullWidth} onChange={e => setFullWidth(e.target.checked)} />
                        <span className="settings-toggle-track" />
                      </label>
                    </div>
                  </div>
                  <div className="settings-section">
                    <div className="settings-section-label">Editor</div>
                    <div className="settings-row">
                      <span className="settings-label">Font</span>
                      <div className="settings-segment">
                        <button className={`settings-segment-btn ${editorFont === 'sans' ? 'active' : ''}`} onClick={() => setEditorFont('sans')}>Sans</button>
                        <button className={`settings-segment-btn ${editorFont === 'serif' ? 'active' : ''}`} onClick={() => setEditorFont('serif')}>Serif</button>
                        <button className={`settings-segment-btn ${editorFont === 'mono' ? 'active' : ''}`} onClick={() => setEditorFont('mono')}>Mono</button>
                      </div>
                    </div>
                    <div className="settings-row">
                      <span className="settings-label">Size</span>
                      <div className="settings-segment">
                        <button className={`settings-segment-btn ${editorSize === 'sm' ? 'active' : ''}`} onClick={() => setEditorSize('sm')}>S</button>
                        <button className={`settings-segment-btn ${editorSize === 'md' ? 'active' : ''}`} onClick={() => setEditorSize('md')}>M</button>
                        <button className={`settings-segment-btn ${editorSize === 'lg' ? 'active' : ''}`} onClick={() => setEditorSize('lg')}>L</button>
                      </div>
                    </div>
                    <div className="settings-row">
                      <span className="settings-label">Line height</span>
                      <div className="settings-segment">
                        <button className={`settings-segment-btn ${editorLineHeight === 'compact' ? 'active' : ''}`} onClick={() => setEditorLineHeight('compact')}>Compact</button>
                        <button className={`settings-segment-btn ${editorLineHeight === 'normal' ? 'active' : ''}`} onClick={() => setEditorLineHeight('normal')}>Normal</button>
                        <button className={`settings-segment-btn ${editorLineHeight === 'spacious' ? 'active' : ''}`} onClick={() => setEditorLineHeight('spacious')}>Spacious</button>
                      </div>
                    </div>
                    <div className="settings-row">
                      <span className="settings-label">Spell check</span>
                      <label className="settings-toggle">
                        <input type="checkbox" checked={spellCheck} onChange={e => setSpellCheck(e.target.checked)} />
                        <span className="settings-toggle-track" />
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <button className="topbar-menu-btn" onClick={() => setSidebarOpen(o => !o)} title="Toggle sidebar">
              <AlignJustify size={16} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* Editor */}
        <div className="editor-container">
          <div className={`editor-inner${fullWidth ? ' full-width' : ''}`}>
            <input
              className="doc-title-input"
              value={docTitle}
              onChange={e => handleTitleChange(e.target.value)}
              placeholder="Untitled"
              spellCheck={spellCheck}
            />
            <EditorContent editor={editor} spellCheck={spellCheck} />
          </div>
        </div>
      </div>

      {/* Slash menu */}
      {slashOpen && (
        <SlashAlignJustify
          items={slashItems_}
          selectedIndex={slashIdx}
          position={slashPos}
          onSelect={(item) => {
            suggestionPropsRef.current?.command(item)
            setSlashOpen(false)
          }}
        />
      )}

      {/* Table controls */}
      {inTable && editor && <TableAlignJustify editor={editor} />}

      {/* Floating selection toolbar */}
      {editor && <FloatingToolbar editor={editor} />}

      {/* Block handle */}
      {editor && <BlockHandle editor={editor} />}

      {/* Cursor overlay: idle dimming + context preview */}
      {editor && <CursorOverlay editor={editor} />}

      {/* Name modal on first visit */}
      {showNameModal && <NameModal onConfirm={handleNameConfirm} />}
    </div>
  )
}
