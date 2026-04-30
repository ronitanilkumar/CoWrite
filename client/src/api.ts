const BASE = 'http://localhost:1234'

const OPTS: RequestInit = { credentials: 'include' }

// ── Auth ─────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string
  name: string
  email: string
  color: string
  avatar_url: string | null
}

export async function getMe(): Promise<AuthUser | null> {
  try {
    const res = await fetch(`${BASE}/auth/me`, OPTS)
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export async function logout() {
  try {
    await fetch(`${BASE}/auth/logout`, { ...OPTS, method: 'POST' })
  } catch {}
}

// ── Documents ────────────────────────────────────────────────────────

export async function getUserDocuments() {
  try {
    const res = await fetch(`${BASE}/users/me/documents`, OPTS)
    if (!res.ok) return []
    return res.json()
  } catch {
    return []
  }
}

export async function getSharedDocuments() {
  try {
    const res = await fetch(`${BASE}/users/me/shared-documents`, OPTS)
    if (!res.ok) return []
    return res.json()
  } catch {
    return []
  }
}

export async function createDocument(room: string) {
  try {
    const res = await fetch(`${BASE}/documents`, {
      ...OPTS,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room }),
    })
    return res.json()
  } catch {
    return null
  }
}

export async function deleteDocument(room: string) {
  try {
    const res = await fetch(`${BASE}/documents/${room}`, { ...OPTS, method: 'DELETE' })
    return res.json()
  } catch {
    return null
  }
}

export async function renameDocument(room: string, title: string) {
  try {
    const res = await fetch(`${BASE}/documents/${room}/title`, {
      ...OPTS,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
    return res.json()
  } catch {
    return null
  }
}

// ── Sharing ──────────────────────────────────────────────────────────

export async function getAllUsers(): Promise<{ id: string; name: string; color: string }[]> {
  try {
    const res = await fetch(`${BASE}/users`, OPTS)
    if (!res.ok) return []
    return res.json()
  } catch {
    return []
  }
}

export async function getDocShares(room: string): Promise<{ id: string; name: string; color: string }[]> {
  try {
    const res = await fetch(`${BASE}/documents/${room}/shares`, OPTS)
    if (!res.ok) return []
    return res.json()
  } catch {
    return []
  }
}

export async function shareDocument(room: string, sharedWithId: string) {
  try {
    const res = await fetch(`${BASE}/documents/${room}/share`, {
      ...OPTS,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shared_with_id: sharedWithId }),
    })
    return res.json()
  } catch {
    return null
  }
}

export async function unshareDocument(room: string, sharedWithId: string) {
  try {
    const res = await fetch(`${BASE}/documents/${room}/share/${sharedWithId}`, { ...OPTS, method: 'DELETE' })
    return res.json()
  } catch {
    return null
  }
}

// ── Prefs ────────────────────────────────────────────────────────────

export interface DocPrefs {
  fullWidth?: boolean
  spellCheck?: boolean
  editorFont?: 'sans' | 'serif' | 'mono'
  editorSize?: 'sm' | 'md' | 'lg'
  editorLineHeight?: 'compact' | 'normal' | 'spacious'
}

export async function getDocPrefs(room: string): Promise<DocPrefs> {
  try {
    const res = await fetch(`${BASE}/documents/${room}/prefs`, OPTS)
    if (!res.ok) return {}
    const data = await res.json()
    return data.prefs ?? {}
  } catch {
    return {}
  }
}

export async function saveDocPrefs(room: string, prefs: DocPrefs) {
  try {
    await fetch(`${BASE}/documents/${room}/prefs`, {
      ...OPTS,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefs }),
    })
  } catch {}
}

// ── Real-time events (SSE) ───────────────────────────────────────────

export type ServerEvent =
  | { type: 'doc:shared';   payload: Record<string, unknown> }
  | { type: 'doc:unshared'; payload: { room: string } }
  | { type: 'doc:deleted';  payload: { room: string } }
  | { type: 'job:complete'; payload: { job_id: string; room: string; status: string; result_kind?: string; preview?: string; op_count?: number } }
  | { type: 'job:failed';   payload: { job_id: string; room: string; error: string } }

export function connectEvents(onEvent: (e: ServerEvent) => void): () => void {
  const es = new EventSource(`${BASE}/events`, { withCredentials: true })

  es.addEventListener('doc:shared',   e => onEvent({ type: 'doc:shared',   payload: JSON.parse((e as MessageEvent).data) }))
  es.addEventListener('doc:unshared', e => onEvent({ type: 'doc:unshared', payload: JSON.parse((e as MessageEvent).data) }))
  es.addEventListener('doc:deleted',  e => onEvent({ type: 'doc:deleted',  payload: JSON.parse((e as MessageEvent).data) }))
  es.addEventListener('job:complete', e => onEvent({ type: 'job:complete', payload: JSON.parse((e as MessageEvent).data) }))
  es.addEventListener('job:failed',   e => onEvent({ type: 'job:failed',   payload: JSON.parse((e as MessageEvent).data) }))

  return () => es.close()
}

// ── Agent jobs ───────────────────────────────────────────────────────

export async function submitAgentJob(params: {
  room: string
  task: string
  mode: string
  effort: string
}): Promise<{ job_id: string; status: string }> {
  const res = await fetch(`${BASE}/agent-job`, {
    ...OPTS,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task: params.task, document_id: params.room, mode: params.mode, effort: params.effort }),
  })
  if (!res.ok) throw new Error(`Failed to submit agent job: ${res.status}`)
  return res.json()
}

export interface AgentJobResult {
  id: string
  current_state: string
  result: string | null
  result_kind: string | null
  proposal_json: string | null
  decision: string | null
  error_msg: string | null
  mode: string
  task: string
  model_used: string
  output_tokens: number
  created_at: number
}

export async function patchJobDecision(jobId: string, decision: 'applied' | 'dismissed'): Promise<void> {
  await fetch(`${BASE}/jobs/${jobId}/decision`, {
    ...OPTS,
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision }),
  })
}

export async function getJobResult(jobId: string): Promise<AgentJobResult> {
  const res = await fetch(`${BASE}/jobs/${jobId}`, OPTS)
  if (!res.ok) throw new Error(`Failed to fetch job: ${res.status}`)
  return res.json()
}

export async function getJobsForRoom(room: string): Promise<AgentJobResult[]> {
  try {
    const res = await fetch(`${BASE}/jobs?room=${encodeURIComponent(room)}`, OPTS)
    if (!res.ok) return []
    return res.json()
  } catch {
    return []
  }
}

export const getDocumentJobs = getJobsForRoom

export async function fetchAgentStats(): Promise<any> {
  const res = await fetch(`${BASE}/admin/agent-stats`, OPTS)
  if (!res.ok) throw new Error(`Failed to fetch agent stats: ${res.status}`)
  return res.json()
}

// ── AI ───────────────────────────────────────────────────────────────

export async function streamAIContent(
  room: string,
  prompt: string,
  before: string,
  after: string,
  mode: 'write' | 'continue' | 'summarize' | 'rewrite',
  onToken: (token: string) => void,
  onDone: () => void,
  onError: (err: Error) => void,
  selection?: string,
): Promise<void> {
  try {
    const res = await fetch(`${BASE}/documents/${room}/ai`, {
      ...OPTS,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, before, after, mode, selection }),
    })
    if (!res.ok) throw new Error(`AI request failed: ${res.status}`)
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6)
        if (data === '[DONE]') { onDone(); return }
        try {
          const parsed = JSON.parse(data)
          if (parsed.error) { onError(new Error(parsed.error)); return }
          onToken(parsed.token)
        } catch {}
      }
    }
    onDone()
  } catch (err) {
    onError(err as Error)
  }
}
