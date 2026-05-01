# CoWrite

CoWrite is a real-time collaborative document editor that combines CRDT-based multiplayer editing with asynchronous AI agents, reviewable proposal ops, and inline streaming edits.

## Why This Stands Out

- Built around hard systems problems, not just AI prompting: collaborative consistency, async job orchestration, stale-edit prevention, and safe apply semantics.
- Separates AI generation from document mutation with a structured proposal layer, so users review changes before they land.
- Combines product polish with backend depth: live multiplayer editing, background agents, streaming UX, sharing, and lightweight observability.

## Demo

- Live demo: `[Add link]`
- Demo video: `[Add link]`

[Image Placeholder: Hero shot — main editor with agent panel open, real document content, completed agent job visible, and `Apply changes` button on screen]

## UI Screenshots

[Image Placeholder: Proposal apply flow — completed proposal showing op count and `Apply` button, ideally with visible document changes after applying]

[Image Placeholder: Inline AI streaming — done-state result bar with `Undo`, `Keep & insert`, and `Chat more` visible below a selection]

[Image Placeholder: Multiplayer cursors — two browser windows side by side, different user colors, both editing the same document]

[Image Placeholder: Agent stats in settings — settings popover with p50/p95 latency and estimated cost visible]

## Core Features

- Real-time multiplayer editing with TipTap + ProseMirror on the client and Yjs/y-websocket for CRDT sync.
- Live presence with colored cursors, idle detection, and click-to-follow collaboration UX.
- Background AI agent jobs that run independently from the editor, so users can keep writing while work is in flight.
- Structured proposal review with typed edit ops, diff-style previews, and an explicit `Apply changes` step.
- Inline AI commands for writing, rewriting, continuing, and summarizing with streaming insertion and recovery controls.
- Document sharing, per-user access control, and per-document editor preferences persisted to the server.
- Lightweight observability for agent performance, including success rate, p50/p95 latency, per-mode stats, and estimated cost.

## Engineering Highlights

### 1. CRDTs Instead of Centralized Conflict Resolution

CoWrite uses Yjs rather than operational transformation. Each client keeps a full replica of the document, and concurrent edits merge through the CRDT itself instead of relying on a server-side transform pipeline. That simplifies the server into a sync relay and makes the collaboration model resilient to disconnects and reconnections.

### 2. Async AI Without Stale Writes

Agent jobs are not allowed to read the live document minutes later and blindly patch it. When a job is submitted, the server captures a snapshot of the document's block structure and stores it on the job row. The worker generates proposals against that frozen snapshot, which prevents time-of-check/time-of-use bugs where the document changes before the model finishes.

### 3. Reviewable AI Proposals Instead of Blind Mutation

AI edits are stored as typed JSON ops such as `replace_text` and `insert_block_after` rather than applied directly to the document. This gives the UI a safe review layer, lets the user inspect diffs before accepting them, and makes proposal application deterministic instead of model-driven.

### 4. Two-Phase Validation for Safe Apply Semantics

Completed proposals are validated twice:

- Server-side validation checks that every target block exists in the captured snapshot and that `oldText` still matches the snapshot content.
- Client-side preflight checks the same assumptions against the live document immediately before apply.

If the document has drifted, CoWrite marks the proposal stale instead of partially mutating the editor. When a proposal is valid, it applies through a single ProseMirror transaction ordered back-to-front so position shifts do not corrupt later ops.

### 5. Atomic Job Claiming and Failure Recovery

The worker claims jobs with one SQL `UPDATE ... RETURNING *` statement, so two workers cannot race and claim the same job. The same query also handles retries and reclaiming timed-out jobs, which keeps the queue logic simple and concurrency-safe even on SQLite.

### 6. Map-Reduce for Long Documents

For larger documents, the worker switches from one model call to a chunked map-reduce pipeline. Chunks are processed in parallel, then reduced differently depending on mode: proposal ops are merged, summaries get a second synthesis pass, and review output is deduplicated across overlaps.

### 7. Stable Block IDs for Position-Independent Edits

Block-level nodes are stamped with persistent UUIDs through a ProseMirror plugin. Proposal ops target those IDs instead of fragile absolute positions, which keeps edits stable across serialization, reloads, Yjs sync, and collaborative changes.

## Technical Challenges Solved

- Prevented stale async AI edits with snapshot-based validation instead of trusting the current live document.
- Preserved all-or-nothing apply semantics for AI proposals inside a collaborative rich-text editor.
- Combined WebSocket-based CRDT sync with SSE-driven job completion and REST APIs in one lightweight Node.js service.
- Used SQLite in WAL mode to support concurrent reads and writes across the document server, sharing flows, and background worker.
- Added enough observability to reason about agent quality and cost without introducing heavy infrastructure.

## Architecture Overview

The client is a React + TipTap editor backed by a Yjs document. Collaboration sync flows through `y-websocket`, while AI jobs and sharing run through REST endpoints and SSE notifications on the Node.js server. Document state is persisted as Yjs updates in SQLite, and a background worker processes agent jobs, validates proposals, and publishes completion events back to the owning user.

[Image Placeholder: System Architecture]

[Image Placeholder: Agent Proposal Flow]

## Stack

| Layer | Technology |
| --- | --- |
| Frontend | React, TypeScript, Vite |
| Editor | TipTap, ProseMirror |
| Collaboration | Yjs, y-websocket |
| Backend | Node.js HTTP server, ws |
| Database | SQLite, better-sqlite3, WAL mode |
| AI | Anthropic Claude API |
| Auth | Google OAuth2, session cookies |

## Why This Project Is Interesting

CoWrite is not just a text editor with an AI button. The interesting part is the boundary between collaborative state and asynchronous model output: the project has to preserve correctness while multiple humans and an AI system all interact with the same document on different timelines. The architecture reflects that constraint throughout the system, from block IDs and snapshot capture to proposal validation and atomic job claiming.

It also shows full-stack range in one project: rich-text editor internals, CRDT sync, server-side queue processing, auth, access control, streaming UX, and basic production-minded metrics.

## Future Work

- Multi-worker queue execution with explicit leader election or external job storage.
- Richer proposal controls such as per-op accept/reject and threaded review comments.
- Versioned document history and diffable proposal replays.
- Stronger cost accounting based on full token usage across request and response paths.
- Presence and collaboration features that extend beyond cursors into comments and annotations.
