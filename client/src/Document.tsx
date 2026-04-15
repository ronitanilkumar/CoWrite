import { useEditor, EditorContent, Extension, NodeViewWrapper, NodeViewContent, ReactNodeViewRenderer } from '@tiptap/react'
import { TextSelection, Plugin, PluginKey } from '@tiptap/pm/state'
import { DecorationSet, Decoration } from '@tiptap/pm/view'
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
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { createDocument as createDocumentAPI, getAllUsers, getDocShares, shareDocument, unshareDocument, streamAIContent, getDocPrefs, saveDocPrefs, connectEvents, type DocPrefs } from './api'
import { createPortal } from 'react-dom'
import {
  Heading1, Heading2, Heading3, List, ListOrdered,
  ListTodo, Quote, Code, Code2, Minus, Table2,
  AlignJustify, Settings, FileText,
  AlignLeft, CalendarDays, Clock,
  Bold, Italic, Strikethrough,
  Copy, Check, ChevronDown,
  GripVertical, Trash2, CopyPlus, Plus,
  ArrowLeft, Share2, Link, Search,
} from 'lucide-react'
import './App.css'

const lowlight = createLowlight(common)

function ClaudeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="m4.714 15.956l4.718-2.648l.079-.23l-.08-.128h-.23l-.79-.048l-2.695-.073l-2.337-.097l-2.265-.122l-.57-.121l-.535-.704l.055-.353l.48-.321l.685.06l1.518.104l2.277.157l1.651.098l2.447.255h.389l.054-.158l-.133-.097l-.103-.098l-2.356-1.596l-2.55-1.688l-1.336-.972l-.722-.491L2 6.223l-.158-1.008l.656-.722l.88.06l.224.061l.893.686l1.906 1.476l2.49 1.833l.364.304l.146-.104l.018-.072l-.164-.274l-1.354-2.446l-1.445-2.49l-.644-1.032l-.17-.619a3 3 0 0 1-.103-.729L6.287.133L6.7 0l.995.134l.42.364l.619 1.415L9.735 4.14l1.555 3.03l.455.898l.243.832l.09.255h.159V9.01l.127-1.706l.237-2.095l.23-2.695l.08-.76l.376-.91l.747-.492l.583.28l.48.685l-.067.444l-.286 1.851l-.558 2.903l-.365 1.942h.213l.243-.242l.983-1.306l1.652-2.064l.728-.82l.85-.904l.547-.431h1.032l.759 1.129l-.34 1.166l-1.063 1.347l-.88 1.142l-1.263 1.7l-.79 1.36l.074.11l.188-.02l2.853-.606l1.542-.28l1.84-.315l.832.388l.09.395l-.327.807l-1.967.486l-2.307.462l-3.436.813l-.043.03l.049.061l1.548.146l.662.036h1.62l3.018.225l.79.522l.473.638l-.08.485l-1.213.62l-1.64-.389l-3.825-.91l-1.31-.329h-.183v.11l1.093 1.068l2.003 1.81l2.508 2.33l.127.578l-.321.455l-.34-.049l-2.204-1.657l-.85-.747l-1.925-1.62h-.127v.17l.443.649l2.343 3.521l.122 1.08l-.17.353l-.607.213l-.668-.122l-1.372-1.924l-1.415-2.168l-1.141-1.943l-.14.08l-.674 7.254l-.316.37l-.728.28l-.607-.461l-.322-.747l.322-1.476l.388-1.924l.316-1.53l.285-1.9l.17-.632l-.012-.042l-.14.018l-1.432 1.967l-2.18 2.945l-1.724 1.845l-.413.164l-.716-.37l.066-.662l.401-.589l2.386-3.036l1.439-1.882l.929-1.086l-.006-.158h-.055L4.138 18.56l-1.13.146l-.485-.456l.06-.746l.231-.243l1.907-1.312Z" />
    </svg>
  )
}

// ── AI fade-out highlight plugin ─────────────────────────────────────
const aiDecoKey = new PluginKey<DecorationSet>('aiDecorations')

function buildAIDecos(doc: any, from: number, to: number): DecorationSet {
  from = Math.max(0, from)
  to = Math.min(doc.content.size, to)
  if (from >= to) return DecorationSet.empty
  const decos: Decoration[] = []
  doc.nodesBetween(from, to, (node: any, pos: number) => {
    if (!node.isBlock || node.childCount === 0) return
    decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'ai-highlight-fade' }))
  })
  if (decos.length === 0) return DecorationSet.empty
  return DecorationSet.create(doc, decos)
}

function makeAIDecoPlugin() {
  return new Plugin({
    key: aiDecoKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        const meta = tr.getMeta(aiDecoKey)
        if (meta === null) return DecorationSet.empty
        if (meta) return buildAIDecos(tr.doc, meta.from, meta.to)
        return set.map(tr.mapping, tr.doc)
      },
    },
    props: {
      decorations(state) { return aiDecoKey.getState(state) },
    },
  })
}

const AI_DECO_EXTENSION = Extension.create({
  name: 'aiDecorations',
  addProseMirrorPlugins() { return [makeAIDecoPlugin()] },
})

/** Convert plain text (with \n\n paragraph breaks) to TipTap-compatible JSON content */
function convertTextToContent(text: string): any[] {
  const paragraphs = text.split(/\n{2,}/)
  return paragraphs.map(p => {
    if (!p.trim()) return { type: 'paragraph' }
    const segments = p.split('\n')
    const content: any[] = []
    segments.forEach((seg, i) => {
      if (seg) content.push({ type: 'text', text: seg })
      if (i < segments.length - 1) content.push({ type: 'hardBreak' })
    })
    return { type: 'paragraph', content }
  })
}

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


interface AwarenessUser { name: string; color: string; isYou?: boolean; isAI?: boolean; anchor?: number; lastActive?: number; status?: 'active' | 'idle' }
interface AwarenessState { user?: AwarenessUser; cursor?: { anchor: number; head: number }; lastActive?: number; aiPresence?: { name: string; color: string; isAI: true; status: 'active'; anchor: number; lastActive: number } }

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

// ── Task list exit: Enter or Backspace on empty task item ──────────────
// Uses ReplaceAroundStep to surgically strip the taskItem/taskList wrapper
// around an empty item, placing a clean paragraph in the document flow.
function exitEmptyTaskItem(editor: any): boolean {
  const { state } = editor
  const { $from } = state.selection
  if (!state.selection.empty) return false
  if ($from.parent.type.name !== 'paragraph') return false
  if ($from.parent.content.size !== 0) return false

  // depth layout: doc(0) > taskList(1) > taskItem(2) > paragraph(3=$from.depth)
  // Find taskList depth (depth - 2 from paragraph)
  const taskItemDepth = $from.depth - 1
  const taskListDepth = $from.depth - 2
  if (taskItemDepth < 1 || taskListDepth < 1) return false

  const taskItem = $from.node(taskItemDepth)
  const taskList = $from.node(taskListDepth)
  if (!taskItem || taskItem.type.name !== 'taskItem') return false
  if (!taskList || taskList.type.name !== 'taskList') return false

  const taskListPos = $from.before(taskListDepth)   // position of <taskList opening token>
  const taskListEnd = taskListPos + taskList.nodeSize // position after </taskList closing token>
  const taskItemPos = $from.before(taskItemDepth)   // position of <taskItem opening token>
  const taskItemEnd = taskItemPos + taskItem.nodeSize // position after </taskItem closing token>

  const isOnlyItem = taskList.childCount === 1
  const { schema, tr } = state

  if (isOnlyItem) {
    // Replace the entire taskList (opening+closing tokens + single taskItem) with empty paragraph.
    // ReplaceAroundStep: keep nothing, insert paragraph content.
    const para = schema.nodes.paragraph.createAndFill()!
    tr.replaceWith(taskListPos, taskListEnd, para)
    tr.setSelection(TextSelection.near(tr.doc.resolve(taskListPos + 1)))
  } else {
    // Strip just the empty taskItem's opening/closing tokens, keeping its content (empty paragraph).
    // The empty paragraph becomes a sibling after the taskList.
    // We do this in two steps on the same transaction:
    // 1. Cut the empty taskItem out of the list (delete taskItem start/end tokens, keeping inner paragraph)
    // 2. Move that paragraph to after the taskList

    // Step 1: use ReplaceAroundStep to unwrap the taskItem node.
    // This replaces [taskItemPos, taskItemEnd] keeping the inner content [taskItemPos+1, taskItemEnd-1]
    // but places it *after* the taskList by using a different insertion point.
    //
    // Simpler: just delete the empty taskItem entirely, then insert a paragraph after the (now-shorter) list.
    const deletedSize = taskItemEnd - taskItemPos
    tr.delete(taskItemPos, taskItemEnd)
    // After deletion, taskList end shifts by -deletedSize
    const newListEnd = taskListEnd - deletedSize
    const para = schema.nodes.paragraph.createAndFill()!
    tr.insert(newListEnd, para)
    tr.setSelection(TextSelection.near(tr.doc.resolve(newListEnd + 1)))
  }

  editor.view.dispatch(tr)
  return true
}

const TaskListExit = Extension.create({
  name: 'taskListExit',
  priority: 200,
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => exitEmptyTaskItem(editor),
      Backspace: ({ editor }) => {
        const { state } = editor
        const { $from } = state.selection
        if (!state.selection.empty) return false
        if ($from.parent.type.name !== 'paragraph') return false
        if ($from.parent.content.size !== 0) return false
        if ($from.parentOffset !== 0) return false

        // Case 1: cursor is inside an empty taskItem → exit the list
        const maybeTaskItem = $from.node($from.depth - 1)
        if (maybeTaskItem && maybeTaskItem.type.name === 'taskItem') {
          return exitEmptyTaskItem(editor)
        }

        // Case 2: cursor is in an empty top-level paragraph immediately after a taskList
        // Prevent native merge-back into the list (which would cause a loop)
        const paraStart = $from.before($from.depth)
        if (paraStart > 0) {
          const $before = state.doc.resolve(paraStart - 1)
          const nodeBefore = $before.node($before.depth)
          if (nodeBefore && nodeBefore.type.name === 'taskList') {
            // Just delete this empty paragraph — don't merge into the list
            const tr = state.tr
            tr.delete(paraStart, paraStart + $from.parent.nodeSize)
            editor.view.dispatch(tr)
            return true
          }
        }

        return false
      },
    }
  },
})

// ── Slash command items ──────────────────────────────────────────────
const AI_SUBMODES = [
  { aiMode: 'write' as const,    label: 'Write',    desc: 'Ask AI to write something' },
  { aiMode: 'continue' as const, label: 'Continue', desc: 'Continue writing from cursor' },
  { aiMode: 'summarize' as const, label: 'Summarize', desc: 'Summarize this document' },
]

const slashItems = [
  { title: 'Ask AI', subtitle: 'Write, continue, or summarize', icon: ClaudeIcon, isAIGroup: true, command: (_e: any) => {} },
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
  onSelect: (item: any) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [aiExpanded, setAiExpanded] = useState(false)

  useEffect(() => {
    const el = ref.current?.querySelector('.selected')
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  // Flatten items for selectedIndex tracking: AI group counts as 1 when collapsed, 4 when expanded
  const flatItems: any[] = []
  items.forEach(item => {
    if ((item as any).isAIGroup) {
      flatItems.push(item)
      if (aiExpanded) {
        AI_SUBMODES.forEach(sub => flatItems.push({ ...sub, isAISub: true }))
      }
    } else {
      flatItems.push(item)
    }
  })

  return createPortal(
    <div className="slash-menu" style={{ top: position.top, left: position.left }} ref={ref}>
      {flatItems.length === 0
        ? <div className="slash-menu-empty">No results</div>
        : flatItems.map((item, i) => {
          if (item.isAISub) {
            return (
              <div
                key={`ai-sub-${item.aiMode}`}
                className={`slash-menu-item slash-menu-ai-sub ${i === selectedIndex ? 'selected' : ''}`}
                onMouseDown={e => { e.preventDefault(); onSelect({ isAI: true, aiMode: item.aiMode, promptText: '' }) }}
              >
                <div className="slash-menu-ai-sub-icon"><ClaudeIcon size={11} /></div>
                <div className="slash-menu-text">
                  <div className="slash-menu-title">{item.label}</div>
                  <div className="slash-menu-subtitle">{item.desc}</div>
                </div>
              </div>
            )
          }
          const Icon = item.icon
          const isGroup = (item as any).isAIGroup
          return (
            <div
              key={item.title}
              className={`slash-menu-item ${isGroup ? 'slash-menu-ai-group' : ''} ${i === selectedIndex ? 'selected' : ''}`}
              onMouseDown={e => {
                e.preventDefault()
                if (isGroup) setAiExpanded(v => !v)
                else onSelect(item)
              }}
            >
              <div className={`slash-menu-icon ${isGroup ? 'slash-menu-ai-icon' : ''}`}>
                <Icon size={14} strokeWidth={2} />
              </div>
              <div className="slash-menu-text">
                <div className="slash-menu-title">{item.title}</div>
                <div className="slash-menu-subtitle">{item.subtitle}</div>
              </div>
              {isGroup && (
                <div className={`slash-menu-ai-chevron ${aiExpanded ? 'open' : ''}`}>
                  <ChevronDown size={12} strokeWidth={2} />
                </div>
              )}
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
          items: ({ query }: { query: string }) => {
            const lower = query.toLowerCase()
            if (lower.startsWith('ai ') && query.length > 3) {
              const promptText = query.slice(3).trim()
              return [{ title: `AI: "${promptText}"`, subtitle: 'Ask AI to write this', icon: ClaudeIcon, isAIGroup: false, isAI: true, aiMode: 'write' as const, promptText, command: (_e: any) => {} }]
            }
            return slashItems.filter(i => i.title.toLowerCase().includes(lower))
          },
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
    state.doc.nodesBetween(hoveredPos, hoveredPos + node.nodeSize, (n: any, pos: number) => {
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

function CursorOverlay({ editor, provider }: { editor: any; provider: any }) {
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

    const handleCursorInteraction = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const caret = target.closest('.collaboration-cursor__caret') as HTMLElement | null
      if (!caret) return
      e.preventDefault()
      e.stopPropagation()

      // Only toggle on mousedown so it fires before ProseMirror swallows the event
      if (e.type === 'mousedown') {
        const label = caret.querySelector('.collaboration-cursor__label') as HTMLElement | null
        const userName = label?.textContent?.trim() || ''
        const color = caret.style.borderColor || '#888'
        setFollowing(prev => prev?.name === userName ? null : { name: userName, color })
      }
    }

    document.addEventListener('mousedown', handleCursorInteraction, true)
    document.addEventListener('click', handleCursorInteraction, true)
    return () => {
      document.removeEventListener('mousedown', handleCursorInteraction, true)
      document.removeEventListener('click', handleCursorInteraction, true)
    }
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
      if (el.closest('.collaboration-cursor__caret') || el.closest('.collaboration-cursor__label') || el.closest('.cursor-follow-toast')) return
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
      carets.forEach((caret: HTMLElement) => {
        const label = caret.querySelector('.collaboration-cursor__label') as HTMLElement | null
        if (label?.textContent?.trim() === target.name) caretEl = caret
      })

      const el = caretEl as HTMLElement | null
      if (!el) return
      const container = document.querySelector('.editor-container')
      if (!container) return

      const caretRect = el.getBoundingClientRect()
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

// ── App ──────────────────────────────────────────────────────────────
export default function Document() {
  const { user } = useAuth()
  const currentUser = { name: user?.name ?? '', color: user?.color ?? '#888' }

  const { roomId } = useParams<{ roomId: string }>()
  const navigate = useNavigate()

  const { ydoc, provider, yTitle } = useMemo(() => {
    const ydoc = new Y.Doc()
    const provider = new WebsocketProvider(
      'ws://localhost:1234',
      roomId || 'default',
      ydoc
    )
    const yTitle = ydoc.getText('title')
    return { ydoc, provider, yTitle }
  }, [roomId])

  const [onlineUsers, setOnlineUsers] = useState<AwarenessUser[]>([])
  const [connected, setConnected] = useState(false)
  const [contentReady, setContentReady] = useState(false)
  const [docTitle, setDocTitle] = useState(() => yTitle.toString() || '')
  const [theme, setTheme] = useState<'dark' | 'light' | 'system'>(() => {
    return (localStorage.getItem('cowrite-theme') as 'dark' | 'light' | 'system') || 'system'
  })
  const [resolvedTheme, setResolvedTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('cowrite-theme') as string
    if (saved === 'dark' || saved === 'light') return saved
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const userName = user?.name ?? ''

  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [words, setWords] = useState(0)
  const [inTable, setInTable] = useState(false)

  const defaultPrefs: Required<DocPrefs> = (() => {
    const fallback: Required<DocPrefs> = {
      fullWidth: false,
      spellCheck: false,
      editorFont: 'sans',
      editorSize: 'md',
      editorLineHeight: 'normal',
    }
    try {
      const saved = JSON.parse(localStorage.getItem('cowrite-default-prefs') || '{}')
      return { ...fallback, ...saved }
    } catch {
      return fallback
    }
  })()

  const [fullWidth, setFullWidth] = useState(defaultPrefs.fullWidth)
  const [spellCheck, setSpellCheck] = useState(defaultPrefs.spellCheck)
  const [editorFont, setEditorFont] = useState<'sans' | 'serif' | 'mono'>(defaultPrefs.editorFont)
  const [editorSize, setEditorSize] = useState<'sm' | 'md' | 'lg'>(defaultPrefs.editorSize)
  const [editorLineHeight, setEditorLineHeight] = useState<'compact' | 'normal' | 'spacious'>(defaultPrefs.editorLineHeight)
  const prefsLoadedRef = useRef(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsRef = useRef<HTMLDivElement>(null)

  const [shareOpen, setShareOpen] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)
  const [docOwnerId, setDocOwnerId] = useState<string | null>(null)
  const [allUsers, setAllUsers] = useState<{ id: string; name: string; color: string }[]>([])
  const [docSharedWith, setDocSharedWith] = useState<{ id: string; name: string; color: string }[]>([])
  const [shareSearch, setShareSearch] = useState('')
  const [sharingUserId, setSharingUserId] = useState<string | null>(null)
  const shareRef = useRef<HTMLDivElement>(null)

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

  const [aiStreaming, setAiStreaming] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const aiInsertPosRef = useRef<number>(0)

  useEffect(() => {
    if (!shareOpen) return
    const handler = (e: MouseEvent) => {
      if (shareRef.current && !shareRef.current.contains(e.target as Node)) {
        setShareOpen(false)
        setShareSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [shareOpen])

  useEffect(() => {
    if (!shareOpen || !roomId) return
    Promise.all([
      getAllUsers().then(setAllUsers),
      getDocShares(roomId).then(setDocSharedWith),
      // Re-fetch owner in case the initial load settled before state was set
      createDocumentAPI(roomId).then(doc => {
        if (doc?.owner_id) setDocOwnerId(doc.owner_id)
      }),
    ])
  }, [shareOpen, roomId])

  const handleShare = useCallback(() => {
    navigator.clipboard.writeText(window.location.href)
    setShareCopied(true)
    setTimeout(() => setShareCopied(false), 2000)
  }, [])

  const handleAddShare = useCallback(async (targetUserId: string) => {
    if (!roomId) return
    setSharingUserId(targetUserId)
    await shareDocument(roomId, targetUserId)
    const updated = await getDocShares(roomId)
    setDocSharedWith(updated)
    setSharingUserId(null)
  }, [roomId])

  const handleRemoveShare = useCallback(async (targetUserId: string) => {
    if (!roomId) return
    setSharingUserId(targetUserId)
    await unshareDocument(roomId, targetUserId)
    setDocSharedWith(prev => prev.filter(u => u.id !== targetUserId))
    setSharingUserId(null)
  }, [roomId])

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

  // Load per-document prefs from server; overlays the localStorage defaults
  useEffect(() => {
    if (!roomId) return
    let cancelled = false
    getDocPrefs(roomId).then(prefs => {
      if (cancelled) return
      if (prefs.fullWidth !== undefined) setFullWidth(prefs.fullWidth)
      if (prefs.spellCheck !== undefined) setSpellCheck(prefs.spellCheck)
      if (prefs.editorFont !== undefined) setEditorFont(prefs.editorFont)
      if (prefs.editorSize !== undefined) setEditorSize(prefs.editorSize)
      if (prefs.editorLineHeight !== undefined) setEditorLineHeight(prefs.editorLineHeight)
      prefsLoadedRef.current = true
    })
    return () => { cancelled = true }
  }, [roomId])

  // Persist prefs when any change, debounced; also mirror to localStorage as the default
  useEffect(() => {
    if (!prefsLoadedRef.current || !roomId) return
    const prefs: DocPrefs = { fullWidth, spellCheck, editorFont, editorSize, editorLineHeight }
    const t = setTimeout(() => {
      saveDocPrefs(roomId, prefs)
      localStorage.setItem('cowrite-default-prefs', JSON.stringify(prefs))
    }, 500)
    return () => clearTimeout(t)
  }, [fullWidth, spellCheck, editorFont, editorSize, editorLineHeight, roomId])

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

  const editorRef = useRef<ReturnType<typeof useEditor>>(null)


  const triggerAICommand = useCallback(async (
    promptText: string,
    mode: 'write' | 'continue' | 'summarize' | 'rewrite',
    capturedText?: { fullText: string; cursorOffset: number }
  ) => {
    const ed = editorRef.current
    if (!ed || !roomId || aiStreaming) return
    const insertPos = ed.state.selection.from
    aiInsertPosRef.current = insertPos

    provider.awareness.setLocalStateField('aiPresence', {
      name: 'Claude', color: '#cd6425', isAI: true,
      status: 'active', anchor: insertPos, lastActive: Date.now(),
    })

    // Use pre-captured text (avoids stale read after deleteRange)
    const fullText = capturedText?.fullText ?? ed.getText()
    const cursorOffset = capturedText?.cursorOffset ?? ed.state.doc.textBetween(0, insertPos, '\n').length
    const before = mode === 'summarize'
      ? fullText.slice(0, 8000)
      : fullText.slice(Math.max(0, cursorOffset - 3000), cursorOffset)
    const after = mode === 'summarize'
      ? ''
      : fullText.slice(cursorOffset, cursorOffset + 1000)

    setAiStreaming(true)

    let currentPos = insertPos
    await streamAIContent(
      roomId, promptText, before, after, mode,
      (token) => {
        ed.chain().insertContentAt(currentPos, token).run()
        currentPos = ed.state.selection.from
        provider.awareness.setLocalStateField('aiPresence', {
          name: 'Claude', color: '#cd6425', isAI: true,
          status: 'active', anchor: currentPos, lastActive: Date.now(),
        })
      },
      () => {
        // Post-process: replace raw text with properly formatted paragraphs
        if (currentPos > insertPos) {
          const rawText = ed.state.doc.textBetween(insertPos, currentPos, '\n')
          // Only reformat if there are paragraph breaks
          if (rawText.includes('\n\n')) {
            ed.chain().deleteRange({ from: insertPos, to: currentPos }).run()
            const content = convertTextToContent(rawText)
            ed.chain().insertContentAt(insertPos, content).run()
            currentPos = ed.state.selection.from
          }
          // Apply fade-out highlight over the inserted range
          const decoTr = ed.state.tr.setMeta(aiDecoKey, { from: insertPos, to: currentPos })
          ed.view.dispatch(decoTr)
          // Clear decorations after the CSS fade animation finishes (3s)
          setTimeout(() => {
            if (!ed.isDestroyed) {
              const clearTr = ed.state.tr.setMeta(aiDecoKey, null)
              ed.view.dispatch(clearTr)
            }
          }, 3000)
        }
        setAiStreaming(false)
        provider.awareness.setLocalStateField('aiPresence', null)
      },
      (err) => {
        console.error('AI error:', err)
        setAiError(err.message || 'AI request failed')
        setAiStreaming(false)
        provider.awareness.setLocalStateField('aiPresence', null)
        setTimeout(() => setAiError(null), 5000)
      }
    )
  }, [aiStreaming, roomId, provider])

  const slashExtension = useRef(
    makeSlashExtension(suggestionPropsRef, handleSlashOpenOrUpdate, handleSlashClose)
  ).current

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ history: false, codeBlock: false }),
      Placeholder.configure({ placeholder: "Write something, or type '/' for commands…" }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TaskListExit,
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
      AI_DECO_EXTENSION,
    ],
    onUpdate({ editor }) {
      const text = editor.getText()
      setWords(countWords(text))
    },
    onSelectionUpdate({ editor }) {
      setInTable(editor.isActive('table'))
    },
  })

  // Keep editorRef in sync so triggerAICommand can access editor without dep ordering issues
  useEffect(() => { editorRef.current = editor }, [editor])

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
    // Ensure document exists server-side
    if (roomId) {
      createDocumentAPI(roomId).then(doc => {
        if (doc?.owner_id) setDocOwnerId(doc.owner_id)
      })
    }

    provider.awareness.setLocalStateField('user', currentUser)
    provider.awareness.setLocalStateField('lastActive', Date.now())
    const statusHandler = (event: { status: string }) => setConnected(event.status === 'connected')
    provider.on('status', statusHandler)

    // Kicked when access is revoked — server closes WS with code 4403
    provider.on('connection-close', (event: CloseEvent | null) => {
      if (event?.code === 4403) navigate('/')
    })

    const syncHandler = (isSynced: boolean) => { if (isSynced) setContentReady(true) }
    provider.on('sync', syncHandler)

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
        if (state?.user?.name) {
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
        if (state?.aiPresence) {
          users.push({ ...state.aiPresence, isYou: false })
        }
      })
      setOnlineUsers(users)
    }
    updateUsers()
    provider.awareness.on('change', updateUsers)

    const idleInterval = setInterval(updateUsers, 30_000)

    const updateTitle = () => {
      const remote = yTitle.toString()
      if (remote) {
        setDocTitle(remote)
        setContentReady(true)
      }
    }
    yTitle.observe(updateTitle)

    // Navigate home if the doc is deleted while we're editing
    const disconnectSSE = connectEvents(e => {
      if (e.type === 'doc:deleted' && e.payload.room === roomId) navigate('/')
    })

    return () => {
      disconnectSSE()
      provider.awareness.off('change', updateUsers)
      provider.off('status', statusHandler)
      provider.off('sync', syncHandler)
      document.removeEventListener('keydown', markActive)
      document.removeEventListener('mousemove', markActive)
      yTitle.unobserve(updateTitle)
      clearInterval(idleInterval)
      provider.awareness.setLocalState(null)
      provider.destroy()
      ydoc.destroy()
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
            <button
              className="topbar-menu-btn"
              onClick={() => navigate('/')}
              title="Back to documents"
              style={{ marginRight: 4 }}
            >
              <ArrowLeft size={16} strokeWidth={2} />
            </button>
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

            <div className="share-wrap" ref={shareRef}>
              <button
                className={`topbar-share-btn${shareOpen ? ' active' : ''}`}
                onClick={() => setShareOpen(o => !o)}
                title="Share document"
              >
                <Share2 size={14} strokeWidth={2} />
                Share
              </button>
              {shareOpen && (
                <div className="share-modal">
                  <div className="share-modal-section">
                    <p className="share-modal-heading">Share link</p>
                    <p className="share-modal-sub">Anyone with this link can view and edit</p>
                    <div className="share-link-row">
                      <span className="share-link-url">{window.location.href}</span>
                      <button
                        className={`share-link-copy${shareCopied ? ' copied' : ''}`}
                        onClick={handleShare}
                      >
                        {shareCopied ? <Check size={13} strokeWidth={2.5} /> : <Link size={13} strokeWidth={2} />}
                        {shareCopied ? 'Copied' : 'Copy link'}
                      </button>
                    </div>
                  </div>
                  {docOwnerId === user?.id && (
                    <>
                      <div className="share-modal-divider" />
                      <div className="share-modal-section">
                        <p className="share-modal-heading">Invite collaborators</p>
                        <div className="share-search-wrap">
                          <Search size={13} strokeWidth={2} className="share-search-icon" />
                          <input
                            className="share-search-input"
                            placeholder="Search by name…"
                            value={shareSearch}
                            onChange={e => setShareSearch(e.target.value)}
                            autoFocus
                          />
                        </div>
                        {(() => {
                          const inviteable = allUsers.filter(u =>
                            u.id !== user?.id &&
                            !docSharedWith.some(s => s.id === u.id) &&
                            u.name.toLowerCase().includes(shareSearch.toLowerCase())
                          )
                          return inviteable.length === 0 ? (
                            <p className="share-empty">
                              {shareSearch ? 'No matching users' : allUsers.length <= 1 ? 'No other users yet' : 'All users already have access'}
                            </p>
                          ) : (
                            <div className="share-user-list">
                              {inviteable.map(u => (
                                <div key={u.id} className="share-user-row">
                                  <div className="share-user-avatar" style={{ background: u.color }}>
                                    {u.name[0].toUpperCase()}
                                  </div>
                                  <span className="share-user-name">{u.name}</span>
                                  <button
                                    className="share-action-btn share-action-btn--add"
                                    onClick={() => handleAddShare(u.id)}
                                    disabled={sharingUserId === u.id}
                                  >
                                    {sharingUserId === u.id ? 'Adding…' : 'Add'}
                                  </button>
                                </div>
                              ))}
                            </div>
                          )
                        })()}
                      </div>
                      {docSharedWith.length > 0 && (
                        <>
                          <div className="share-modal-divider" />
                          <div className="share-modal-section">
                            <p className="share-modal-heading">Has access</p>
                            <div className="share-user-list">
                              {docSharedWith.map(u => (
                                <div key={u.id} className="share-user-row">
                                  <div className="share-user-avatar" style={{ background: u.color }}>
                                    {u.name[0].toUpperCase()}
                                  </div>
                                  <span className="share-user-name">{u.name}</span>
                                  <button
                                    className="share-action-btn share-action-btn--remove"
                                    onClick={() => handleRemoveShare(u.id)}
                                    disabled={sharingUserId === u.id}
                                  >
                                    {sharingUserId === u.id ? 'Removing…' : 'Remove'}
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        </>
                      )}
                    </>
                  )}
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
              placeholder={contentReady ? 'Untitled' : ''}
              spellCheck={spellCheck}
            />
            {contentReady ? (
              <EditorContent editor={editor} spellCheck={spellCheck} />
            ) : (
              <div className="editor-skeleton" aria-hidden>
                <div className="editor-skeleton-line wide" />
                <div className="editor-skeleton-line medium" />
                <div className="editor-skeleton-line wide" />
                <div className="editor-skeleton-line narrow" />
                <div className="editor-skeleton-line wide" />
                <div className="editor-skeleton-line medium" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Slash menu */}
      {slashOpen && (
        <SlashAlignJustify
          items={slashItems_}
          selectedIndex={slashIdx}
          position={slashPos}
          onSelect={(item: any) => {
            if (item.isAI) {
              // Capture text BEFORE deleteRange so we don't get a stale/empty read
              const fullText = editor?.getText() ?? ''
              const cursorPos = editor ? editor.state.doc.textBetween(0, editor.state.selection.from, '\n').length : 0
              const range = suggestionPropsRef.current?.range
              if (range) editor?.chain().focus().deleteRange(range).run()
              setSlashOpen(false)
              triggerAICommand(item.promptText || '', item.aiMode || 'write', { fullText, cursorOffset: cursorPos })
            } else {
              suggestionPropsRef.current?.command(item)
              setSlashOpen(false)
            }
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
      {editor && <CursorOverlay editor={editor} provider={provider} />}

      {/* AI error toast */}
      {aiError && (
        <div className="ai-error-toast" onClick={() => setAiError(null)}>
          AI Error: {aiError}
        </div>
      )}

    </div>
  )
}
