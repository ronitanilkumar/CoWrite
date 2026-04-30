# CoWrite

Real-time collaborative document editor with AI agents, CRDT sync, and a structured proposal system for reviewing and applying AI edits.

![CoWrite Editor](./docs/screenshot.png)

---

## Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────┐
│                        Client                           │
│  TipTap Editor + Yjs CRDT + React                       │
│                                                         │
│  ┌─────────────┐    ┌──────────────┐   ┌─────────────┐ │
│  │ Editor UI   │    │ Agent Panel  │   │ Inline AI   │ │
│  │ (ProseMirror│    │ (job queue   │   │ (streaming  │ │
│  │  + TipTap)  │    │  + proposals)│   │  edits)     │ │
│  └──────┬──────┘    └──────┬───────┘   └──────┬──────┘ │
└─────────┼─────────────────┼──────────────────┼─────────┘
          │ WebSocket        │ HTTP             │ HTTP/SSE
          │ (Yjs sync)       │ (REST)           │ (streaming)
┌─────────┼─────────────────┼──────────────────┼─────────┐
│         ▼                 ▼                  ▼         │
│              Node.js HTTP + WebSocket Server            │
│                                                         │
│  ┌─────────────┐    ┌──────────────┐   ┌─────────────┐ │
│  │ y-websocket │    │  REST routes │   │  SSE push   │ │
│  │  (CRDT sync)│    │  + auth      │   │  (job       │ │
│  └──────┬──────┘    └──────┬───────┘   │   events)   │ │
│         │                  │           └──────┬──────┘ │
│         ▼                  ▼                  ▼        │
│              SQLite (WAL mode)                         │
│   documents | users | sessions | agent_jobs            │
│                                                        │
│         ▼ Worker (2s interval)                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Claim job → Map chunks → Claude API → Reduce   │  │
│  │  → store proposal_json → SSE notify owner       │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
                          │
                          ▼
                    Anthropic Claude API
```

### Agent Job Lifecycle

```
User submits task
       │
       ▼
POST /agent-job
  - check access
  - capture snapshot_json (TOCTOU fix)
  - insert job (state: pending)
       │
       ▼
Worker tick (every 2s)
  - atomic claim: UPDATE ... WHERE id = (SELECT ... LIMIT 1) RETURNING *
  - if plainText > 6000 chars: map-reduce
  - else: single Claude call
       │
       ├── Map phase: chunkText() → Promise.all(Claude calls)
       │
       └── Reduce phase (by mode):
             proofread/expand/auto → concat op arrays
             summarize → second Claude call on partial summaries
             review → deduplicate issue lines
       │
       ▼
  store proposal_json
  SSE push → job:complete
       │
       ▼
User clicks "Apply changes"
  - client preflight: block exists? oldText matches?
  - all-or-nothing ProseMirror transaction (back-to-front)
  - or: show stale badge if doc changed
```

---

## Key Technical Decisions

### CRDTs over Operational Transformation

CoWrite uses Yjs, which implements a CRDT (Conflict-free Replicated Data Type) for document sync. Every client holds a full replica of the document. Edits merge automatically without a central coordinator resolving conflicts.

The tradeoff: OT requires a server to serialize and transform concurrent operations. CRDTs push that complexity into the data structure itself, which lets the server act purely as a relay. The practical result is that CoWrite handles network partitions gracefully: clients can keep editing offline and sync when reconnected with no manual conflict resolution.

Yjs awareness (cursor presence, AI typing indicator) is kept ephemeral and never persisted to SQLite. Awareness state is meaningful only while a session is live.

### SQLite WAL Mode

SQLite runs in WAL (write-ahead log) mode. In default journal mode, readers block writers. WAL flips this: readers and writers operate concurrently against separate versions of the database. This matters because the document server has multiple concurrent readers (REST routes, the worker) and frequent writes (document saves, job state updates) happening at the same time.

Documents are stored as binary Yjs state blobs (`Y.encodeStateAsUpdate`) rather than structured text. The full CRDT state is preserved in a single column, which means any client can reconstruct the full document history from a single row.

### Atomic Job Claiming

The worker runs on a 2-second interval and claims jobs with a single SQL statement:

```sql
UPDATE agent_jobs
SET current_state = 'running', attempt = attempt + 1, started_at = ?
WHERE id = (
  SELECT id FROM agent_jobs
  WHERE current_state = 'pending'
     OR (current_state = 'failed' AND attempt < max_retries)
     OR (current_state = 'running' AND timeout_at < ?)
  ORDER BY created_at ASC
  LIMIT 1
)
RETURNING *
```

This is a single atomic operation. There is no window between checking a job's state and updating it where two workers could claim the same job. The `RETURNING *` clause gives the worker the claimed job in one round-trip. Timeout detection is built into the same query: jobs stuck in `running` longer than 5 minutes get reclaimed automatically.

### TOCTOU Fix: Frozen Snapshot at Submit Time

When a user submits an agent job, the server immediately captures a snapshot of the document's current block structure (`snapshot_json`) and stores it on the job row.

The problem this solves: the worker may not run for several seconds after submission, and the user keeps editing. Without the snapshot, the worker reads a document that has already changed. It would generate proposals referencing blocks that no longer exist or text that no longer matches. This is a classic time-of-check to time-of-use (TOCTOU) bug.

With the snapshot, the worker always operates on the document as it was at submit time. The snapshot also drives server-side validation and client-side preflight at apply time.

### Structured Proposals with Two-Phase Validation

Agent output is stored as a JSON array of typed ops (`replace_text`, `insert_block_after`) rather than applied directly to the document. The user reviews ops in the agent panel and clicks "Apply changes" to accept.

Two validation layers protect document integrity:

**Server validation** (at job completion): checks that every block ID exists in the snapshot and that `oldText` matches the snapshot content exactly. If anything fails, the job is marked invalid before the user ever sees it.

**Client preflight** (at accept time): re-checks block existence and `oldText` match against the live document at the moment the user clicks Apply. The document may have changed since the job completed. If any op fails preflight, the entire apply is aborted.

Apply uses a single ProseMirror transaction. Ops are sorted back-to-front (higher document positions first) so earlier ops don't shift the positions of later ones. Either all ops apply or none do.

### Map-Reduce for Long Documents

For documents longer than 6,000 characters, the worker switches from a single Claude call to a map-reduce pipeline:

**Map**: `chunkText()` splits the document into overlapping 6,000-character chunks (200-character overlap to prevent boundary sentences from being missed). Each chunk is sent to Claude in parallel via `Promise.all`.

**Reduce**: chunk results are merged using mode-specific logic:
- `proofread`, `expand`, `auto`: op arrays are concatenated
- `summarize`: a second Claude call synthesizes partial summaries into a final summary
- `review`: issue lines are deduplicated across chunks using a Set

The 200-character overlap means the same sentence may appear in two adjacent chunks. For review mode, deduplication prevents the same issue from appearing twice. For JSON op modes, block IDs are unique so duplicates are structurally impossible.

`Promise.all` provides concurrency in Node.js because each Claude API call is handled by the OS network layer outside the JavaScript thread. The event loop processes callbacks as responses arrive. A 5-chunk document takes roughly the same wall-clock time as a single chunk.

### Block IDs for Stable Op Targeting

Every block-level node (paragraphs, headings, blockquotes, task items) gets a stable UUID stamped by a ProseMirror `appendTransaction` plugin. The plugin runs after every document-changing transaction and stamps any node missing an ID.

A `seenIds` Set detects duplicates that can appear after paste or undo operations and replaces them with fresh UUIDs.

Block IDs are declared as TipTap node attributes with `parseHTML`/`renderHTML` handlers so they survive HTML serialization, document reload, and Yjs sync round-trips. The IDs are what allow proposal ops to target specific blocks by stable identity rather than fragile character positions.

---

## Features

- Real-time multiplayer editing with live cursors, idle detection, and click-to-follow
- Background AI agents: submit a job, keep editing, receive results via SSE
- Structured proposal review: accept or reject AI edits block by block
- Inline AI: stream edits directly into the document with Undo and Chat more
- Map-reduce pipeline for long documents
- Observability: p50/p95 latency, success rate, cost tracking per mode
- Document sharing with per-user access control
- Per-document preferences synced to server

---

## Stack

| Layer | Technology |
|---|---|
| Editor | TipTap, ProseMirror |
| Sync | Yjs, y-websocket |
| Frontend | React, TypeScript, Vite |
| Backend | Node.js (no framework) |
| Database | SQLite (better-sqlite3, WAL mode) |
| AI | Anthropic Claude API |
| Auth | Google OAuth2, session cookies |

---

## Running Locally

```bash
# Install dependencies
cd server && npm install
cd client && npm install

# Set environment variables
cp .env.example .env
# Add ANTHROPIC_API_KEY, OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET

# Start server (port 1234)
cd server && node index.js

# Start client (port 5173)
cd client && npm run dev
```
