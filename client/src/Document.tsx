import { useEditor, EditorContent, Extension, NodeViewWrapper, NodeViewContent, ReactNodeViewRenderer } from '@tiptap/react'
import { Paragraph } from '@tiptap/extension-paragraph'
import { Heading } from '@tiptap/extension-heading'
import { Blockquote } from '@tiptap/extension-blockquote'
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
import { useState, useEffect, useRef, useCallback, useMemo, type ComponentType } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { createDocument as createDocumentAPI, getAllUsers, getDocShares, shareDocument, unshareDocument, streamAIContent, getDocPrefs, saveDocPrefs, connectEvents, getJobResult, getDocumentJobs, submitAgentJob, patchJobDecision, fetchAgentStats, type DocPrefs } from './api'
import { createPortal, flushSync } from 'react-dom'
import { marked } from 'marked'
import {
  Heading1, Heading2, Heading3, List, ListOrdered,
  ListTodo, Quote, Code, Code2, Minus, Table2,
  Settings,
  AlignLeft, CalendarDays, Clock,
  Bold, Italic, Strikethrough,
  Copy, Check, ChevronDown,
  GripVertical, Trash2, CopyPlus, Plus,
  ArrowLeft, ArrowUp, Share2, Link, Search, Sparkles, X, Gauge, MessageCircle, LoaderCircle,
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
  decos.push(Decoration.widget(from, () => {
    const marker = document.createElement('span')
    marker.className = 'ai-highlight-start-marker'
    marker.setAttribute('contenteditable', 'false')
    marker.setAttribute('aria-hidden', 'true')
    return marker
  }, { side: -1 }))
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

// ── Selection-lock highlight: visualizes the selection while a focus-stealing
// UI (Ask AI composer) is open so the user can still see what they targeted.
const selLockKey = new PluginKey<DecorationSet>('selLock')

function makeSelLockPlugin() {
  return new Plugin({
    key: selLockKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        const meta = tr.getMeta(selLockKey)
        if (meta === null) return DecorationSet.empty
        if (meta) {
          const from = Math.max(0, Math.min(meta.from, tr.doc.content.size))
          const to = Math.max(0, Math.min(meta.to, tr.doc.content.size))
          if (from >= to) return DecorationSet.empty
          return DecorationSet.create(tr.doc, [
            Decoration.inline(from, to, { class: 'ai-sel-lock' }),
          ])
        }
        return set.map(tr.mapping, tr.doc)
      },
    },
    props: {
      decorations(state) { return selLockKey.getState(state) },
    },
  })
}

const AI_DECO_EXTENSION = Extension.create({
  name: 'aiDecorations',
  addProseMirrorPlugins() { return [makeAIDecoPlugin(), makeSelLockPlugin()] },
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

const ParagraphWithId = Paragraph.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      blockId: {
        default: null,
        parseHTML: element => element.getAttribute('data-block-id'),
        renderHTML: attributes => {
          if (!attributes.blockId) return {}
          return { 'data-block-id': attributes.blockId }
        }
      }
    }
  }
})

const HeadingWithId = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      blockId: {
        default: null,
        parseHTML: element => element.getAttribute('data-block-id'),
        renderHTML: attributes => {
          if (!attributes.blockId) return {}
          return { 'data-block-id': attributes.blockId }
        }
      }
    }
  }
})

const BlockquoteWithId = Blockquote.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      blockId: {
        default: null,
        parseHTML: element => element.getAttribute('data-block-id'),
        renderHTML: attributes => {
          if (!attributes.blockId) return {}
          return { 'data-block-id': attributes.blockId }
        }
      }
    }
  }
})

const TaskItemWithId = TaskItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      blockId: {
        default: null,
        parseHTML: element => element.getAttribute('data-block-id'),
        renderHTML: attributes => {
          if (!attributes.blockId) return {}
          return { 'data-block-id': attributes.blockId }
        }
      }
    }
  }
}).configure({ nested: true })

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
const slashItems = [
  { title: 'AI: Write', subtitle: 'Ask AI to write something', icon: ClaudeIcon, isAI: true, aiMode: 'write' as const, needsPrompt: true, command: (_e: any) => { } },
  { title: 'AI: Continue', subtitle: 'Continue writing from cursor', icon: ClaudeIcon, isAI: true, aiMode: 'continue' as const, needsPrompt: false, command: (_e: any) => { } },
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

  useEffect(() => {
    const el = ref.current?.querySelector('.selected')
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const aiItems = items.filter((item: any) => item.isAI)
  const otherItems = items.filter((item: any) => !item.isAI)

  return createPortal(
    <div className="slash-menu" style={{ top: position.top, left: position.left }} ref={ref}>
      {items.length === 0
        ? <div className="slash-menu-empty">No results</div>
        : (() => {
          const allItems = aiItems.length > 0 && otherItems.length > 0
            ? [...aiItems, null, ...otherItems]
            : items
          let visualIndex = 0
          return allItems.map((item) => {
            if (item === null) {
              return <div key="ai-divider" className="slash-menu-ai-divider" />
            }
            const i = visualIndex++
            const Icon = (item as any).icon
            const isAI = (item as any).isAI
            return (
              <div
                key={(item as any).title}
                className={`slash-menu-item ${isAI ? 'slash-menu-ai-item' : ''} ${i === selectedIndex ? 'selected' : ''}`}
                onMouseDown={e => { e.preventDefault(); onSelect(item) }}
              >
                <div className={`slash-menu-icon ${isAI ? 'slash-menu-ai-icon' : ''}`}>
                  <Icon size={14} strokeWidth={2} />
                </div>
                <div className="slash-menu-text">
                  <div className="slash-menu-title">{(item as any).title}</div>
                  <div className="slash-menu-subtitle">{(item as any).subtitle}</div>
                </div>
              </div>
            )
          })
        })()
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
  getHasSelection: () => boolean,
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
            const hasSelection = getHasSelection()
            const rewriteItem = hasSelection
              ? [{ title: 'AI: Rewrite selection', subtitle: 'Rewrite selected text with AI', icon: ClaudeIcon, isAI: true, aiMode: 'rewrite' as const, needsPrompt: true, isRewrite: true, command: (_e: any) => { } }]
              : []
            const base = [...rewriteItem, ...slashItems]
            return base.filter(i => i.title.toLowerCase().includes(lower))
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
function countCharacters(text: string) {
  return text.length
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
function FloatingToolbar({ editor, onAIEdit }: {
  editor: any
  onAIEdit?: (selectedText: string, from: number, to: number, pos: { top: number; left: number }, promptText: string) => void
}) {
  const [toolbarPos, setToolbarPos] = useState<{ top: number; left: number; selTop: number; selLeft: number } | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  // Snapshot of selection at the moment Ask AI is clicked — stays stable while textarea is focused
  const selSnap = useRef<{ from: number; to: number; selectedText: string } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Ref mirror of aiOpen — always current inside the selectionUpdate closure
  const aiOpenRef = useRef(false)

  // Auto-resize textarea: starts at single line, grows up to 120px
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(Math.max(el.scrollHeight, 24), 120) + 'px'
  }, [aiPrompt])

  // Keep aiOpenRef in sync with aiOpen state
  useEffect(() => { aiOpenRef.current = aiOpen }, [aiOpen])

  useEffect(() => {
    const update = () => {
      if (!editor || editor.state.selection.empty) {
        // Don't hide if AI panel is open — we've locked the selection snapshot
        if (!aiOpenRef.current) setToolbarPos(null)
        return
      }
      const { from, to } = editor.state.selection
      const fromCoords = editor.view.coordsAtPos(from)
      const toCoords = editor.view.coordsAtPos(to)
      const rawTop = Math.min(fromCoords.top, toCoords.top) - 52
      const rawLeft = (fromCoords.left + toCoords.left) / 2 - 140
      setToolbarPos({
        top: Math.max(8, rawTop),
        left: Math.max(8, Math.min(rawLeft, window.innerWidth - 320)),
        selTop: Math.min(fromCoords.top, toCoords.top),
        selLeft: fromCoords.left,
      })
    }
    editor.on('selectionUpdate', update)
    editor.on('transaction', update)
    return () => {
      editor.off('selectionUpdate', update)
      editor.off('transaction', update)
    }
  }, [editor])

  if (!toolbarPos) return null

  const handleAskAIClick = (e: React.MouseEvent) => {
    e.preventDefault()
    if (aiOpen) {
      setAiOpen(false)
      setAiPrompt('')
      selSnap.current = null
      // clear the visual selection lock
      const tr = editor.state.tr.setMeta(selLockKey, null)
      editor.view.dispatch(tr)
      return
    }
    // Snapshot current selection before textarea steals focus
    const { from, to } = editor.state.selection
    selSnap.current = {
      from,
      to,
      selectedText: editor.state.doc.textBetween(from, to, '\n'),
    }
    // Apply the selection-lock decoration so the highlight stays visible
    // even after the editor loses focus to the prompt textarea.
    const tr = editor.state.tr.setMeta(selLockKey, { from, to })
    editor.view.dispatch(tr)
    setAiOpen(true)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  const handleAISubmit = () => {
    const snap = selSnap.current
    if (!aiPrompt.trim() || !onAIEdit || !snap) return
    const prompt = aiPrompt.trim()
    // Compute bar position: just above the selection top
    const barPos = { top: toolbarPos.selTop - 44, left: toolbarPos.selLeft }
    // Flush synchronously so the toolbar DOM is gone before the AI stream starts
    flushSync(() => {
      setToolbarPos(null)
      setAiOpen(false)
      setAiPrompt('')
    })
    selSnap.current = null
    onAIEdit(snap.selectedText, snap.from, snap.to, barPos, prompt)
  }

  return createPortal(
    // e.preventDefault() on the entire portal prevents any mouse interaction from
    // blurring the editor or collapsing the selection
    <div
      className={`floating-toolbar-card${aiOpen ? ' ai-open' : ''}`}
      style={{ top: toolbarPos.top, left: toolbarPos.left }}
      onMouseDown={e => e.preventDefault()}
    >
      {/* Pill row */}
      <div className="floating-toolbar-row">
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
        {onAIEdit && (
          <>
            <div className="floating-toolbar-divider" />
            <button
              className={`floating-toolbar-ask-ai${aiOpen ? ' active' : ''}`}
              onMouseDown={handleAskAIClick}
              type="button"
            >
              Ask AI
            </button>
          </>
        )}
      </div>

      {/* AI composer — expands below pill row, visually attached */}
      {aiOpen && (
        <div className="floating-toolbar-ai-composer">
          <div className="floating-toolbar-ai-input-shell">
            <textarea
              ref={textareaRef}
              className="floating-toolbar-ai-textarea"
              placeholder="Ask AI to edit this selection…"
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAISubmit() }
                if (e.key === 'Escape') {
                  setAiOpen(false); setAiPrompt(''); selSnap.current = null
                  const tr = editor.state.tr.setMeta(selLockKey, null)
                  editor.view.dispatch(tr)
                }
              }}
              rows={1}
            />
            <button
              className="floating-toolbar-ai-send"
              onMouseDown={e => { e.preventDefault(); handleAISubmit() }}
              disabled={!aiPrompt.trim()}
              type="button"
            >
              <ArrowUp size={13} strokeWidth={2.5} />
            </button>
          </div>
        </div>
      )}
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

// ── AIEditBar — slim bar anchored above the selection, streaming + done states ──
const AI_STATUS_CYCLE = ['Computing…', 'Writing…', 'Finishing…']

interface AIEditBoxProps {
  phase: 'prompt' | 'streaming' | 'done'
  position: { top: number; left: number }
  onSubmit: (promptText: string) => void
  onUndo: () => void
  onInsert: () => void
  onChatMore: () => void
  onCancel: () => void
}

function AIEditBox({ phase, position, onUndo, onInsert, onChatMore, onCancel }: AIEditBoxProps) {
  const [statusIdx, setStatusIdx] = useState(0)

  useEffect(() => {
    if (phase !== 'streaming') { setStatusIdx(0); return }
    const interval = setInterval(() => {
      setStatusIdx(i => (i + 1) % AI_STATUS_CYCLE.length)
    }, 900)
    return () => clearInterval(interval)
  }, [phase])

  // Only show for streaming / done — prompt phase is now handled inside FloatingToolbar
  if (phase === 'prompt') return null

  return createPortal(
    <div
      className={`ai-result-bar ai-result-bar--${phase}`}
      style={{ top: position.top, left: position.left }}
      onMouseDown={e => e.stopPropagation()}
    >
      {phase === 'streaming' && (
        <>
          <span className="ai-result-bar-spinner" />
          <span className="ai-result-bar-label">{AI_STATUS_CYCLE[statusIdx]}</span>
          <button className="ai-result-bar-cancel" onMouseDown={e => { e.preventDefault(); onCancel() }} type="button" title="Cancel">
            <X size={11} strokeWidth={2.5} />
          </button>
        </>
      )}
      {phase === 'done' && (
        <>
          <span className="ai-result-bar-done-label">Done</span>
          <div className="ai-result-bar-sep" />
          <button className="ai-result-bar-action" onMouseDown={e => { e.preventDefault(); onUndo() }} type="button">Undo</button>
          <div className="ai-result-bar-sep" />
          <button className="ai-result-bar-action" onMouseDown={e => { e.preventDefault(); onInsert() }} type="button">Keep &amp; insert</button>
          <button className="ai-result-bar-action ai-result-bar-action--primary" onMouseDown={e => { e.preventDefault(); onChatMore() }} type="button">Chat more</button>
        </>
      )}
    </div>,
    document.body
  )
}

// ── Agent Panel ──────────────────────────────────────────────────────


type PanelMode = 'hidden' | 'side' | 'full'

type AgentTaskMode = 'auto' | 'review' | 'expand' | 'proofread' | 'summarize'
type AgentEffortMode = 'auto' | 'low' | 'balanced' | 'high' | 'extra-high'

interface DropdownOption<T extends string> {
  value: T
  label: string
  description: string
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>
  modeColor?: string
}

const PANEL_TASK_OPTIONS: Array<DropdownOption<AgentTaskMode>> = [
  { value: 'auto', label: 'Auto', description: 'Infer the job from the instruction.', icon: Sparkles, modeColor: 'var(--agent-mode-auto-text)' },
  { value: 'review', label: 'Review', description: 'Find clarity, logic, and structure issues.', icon: Sparkles, modeColor: 'var(--agent-mode-review-text)' },
  { value: 'expand', label: 'Expand', description: 'Add depth, examples, or explanation.', icon: Sparkles, modeColor: 'var(--agent-mode-expand-text)' },
  { value: 'proofread', label: 'Proofread', description: 'Catch grammar and punctuation issues.', icon: Sparkles, modeColor: 'var(--agent-mode-proofread-text)' },
  { value: 'summarize', label: 'Summarize', description: 'Create a concise standalone summary.', icon: Sparkles, modeColor: 'var(--agent-mode-summarize-text)' },
]

const PANEL_EFFORT_OPTIONS: Array<DropdownOption<AgentEffortMode>> = [
  { value: 'auto', label: 'Auto', description: 'Route model choice from the request.', icon: Gauge },
  { value: 'low', label: 'Low', description: 'Prefer speed over depth.', icon: Gauge },
  { value: 'balanced', label: 'Balanced', description: 'Default quality and speed tradeoff.', icon: Gauge },
  { value: 'high', label: 'High', description: 'Spend more effort on harder prompts.', icon: Gauge },
  { value: 'extra-high', label: 'Extra High', description: 'Use the deepest pass for demanding work.', icon: Gauge },
]

function PanelInlineDropdown<T extends string>({
  label, value, options, open, onToggle, onSelect,
}: {
  label: string
  value: T
  options: Array<DropdownOption<T>>
  open: boolean
  onToggle: () => void
  onSelect: (v: T) => void
}) {
  const selected = options.find(o => o.value === value) ?? options[0]
  const Icon = selected.icon
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
        <Icon size={14} strokeWidth={2} className="agent-dropdown-trigger-icon" />
        <span>{selected.label}</span>
        <ChevronDown size={14} strokeWidth={2.2} className="agent-dropdown-trigger-chevron" />
      </button>
      {open && (
        <div className="agent-dropdown-menu agent-dropdown-menu--up" role="menu">
          {options.map(opt => (
            <button
              key={opt.value}
              className={`agent-dropdown-item${opt.value === value ? ' selected' : ''}`}
              role="menuitem"
              onClick={() => { onSelect(opt.value); onToggle() }}
            >
              {opt.modeColor && (
                <span className="agent-dropdown-item-swatch" style={{ background: opt.modeColor }} />
              )}
              <div className="agent-dropdown-item-text">
                <span className="agent-dropdown-item-label">{opt.label}</span>
                <span className="agent-dropdown-item-desc">{opt.description}</span>
              </div>
              {opt.value === value && <Check size={13} strokeWidth={2.5} className="agent-dropdown-item-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface AgentTurn {
  role: 'user' | 'agent'
  task?: string
  displayTask?: string
  mode?: string
  effort?: string
  timestamp: number
  jobId?: string
  state?: string
  result?: string | null
  result_kind?: string
  proposal_json?: string | null
  op_count?: number
  decision?: 'applied' | 'dismissed'
  error?: string | null
  contextText?: string
  contextLabel?: string
}

interface AgentPanelProps {
  roomId: string
  editor: ReturnType<typeof useEditor>
  panelMode: PanelMode
  onPanelModeChange: (m: PanelMode) => void
  onUnseenChange: (n: number) => void
  onApplyProposal: (jobId: string, proposal: any[]) => void
  incomingJob: { job_id: string; type: 'complete' | 'failed'; error?: string } | null
  onIncomingJobConsumed: () => void
  initialContext: {
    prompt: string
    selectedText: string
    aiResult: string
    selectionFrom: number
    selectionTo: number
    resultFrom: number
    resultTo: number
  } | null
  onInitialContextConsumed: () => void
}

function AgentPanel({
  roomId, editor, panelMode, onPanelModeChange, onUnseenChange,
  onApplyProposal,
  incomingJob, onIncomingJobConsumed,
  initialContext, onInitialContextConsumed,
}: AgentPanelProps) {
  const [turns, setTurns] = useState<AgentTurn[]>([])
  const [seenTurnIds, setSeenTurnIds] = useState<Set<string>>(new Set())
  const [composerPrompt, setComposerPrompt] = useState('')
  const [composerMode, setComposerMode] = useState<AgentTaskMode>('auto')
  const [composerEffort, setComposerEffort] = useState<AgentEffortMode>('auto')
  const [openDropdown, setOpenDropdown] = useState<'mode' | 'effort' | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [panelError, setPanelError] = useState<string | null>(null)
  const [confirmReplaceJobId, setConfirmReplaceJobId] = useState<string | null>(null)
  const [copiedJobId, setCopiedJobId] = useState<string | null>(null)
  const [expandedDiffs, setExpandedDiffs] = useState<Set<string>>(new Set())
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    })
  }, [])

  const [expandedContextIds, setExpandedContextIds] = useState<Set<number>>(new Set())

  // Context card attached to the composer — populated by "Chat more →".
  // Sits above the textarea until the user dismisses it or sends a message.
  const [pendingContext, setPendingContext] = useState<{
    prompt: string
    selectedText: string
    aiResult: string
    selectionFrom: number
    selectionTo: number
    resultFrom: number
    resultTo: number
  } | null>(null)
  const [pendingContextVisible, setPendingContextVisible] = useState(false)
  const pendingContextHighlightsOwned = useRef(false)

  // When initialContext arrives, surface it as a draft card on the composer
  // (do NOT auto-submit) and focus the textarea so the user can type.
  useEffect(() => {
    if (!initialContext) return
    setPendingContext(initialContext)
    setPendingContextVisible(false)
    pendingContextHighlightsOwned.current = false
    onInitialContextConsumed()
    setTimeout(() => textareaRef.current?.focus(), 0)
  }, [initialContext])

  // Keep stable refs to avoid stale closures in the visibility effect
  const pendingContextRef = useRef(pendingContext)
  useEffect(() => { pendingContextRef.current = pendingContext }, [pendingContext])
  const editorRef2 = useRef(editor)
  useEffect(() => { editorRef2.current = editor }, [editor])

  const clearPendingContextHighlights = useCallback(() => {
    const ed = editorRef2.current
    if (!ed) return
    const tr = ed.state.tr
      .setMeta(selLockKey, null)
      .setMeta(aiDecoKey, null)
    ed.view.dispatch(tr)
  }, [])

  const showPendingContextHighlights = useCallback(() => {
    const ed = editorRef2.current
    const ctx = pendingContextRef.current
    if (!ed || !ctx) return
    const tr = ed.state.tr
      .setMeta(selLockKey, { from: ctx.selectionFrom, to: ctx.selectionTo })
      .setMeta(aiDecoKey, { from: ctx.resultFrom, to: ctx.resultTo })
    ed.view.dispatch(tr)
    pendingContextHighlightsOwned.current = true
  }, [])

  useEffect(() => {
    if (pendingContextVisible && pendingContextRef.current) {
      showPendingContextHighlights()
      return
    }
    if (pendingContextHighlightsOwned.current) {
      clearPendingContextHighlights()
      pendingContextHighlightsOwned.current = false
    }
  }, [pendingContextVisible, showPendingContextHighlights, clearPendingContextHighlights])

  useEffect(() => () => {
    if (pendingContextHighlightsOwned.current) {
      clearPendingContextHighlights()
      pendingContextHighlightsOwned.current = false
    }
  }, [clearPendingContextHighlights])

  // Load history on mount — build turns from completed jobs
  useEffect(() => {
    getDocumentJobs(roomId).then(jobs => {
      const sorted = [...jobs].sort((a, b) => a.created_at - b.created_at)
      const newTurns: AgentTurn[] = []
      for (const job of sorted) {
        newTurns.push({ role: 'user', task: job.task, mode: job.mode, effort: job.model_used, timestamp: job.created_at, jobId: job.id })
        newTurns.push({ role: 'agent', jobId: job.id, state: job.current_state, result: job.result, result_kind: job.result_kind ?? undefined, proposal_json: job.proposal_json, decision: job.decision ?? undefined, error: job.error_msg, timestamp: job.created_at + 1, mode: job.mode })
      }
      setTurns(newTurns)
      scrollToBottom()
    })
  }, [roomId])

  // Track unseen agent turns
  useEffect(() => {
    const unseen = turns.filter(t => t.role === 'agent' && t.jobId && !seenTurnIds.has(t.jobId) && (t.state === 'done' || t.state === 'failed')).length
    onUnseenChange(unseen)
  }, [turns, seenTurnIds])

  // Mark all as seen when panel opens
  useEffect(() => {
    if (panelMode !== 'hidden') {
      setSeenTurnIds(prev => {
        const next = new Set(prev)
        turns.forEach(t => { if (t.jobId) next.add(t.jobId) })
        return next
      })
    }
  }, [panelMode])

  // React to incoming SSE job events relayed from parent
  useEffect(() => {
    if (!incomingJob) return
    onIncomingJobConsumed()
    if (incomingJob.type === 'complete') {
      getJobResult(incomingJob.job_id).then(job => {
        setTurns(prev => {
          // update existing pending agent turn for this job, or append
          const idx = prev.findIndex(t => t.role === 'agent' && t.jobId === job.id)
          if (idx !== -1) {
            const next = [...prev]
            next[idx] = { ...next[idx], state: job.current_state, result: job.result, result_kind: job.result_kind ?? undefined, proposal_json: job.proposal_json, decision: job.decision ?? undefined, error: job.error_msg }
            return next
          }
          return [...prev,
          { role: 'user', task: job.task, mode: job.mode, timestamp: job.created_at, jobId: job.id },
          { role: 'agent', jobId: job.id, state: job.current_state, result: job.result, result_kind: job.result_kind ?? undefined, proposal_json: job.proposal_json, decision: job.decision ?? undefined, error: job.error_msg, timestamp: job.created_at + 1, mode: job.mode },
          ]
        })
        setSubmitting(false)
        if (job.result_kind === 'json') {
          setExpandedDiffs(prev => { const next = new Set(prev); next.add(job.id); return next })
        }
        onPanelModeChange('side')
        scrollToBottom()
      }).catch(() => {
        setSubmitting(false)
        setPanelError('Failed to fetch job result.')
      })
    } else {
      setTurns(prev => {
        const idx = prev.findIndex(t => t.role === 'agent' && t.jobId === incomingJob.job_id)
        if (idx !== -1) {
          const next = [...prev]
          next[idx] = { ...next[idx], state: 'failed', error: incomingJob.error ?? 'Agent job failed.' }
          return next
        }
        return prev
      })
      setSubmitting(false)
      scrollToBottom()
    }
  }, [incomingJob])

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }, [composerPrompt])

  const handleSubmit = async () => {
    const userPrompt = composerPrompt.trim()
    if (!userPrompt || submitting) return
    const ctx = pendingContext
    // When a context card is attached, prepend a structured context block so
    // the agent has the original selection + previous AI result.
    const task = ctx
      ? `<context>\n  <selected_text>${ctx.selectedText}</selected_text>\n  <previous_ai_result>${ctx.aiResult}</previous_ai_result>\n  <previous_instruction>${ctx.prompt}</previous_instruction>\n</context>\n\n${userPrompt}`
      : userPrompt
    setComposerPrompt('')
    setPendingContext(null)
    setPendingContextVisible(false)
    setSubmitting(true)
    const now = Date.now()
    const tempId = `pending-${now}`
    setTurns(prev => [
      ...prev,
      {
        role: 'user', task, displayTask: userPrompt, mode: composerMode, effort: composerEffort, timestamp: now, jobId: tempId,
        contextText: ctx?.selectedText, contextLabel: ctx?.prompt,
      },
      { role: 'agent', jobId: tempId, state: 'pending', result: null, error: null, timestamp: now + 1, mode: composerMode },
    ])
    scrollToBottom()
    try {
      const { job_id } = await submitAgentJob({ room: roomId, task, mode: composerMode, effort: composerEffort })
      setTurns(prev => prev.map(t => t.jobId === tempId ? { ...t, jobId: job_id } : t))
    } catch {
      setTurns(prev => prev.map(t =>
        t.jobId === tempId && t.role === 'agent' ? { ...t, state: 'failed', error: 'Failed to submit job.' } : t
      ))
      setSubmitting(false)
    }
  }

  const handleInsertAtEnd = (result: string) => {
    if (!editor) return
    const endPos = editor.state.doc.content.size
    const paragraphs = result.split(/\n{2,}/).filter(p => p.trim())
    const content = paragraphs.map(p => {
      const lines = p.split('\n')
      const nodes: any[] = []
      lines.forEach((line, i) => {
        if (line) nodes.push({ type: 'text', text: line })
        if (i < lines.length - 1) nodes.push({ type: 'hardBreak' })
      })
      return { type: 'paragraph', content: nodes }
    })
    editor.chain().focus().insertContentAt(endPos, content).run()
  }

  const handleReplaceDocument = (result: string) => {
    if (!editor) return
    editor.commands.setContent(result)
    setConfirmReplaceJobId(null)
  }

  const handleCopy = (result: string, jobId: string) => {
    navigator.clipboard.writeText(result).then(() => {
      setCopiedJobId(jobId)
      setTimeout(() => setCopiedJobId(null), 1800)
    })
  }

  const hasRunning = turns.some(t => t.role === 'agent' && (t.state === 'pending' || t.state === 'running'))

  return (
    <>
      <div className={`agent-panel agent-panel--${panelMode}`} aria-hidden={panelMode === 'hidden'}>
        {/* Header */}
        <div className="agent-panel-header">
          <div className="agent-panel-header-left">
            <span className="agent-panel-header-title">CoWrite Agent</span>
          </div>
          <div className="agent-panel-header-right">
            <button
              className="agent-panel-icon-btn"
              onClick={() => onPanelModeChange(panelMode === 'full' ? 'side' : 'full')}
              title={panelMode === 'full' ? 'Collapse' : 'Expand'}
            >
              {panelMode === 'full' ? (
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" /></svg>
              ) : (
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
              )}
            </button>
            <button
              className="agent-panel-icon-btn"
              onClick={() => onPanelModeChange('hidden')}
              title="Close"
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* Thread body */}
        <div className="agent-panel-body" ref={bodyRef}>
          {turns.length === 0 && (
            <div className="agent-panel-empty">
              Ask the agent to write, edit, summarize, or review this document.
            </div>
          )}
          {turns.map((turn, i) => {
            if (turn.role === 'user') {
              const isExpanded = expandedContextIds.has(i)
              return (
                <div key={i} className="agent-turn agent-turn--user">
                  {turn.contextText && (
                    <button
                      className={`agent-turn-context-pill${isExpanded ? ' expanded' : ''}`}
                      onClick={() => setExpandedContextIds(prev => {
                        const next = new Set(prev)
                        isExpanded ? next.delete(i) : next.add(i)
                        return next
                      })}
                      type="button"
                    >
                      <span className="agent-turn-context-copy">
                        <span className="agent-turn-context-title">Inline edit context</span>
                        {turn.contextLabel && (
                          <span className="agent-turn-context-subtitle">{turn.contextLabel}</span>
                        )}
                      </span>
                      <span className="agent-turn-context-toggle">
                        {isExpanded ? 'Hide context' : 'Show context'}
                        <ChevronDown size={11} strokeWidth={2.5} className="agent-turn-context-chevron" />
                      </span>
                      {isExpanded && (
                        <span className="agent-turn-context-body">
                          <span className="agent-turn-context-body-label">Selection</span>
                          <span className="agent-turn-context-body-text">{turn.contextText}</span>
                        </span>
                      )}
                    </button>
                  )}
                  <div className="agent-turn-bubble">
                    <span className="agent-turn-task">{turn.displayTask ?? turn.task}</span>
                    <div className="agent-turn-meta">
                      <span
                        className={`agent-turn-mode-bar agent-turn-mode-bar--${turn.mode ?? 'auto'}`}
                        title={(turn.mode ?? 'auto').charAt(0).toUpperCase() + (turn.mode ?? 'auto').slice(1)}
                      />
                    </div>
                  </div>
                </div>
              )
            }
            // agent turn
            const isThinking = turn.state === 'pending' || turn.state === 'running'
            const isFailed = turn.state === 'failed'
            const isDone = turn.state === 'done'
            const result = turn.result ?? ''
            const htmlResult = isDone ? marked(result) as string : ''
            const isConfirmingReplace = confirmReplaceJobId === turn.jobId
            return (
              <div key={i} className="agent-turn agent-turn--agent">
                {isThinking && (
                  <div className="agent-typing-indicator">
                    <span /><span /><span />
                  </div>
                )}
                {isFailed && (
                  <div className="agent-turn-error">
                    {turn.error || 'Agent job failed.'}
                  </div>
                )}
                {isDone && turn.result_kind === 'json' ? (
                  (() => {
                    const isStale = Date.now() - turn.timestamp > 10 * 60 * 1000
                    const decided = !!turn.decision
                    let ops: any[] = []
                    try { ops = JSON.parse(turn.proposal_json ?? '[]') } catch {}
                    const opCount = ops.length
                    const diffExpanded = expandedDiffs.has(turn.jobId!)
                    const toggleDiff = () => setExpandedDiffs(prev => {
                      const next = new Set(prev)
                      next.has(turn.jobId!) ? next.delete(turn.jobId!) : next.add(turn.jobId!)
                      return next
                    })
                    if (opCount === 0) return (
                      <div className="agent-proposal-empty">
                        No changes suggested, the document looks good.
                      </div>
                    )
                    return (
                      <div className="agent-proposal-card">
                        <div className="agent-proposal-header">
                          <span className="agent-proposal-label">
                            {turn.decision === 'applied' ? 'Applied changes' : 'Suggested changes'}
                          </span>
                          <button className="agent-proposal-toggle" onClick={toggleDiff}>
                            {diffExpanded ? 'Hide' : 'Show'}
                            <ChevronDown size={10} strokeWidth={2.5} className={`agent-proposal-toggle-chevron${diffExpanded ? ' agent-proposal-toggle-chevron--open' : ''}`} />
                          </button>
                        </div>
                        {diffExpanded && ops.length > 0 && (
                          <ul className="agent-proposal-diff-list">
                            {ops.map((op: any, idx: number) => (
                              <li key={idx} className="agent-proposal-diff-item">
                                <div className="agent-proposal-diff-reason-row">
                                  <span className="agent-proposal-diff-reason">{op.reason ?? (op.op === 'replace_text' ? 'Edit' : 'Insert')}</span>
                                  {turn.decision === 'applied' && <span className="agent-proposal-state agent-proposal-state--applied">Applied</span>}
                                  {isStale && !decided && <span className="agent-proposal-state agent-proposal-state--stale" title="This suggestion may no longer match the current document.">Stale</span>}
                                </div>
                                {op.op === 'replace_text' ? (
                                  <div className="agent-proposal-diff-body">
                                    <div className="agent-proposal-diff-row agent-proposal-diff-row--old">
                                      <span className="agent-proposal-diff-gutter">−</span>
                                      <span className="agent-proposal-diff-text">{op.oldText}</span>
                                    </div>
                                    <div className="agent-proposal-diff-row agent-proposal-diff-row--new">
                                      <span className="agent-proposal-diff-gutter">+</span>
                                      <span className="agent-proposal-diff-text">{op.newText}</span>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="agent-proposal-diff-body">
                                    <div className="agent-proposal-diff-row agent-proposal-diff-row--new">
                                      <span className="agent-proposal-diff-gutter">+</span>
                                      <span className="agent-proposal-diff-text">{op.text}</span>
                                    </div>
                                  </div>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                        {!decided && (
                          <div className="agent-turn-actions">
                            <button
                              className="agent-turn-action-btn agent-turn-action-btn--primary"
                              onClick={() => {
                                try {
                                  onApplyProposal(turn.jobId!, ops)
                                  setTurns(prev => prev.map(t => t.jobId === turn.jobId ? { ...t, decision: 'applied' } : t))
                                  patchJobDecision(turn.jobId!, 'applied')
                                } catch {}
                              }}
                            >
                              Apply changes
                            </button>
                            <button
                              className="agent-turn-action-btn"
                              onClick={() => {
                                setTurns(prev => prev.map(t => t.jobId === turn.jobId ? { ...t, decision: 'dismissed' } : t))
                                patchJobDecision(turn.jobId!, 'dismissed')
                              }}
                            >
                              Dismiss
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })()
                ) : isDone && (
                  <>
                    <div
                      className="agent-result-prose"
                      dangerouslySetInnerHTML={{ __html: htmlResult }}
                    />
                    <div className="agent-turn-actions">
                      <button
                        className="agent-turn-action-btn"
                        onClick={() => handleCopy(result, turn.jobId!)}
                        title="Copy"
                      >
                        {copiedJobId === turn.jobId ? <Check size={12} strokeWidth={2.5} /> : <Copy size={12} strokeWidth={2} />}
                        {copiedJobId === turn.jobId ? 'Copied' : 'Copy'}
                      </button>
                      {(turn.mode === 'expand' || turn.mode === 'auto') && (
                        <button
                          className="agent-turn-action-btn agent-turn-action-btn--primary"
                          onClick={() => handleInsertAtEnd(result)}
                          title="Insert at end of document"
                        >
                          Insert at end
                        </button>
                      )}
                      {turn.mode === 'proofread' && (
                        isConfirmingReplace ? (
                          <>
                            <span className="agent-turn-confirm-text">Replace all document content?</span>
                            <button
                              className="agent-turn-action-btn agent-turn-action-btn--danger"
                              onClick={() => handleReplaceDocument(result)}
                            >
                              Replace
                            </button>
                            <button
                              className="agent-turn-action-btn"
                              onClick={() => setConfirmReplaceJobId(null)}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            className="agent-turn-action-btn agent-turn-action-btn--primary"
                            onClick={() => setConfirmReplaceJobId(turn.jobId!)}
                          >
                            Replace document
                          </button>
                        )
                      )}
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>

        {/* Composer footer */}
        <div className="agent-composer" onClick={() => setOpenDropdown(null)}>
          <div className="agent-composer-card" onClick={e => e.stopPropagation()}>
            {pendingContext && (
              <div className="agent-composer-context">
                <div className="agent-composer-context-head">
                  <div className="agent-composer-context-head-copy">
                    <span className="agent-composer-context-eyebrow">
                      From inline edit
                    </span>
                    <span className="agent-composer-context-title">{pendingContext.prompt}</span>
                  </div>
                  <div className="agent-composer-context-actions">
                    <button
                      className={`agent-composer-context-toggle${pendingContextVisible ? ' expanded' : ''}`}
                      onClick={() => setPendingContextVisible(v => !v)}
                      type="button"
                    >
                      {pendingContextVisible ? 'Hide changes' : 'Show changes'}
                    </button>
                    <button
                      className="agent-composer-context-dismiss"
                      onClick={() => {
                        setPendingContext(null)
                        setPendingContextVisible(false)
                      }}
                      type="button"
                      title="Dismiss context"
                    >
                      <X size={12} strokeWidth={2.2} />
                    </button>
                  </div>
                </div>
                <span className="agent-composer-context-note">
                  {pendingContextVisible ? 'Selection and generated text are highlighted in the document.' : 'Use show changes to preview the edit in the document.'}
                </span>
              </div>
            )}
            <textarea
              ref={textareaRef}
              className="agent-composer-textarea"
              placeholder={pendingContext ? 'Ask a follow-up about this edit…' : 'Ask the agent…'}
              value={composerPrompt}
              onChange={e => setComposerPrompt(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() }
              }}
              rows={1}
              disabled={submitting}
            />
            <div className="agent-composer-toolbar">
              <div className="agent-composer-dropdowns">
                <PanelInlineDropdown
                  label="Mode"
                  value={composerMode}
                  options={PANEL_TASK_OPTIONS}
                  open={openDropdown === 'mode'}
                  onToggle={() => setOpenDropdown(d => d === 'mode' ? null : 'mode')}
                  onSelect={v => setComposerMode(v)}
                />
                <PanelInlineDropdown
                  label="Effort"
                  value={composerEffort}
                  options={PANEL_EFFORT_OPTIONS}
                  open={openDropdown === 'effort'}
                  onToggle={() => setOpenDropdown(d => d === 'effort' ? null : 'effort')}
                  onSelect={v => setComposerEffort(v)}
                />
              </div>
              <button
                className="agent-composer-send"
                onClick={handleSubmit}
                disabled={!composerPrompt.trim() || submitting || hasRunning}
                title="Send"
              >
                <ArrowUp size={14} strokeWidth={2.5} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {panelError && (
        <div className="ai-error-toast">
          <span className="ai-error-toast-msg">{panelError}</span>
          <button className="ai-error-toast-close" onClick={() => setPanelError(null)} aria-label="Dismiss">
            <X size={13} strokeWidth={2.5} />
          </button>
        </div>
      )}
    </>
  )
}

const blockIdPluginKey = new PluginKey('blockId')
const BLOCK_TYPES = ['paragraph', 'heading', 'blockquote', 'listItem', 'taskItem']

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

  const [contentReady, setContentReady] = useState(false)
  const [docTitle, setDocTitle] = useState(() => yTitle.toString() || '')
  const [theme, setTheme] = useState<'dark' | 'light' | 'system'>(() => {
    return (localStorage.getItem('cowrite-theme') as 'dark' | 'light' | 'system') || 'system'
  })
  const [, setResolvedTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('cowrite-theme') as string
    if (saved === 'dark' || saved === 'light') return saved
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const userName = user?.name ?? ''

  const [words, setWords] = useState(0)
  const [characters, setCharacters] = useState(0)
  const [selectionStat, setSelectionStat] = useState<{ count: number; label: string } | null>(null)
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
  const [agentStats, setAgentStats] = useState<any>(null)
  const [agentStatsLoading, setAgentStatsLoading] = useState(false)

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

  const [incomingJob, setIncomingJob] = useState<{ job_id: string; type: 'complete' | 'failed'; error?: string } | null>(null)
  const [agentPanelMode, setAgentPanelMode] = useState<PanelMode>('hidden')
  const [agentUnseenCount, setAgentUnseenCount] = useState(0)

  const [aiEditOpen, setAiEditOpen] = useState(false)
  const [aiEditPos, setAiEditPos] = useState({ top: 0, left: 0 })
  const [aiEditPhase, setAiEditPhase] = useState<'prompt' | 'streaming' | 'done'>('prompt')
  const aiEditContextRef = useRef<{
    selectedText: string
    from: number
    to: number
    insertedFrom: number
    insertedTo: number
  } | null>(null)
  const [agentInitialContext, setAgentInitialContext] = useState<{
    prompt: string
    selectedText: string
    aiResult: string
    selectionFrom: number
    selectionTo: number
    resultFrom: number
    resultTo: number
  } | null>(null)
  const aiEditPromptRef = useRef('')

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
    setAgentStatsLoading(true)
    fetchAgentStats().then(setAgentStats).catch(() => {}).finally(() => setAgentStatsLoading(false))
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
    let tokenBuffer = ''
    let flushScheduled = false

    const flushBuffer = () => {
      if (!tokenBuffer || ed.isDestroyed) return
      const chunk = tokenBuffer
      tokenBuffer = ''
      flushScheduled = false
      ed.chain().insertContentAt(currentPos, chunk).run()
      currentPos = ed.state.selection.from
      provider.awareness.setLocalStateField('aiPresence', {
        name: 'Claude', color: '#cd6425', isAI: true,
        status: 'active', anchor: currentPos, lastActive: Date.now(),
      })
    }

    await streamAIContent(
      roomId, promptText, before, after, mode,
      (token) => {
        tokenBuffer += token
        if (!flushScheduled) {
          flushScheduled = true
          requestAnimationFrame(flushBuffer)
        }
      },
      () => {
        flushBuffer()
        if (currentPos > insertPos) {
          const rawText = ed.state.doc.textBetween(insertPos, currentPos, '\n')
          if (rawText.includes('\n\n')) {
            ed.chain().deleteRange({ from: insertPos, to: currentPos }).run()
            const content = convertTextToContent(rawText)
            ed.chain().insertContentAt(insertPos, content).run()
            currentPos = ed.state.selection.from
          }
          const decoTr = ed.state.tr.setMeta(aiDecoKey, { from: insertPos, to: currentPos })
          ed.view.dispatch(decoTr)
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

  const triggerAIEditCommand = useCallback(async (
    promptText: string,
    selectedText: string,
    from: number,
    to: number,
  ) => {
    const ed = editorRef.current
    if (!ed || !roomId || aiStreaming) return

    // Insert a newline after the selection so AI output starts on its own line,
    // and re-apply selLockKey over the selection in the same transaction so the
    // highlight survives the focus change to the result bar.
    const insertTr = ed.state.tr
      .insertText('\n', to)
      .setMeta(selLockKey, { from, to })
    ed.view.dispatch(insertTr)
    const insertPos = to + 1
    // insertedFrom = to (includes the \n) so undo removes the newline too
    aiEditContextRef.current = { selectedText, from, to, insertedFrom: to, insertedTo: insertPos }

    // Position bar — defer coord reads so they don't block the paint after flushSync
    requestAnimationFrame(() => {
      try {
        const fromCoords = ed.view.coordsAtPos(from)
        setAiEditPos({ top: fromCoords.top - 44, left: fromCoords.left })
      } catch { }
    })
    setAiEditOpen(true)
    setAiEditPhase('streaming')
    setAiStreaming(true)

    // Use textBetween directly — avoids ProseMirror position vs getText() offset mismatch
    const docSize = ed.state.doc.content.size
    const before = ed.state.doc.textBetween(0, from, '\n')
    const after = ed.state.doc.textBetween(to, Math.min(docSize, to + 4000), '\n')

    let currentPos = insertPos
    let tokenBuffer = ''
    let flushScheduled = false

    const flushBuffer = () => {
      if (!tokenBuffer || ed.isDestroyed) return
      const chunk = tokenBuffer
      tokenBuffer = ''
      flushScheduled = false
      ed.chain().insertContentAt(currentPos, chunk).run()
      currentPos = ed.state.selection.from
      provider.awareness.setLocalStateField('aiPresence', {
        name: 'Claude', color: '#cd6425', isAI: true,
        status: 'active', anchor: currentPos, lastActive: Date.now(),
      })
    }

    await streamAIContent(
      roomId, promptText, before, after, 'rewrite',
      (token) => {
        tokenBuffer += token
        if (!flushScheduled) {
          flushScheduled = true
          requestAnimationFrame(flushBuffer)
        }
      },
      () => {
        flushBuffer()
        if (currentPos > insertPos) {
          const rawText = ed.state.doc.textBetween(insertPos, currentPos, '\n')
          if (rawText.includes('\n\n')) {
            ed.chain().deleteRange({ from: insertPos, to: currentPos }).run()
            const content = convertTextToContent(rawText)
            ed.chain().insertContentAt(insertPos, content).run()
            currentPos = ed.state.selection.from
          }
          const ctx2 = aiEditContextRef.current
          if (ctx2) ctx2.insertedTo = currentPos
          const decoTr = ed.state.tr
            .setMeta(aiDecoKey, { from: insertPos, to: currentPos })
            .setMeta(selLockKey, { from: ctx2!.from, to: ctx2!.to })
          ed.view.dispatch(decoTr)
        }
        setAiEditPhase('done')
        setAiStreaming(false)
        provider.awareness.setLocalStateField('aiPresence', null)
      },
      (err) => {
        console.error('AI error:', err)
        setAiError(err.message || 'AI request failed')
        setAiStreaming(false)
        provider.awareness.setLocalStateField('aiPresence', null)
        setTimeout(() => setAiError(null), 5000)
      },
      selectedText,
    )
  }, [aiStreaming, roomId, provider])

  const slashExtension = useRef(
    makeSlashExtension(
      suggestionPropsRef,
      handleSlashOpenOrUpdate,
      handleSlashClose,
      () => editorRef.current?.state.selection.empty === false,
    )
  ).current

  const openAIEditBox = useCallback((ctx: { selectedText: string; from: number; to: number } | null, _pos: { top: number; left: number }) => {
    const ed = editorRef.current
    if (!ed) return
    if (ctx) {
      aiEditContextRef.current = { selectedText: ctx.selectedText, from: ctx.from, to: ctx.to, insertedFrom: ctx.to, insertedTo: ctx.to }
      // Bar appears just above the start of the selection
      const fromCoords = ed.view.coordsAtPos(ctx.from)
      const toCoords = ed.view.coordsAtPos(ctx.to)
      setAiEditPos({ top: Math.min(fromCoords.top, toCoords.top) - 44, left: fromCoords.left })
    } else {
      const insertPos = ed.state.selection.from
      aiEditContextRef.current = { selectedText: '', from: insertPos, to: insertPos, insertedFrom: insertPos, insertedTo: insertPos }
      setAiEditPos(_pos)
    }
    setAiEditPhase('prompt')
    setAiEditOpen(true)
  }, [])

  const updateSelectionStat = useCallback((editor: any) => {
    const { from, to, empty } = editor.state.selection
    if (empty) {
      setSelectionStat(null)
      return
    }
    const selectedText = editor.state.doc.textBetween(from, to, '\n', '\n')
    const selectedWords = countWords(selectedText)
    const selectedChars = countCharacters(selectedText)
    if (selectedWords > 0) {
      setSelectionStat({
        count: selectedWords,
        label: selectedWords === 1 ? 'selected word' : 'selected words',
      })
      return
    }
    setSelectionStat({
      count: selectedChars,
      label: selectedChars === 1 ? 'selected char' : 'selected chars',
    })
  }, [])

  const BlockIdExtension = Extension.create({
    name: 'blockId',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: blockIdPluginKey,
          appendTransaction(transactions, oldState, newState) {
            const docChanged = transactions.some(tr => tr.docChanged)
            if (!docChanged) return null

            const isOwnTransaction = transactions.some(tr => tr.getMeta(blockIdPluginKey))
            if (isOwnTransaction) return null
            const tr = newState.tr
            let modified = false
            const seenIds = new Set<string>()
            newState.doc.descendants((node, pos) => {
              if (!BLOCK_TYPES.includes(node.type.name)) return

              if (!node.attrs.blockId || seenIds.has(node.attrs.blockId)) {
                tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockId: crypto.randomUUID() })
                modified = true
                return
              }

              seenIds.add(node.attrs.blockId)
            })
            tr.setMeta(blockIdPluginKey, true)

            return modified ? tr : null
          }
        })
      ]
    }
  })

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ history: false, codeBlock: false, paragraph: false, heading: false, blockquote: false }),
      ParagraphWithId,
      HeadingWithId,
      BlockquoteWithId,
      Placeholder.configure({ placeholder: "Write something, or type '/' for commands…" }),
      TaskList,
      TaskItemWithId,
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
      BlockIdExtension
    ],
    onUpdate({ editor }) {
      const text = editor.getText()
      setWords(countWords(text))
      setCharacters(countCharacters(text))
      updateSelectionStat(editor)
    },
    onSelectionUpdate({ editor }) {
      setInTable(editor.isActive('table'))
      updateSelectionStat(editor)
    },
  })

  // Keep editorRef in sync so triggerAICommand can access editor without dep ordering issues
  useEffect(() => { editorRef.current = editor }, [editor])

  useEffect(() => {
    if (editor) (window as any).editor = editor
  }, [editor])

  useEffect(() => {
    if (!editor) return
    const text = editor.getText()
    setWords(countWords(text))
    setCharacters(countCharacters(text))
    updateSelectionStat(editor)
    setInTable(editor.isActive('table'))
  }, [editor, updateSelectionStat])

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

    // Navigate home if deleted; relay job events to AgentTray
    const disconnectSSE = connectEvents(e => {
      if (e.type === 'doc:deleted' && e.payload.room === roomId) navigate('/')
      if (e.type === 'job:complete' && e.payload.room === roomId)
        setIncomingJob({ job_id: e.payload.job_id, type: 'complete' })
      if (e.type === 'job:failed' && e.payload.room === roomId)
        setIncomingJob({ job_id: e.payload.job_id, type: 'failed', error: e.payload.error })
    })

    return () => {
      disconnectSSE()
      provider.awareness.off('change', updateUsers)
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

  const clearAIDecorations = () => {
    if (!editor) return
    const tr = editor.state.tr
      .setMeta(aiDecoKey, null)
      .setMeta(selLockKey, null)
    editor.view.dispatch(tr)
  }

  const handleAIEditUndo = () => {
    const ctx = aiEditContextRef.current
    if (!ctx || !editor) return
    // Single atomic transaction: delete AI text + clear both decorations
    const tr = editor.state.tr
      .deleteRange(ctx.insertedFrom, ctx.insertedTo)
      .setMeta(aiDecoKey, null)
      .setMeta(selLockKey, null)
    editor.view.dispatch(tr)
    setAiEditOpen(false)
    aiEditContextRef.current = null
  }

  const handleAIEditInsert = () => {
    clearAIDecorations()
    setAiEditOpen(false)
    aiEditContextRef.current = null
  }

  const handleAIEditChatMore = () => {
    const ctx = aiEditContextRef.current
    if (!ctx || !editor) return
    const aiResult = editor.state.doc.textBetween(ctx.insertedFrom, ctx.insertedTo, '\n')
    clearAIDecorations()
    setAiEditOpen(false)
    aiEditContextRef.current = null
    setAgentInitialContext({
      prompt: aiEditPromptRef.current,
      selectedText: ctx.selectedText,
      aiResult,
      selectionFrom: ctx.from,
      selectionTo: ctx.to,
      resultFrom: ctx.insertedFrom,
      resultTo: ctx.insertedTo,
    })
    setAgentPanelMode('side')
  }

  const handleApplyProposal = useCallback((jobId: string, proposal: any[]) => {
    const ed = editorRef.current
    if (!ed) return

    const blockIndex: Record<string, { node: any; pos: number }> = {}
    ed.state.doc.forEach((node, offset) => {
      if (node.attrs.blockId) {
        blockIndex[node.attrs.blockId] = { node, pos: offset }
      }
    })

    for (const op of proposal) {
      if (op.op === 'replace_text') {
        if (!blockIndex[op.blockId] || !blockIndex[op.blockId].node.textContent.includes(op.oldText)) {
          setAiError('Proposal is stale — document has changed since this job ran.')
          return
        }
      } else if (op.op === 'insert_block_after') {
        if (!blockIndex[op.afterBlockId]) {
          setAiError('Proposal is stale — document has changed since this job ran.')
          return
        }
      } else {
        setAiError('Proposal contains unknown op type.')
        return
      }
    }

    const sortedOps = [...proposal].sort((a, b) => {
      const posA = blockIndex[a.blockId ?? a.afterBlockId]?.pos ?? -1
      const posB = blockIndex[b.blockId ?? b.afterBlockId]?.pos ?? -1
      return posB - posA
    })

    const tr = ed.state.tr

    for (const op of sortedOps) {
      const blockId = op.blockId ?? op.afterBlockId
      const block = blockIndex[blockId]
      if (!block) continue

      const { node, pos } = block

      if (op.op === 'replace_text') {
        const offset = node.textContent.indexOf(op.oldText)

        if (offset === -1) continue

        const from = pos + 1 + offset
        const to = from + op.oldText.length

        tr.replaceWith(from, to, ed.schema.text(op.newText))
      }

      if (op.op === 'insert_block_after') {
        const insertPos = pos + node.nodeSize

        const paragraph = ed.schema.nodes.paragraph.create(
          null,
          op.text ? ed.schema.text(op.text) : null
        )

        tr.insert(insertPos, paragraph)
      }
    }

    if (tr.docChanged) {
      ed.view.dispatch(tr)
      setAiError(null)
    }
  }, [])

  return (
    <div className="app">
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
            >
              <ArrowLeft size={16} strokeWidth={2} />
            </button>
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

            <button
              className={`topbar-share-btn agent-topbar-btn${agentUnseenCount > 0 ? ' has-results' : ''}${agentPanelMode !== 'hidden' ? ' active' : ''}`}
              onClick={() => setAgentPanelMode(m => m === 'hidden' ? 'side' : 'hidden')}
              title="Agent"
            >
              Agent
              <span className="agent-new-badge" />
            </button>
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
                  {words > 0 && (
                    <div className="settings-stats">
                      <span className="settings-stats-item">
                        <span className="settings-stats-num">{words.toLocaleString()}</span>
                        <span className="settings-stats-label">{words === 1 ? 'word' : 'words'}</span>
                      </span>
                      <span className="settings-stats-separator" aria-hidden="true">|</span>
                      <span className="settings-stats-item">
                        <span className="settings-stats-num">{readingTime(words)}</span>
                      </span>
                      <span className="settings-stats-separator" aria-hidden="true">|</span>
                      <span className="settings-stats-item">
                        <span className="settings-stats-num">
                          {(selectionStat?.count ?? characters).toLocaleString()}
                        </span>
                        <span className="settings-stats-label">
                          {selectionStat?.label ?? (characters === 1 ? 'char' : 'chars')}
                        </span>
                      </span>
                    </div>
                  )}
                  <div className="settings-section settings-section--agent-stats">
                    <div className="settings-row">
                      <span className="settings-section-label" style={{ padding: 0 }}>Agent Stats</span>
                      {agentStatsLoading && <LoaderCircle size={11} strokeWidth={2} className="settings-agent-stats-spinner" />}
                    </div>
                    {agentStatsLoading && !agentStats ? (
                      <div className="settings-agent-stats-skeleton">
                        {[80, 55, 70, 45].map(w => (
                          <div key={w} className="settings-row">
                            <span className="settings-skeleton-line" style={{ width: 72 }} />
                            <span className="settings-skeleton-line" style={{ width: w }} />
                          </div>
                        ))}
                      </div>
                    ) : agentStats && (
                      <>
                        <div className="settings-row">
                          <span className="settings-label">Total {agentStats.total_jobs === 1 ? 'job' : 'jobs'}</span>
                          <span className="settings-agent-stat-value">{agentStats.total_jobs}</span>
                        </div>
                        <div className="settings-row">
                          <span className="settings-label">Success rate</span>
                          <span className="settings-agent-stat-value">{(agentStats.success_rate * 100).toFixed(0)}%</span>
                        </div>
                        <div className="settings-row">
                          <span className="settings-label">Latency</span>
                          <span className="settings-agent-stat-value">p50 {agentStats.p50_ms ?? '—'} | p95 {agentStats.p95_ms ?? '—'} ms</span>
                        </div>
                        <div className="settings-row">
                          <span className="settings-label">Est. cost</span>
                          <span className="settings-agent-stat-value">${agentStats.estimated_cost_usd.toFixed(4)}</span>
                        </div>
                        {Object.keys(agentStats.by_mode).length > 0 && (
                          <div className="settings-agent-stats-modes">
                            {Object.entries(agentStats.by_mode).map(([mode, s]: [string, any]) => (
                              <div key={mode} className="settings-agent-stats-mode-row">
                                <span className="settings-agent-stats-mode-name">{mode}</span>
                                <span className="settings-agent-stats-mode-meta">{s.count} {s.count === 1 ? 'job' : 'jobs'} | p50 {s.p50_ms ?? '—'}ms | {s.avg_output_tokens} tok</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Editor */}
        <div className={`editor-container${agentPanelMode === 'side' ? ' panel-open' : ''}`}>
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
              const range = suggestionPropsRef.current?.range
              if (item.needsPrompt) {
                // Capture selection before deleting the slash range
                const hasSelection = editor && !editor.state.selection.empty
                const selFrom = editor?.state.selection.from ?? 0
                const selTo = editor?.state.selection.to ?? 0
                const selectedText = hasSelection && editor
                  ? editor.state.doc.textBetween(selFrom, selTo, '\n')
                  : ''
                const selCoords = hasSelection && editor ? editor.view.coordsAtPos(selTo) as { top: number; bottom: number; left: number; right: number } : null

                if (range) editor?.chain().focus().deleteRange(range).run()
                setSlashOpen(false)

                if ((item.isRewrite || (hasSelection && selectedText)) && editor) {
                  // Rewrite or AI: Write with selection — open edit box anchored below selection
                  const pos = selCoords
                    ? { top: selCoords.bottom + 8, left: selCoords.left }
                    : slashPos
                  openAIEditBox({ selectedText, from: selFrom, to: selTo }, pos)
                } else {
                  // Write mode: no selection context, open prompt box at slash position
                  openAIEditBox(null, slashPos)
                }
              } else {
                // Continue: stream immediately
                const fullText = editor?.getText() ?? ''
                const cursorPos = editor ? editor.state.doc.textBetween(0, editor.state.selection.from, '\n').length : 0
                if (range) editor?.chain().focus().deleteRange(range).run()
                setSlashOpen(false)
                triggerAICommand('', item.aiMode || 'continue', { fullText, cursorOffset: cursorPos })
              }
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
      {editor && (
        <FloatingToolbar
          editor={editor}
          onAIEdit={(selectedText, from, to, _pos, promptText) => {
            aiEditPromptRef.current = promptText
            triggerAIEditCommand(promptText, selectedText, from, to)
          }}
        />
      )}

      {/* Block handle */}
      {editor && <BlockHandle editor={editor} />}

      {/* Cursor overlay: idle dimming + context preview */}
      {editor && <CursorOverlay editor={editor} provider={provider} />}

      {/* Agent panel */}
      {editor && roomId && (
        <AgentPanel
          roomId={roomId}
          editor={editor}
          panelMode={agentPanelMode}
          onPanelModeChange={setAgentPanelMode}
          onUnseenChange={setAgentUnseenCount}
          onApplyProposal={handleApplyProposal}
          incomingJob={incomingJob}
          onIncomingJobConsumed={() => setIncomingJob(null)}
          initialContext={agentInitialContext}
          onInitialContextConsumed={() => setAgentInitialContext(null)}
        />
      )}

      {/* AI Edit Box */}
      {aiEditOpen && (
        <AIEditBox
          phase={aiEditPhase}
          position={aiEditPos}
          onSubmit={promptText => {
            aiEditPromptRef.current = promptText
            const ctx = aiEditContextRef.current
            if (ctx) {
              triggerAIEditCommand(promptText, ctx.selectedText, ctx.from, ctx.to)
            }
          }}
          onUndo={handleAIEditUndo}
          onInsert={handleAIEditInsert}
          onChatMore={handleAIEditChatMore}
          onCancel={() => setAiEditOpen(false)}
        />
      )}

      {/* AI error toast */}
      {aiError && (
        <div className="ai-error-toast">
          <span className="ai-error-toast-msg">AI Error: {aiError}</span>
          <button className="ai-error-toast-close" onClick={() => setAiError(null)} aria-label="Dismiss">
            <X size={13} strokeWidth={2.5} />
          </button>
        </div>
      )}

    </div>
  )
}
