# Information spec — AI chat response metrics (TPS + response time)

**For:** the UI architect.
**Scope:** display only. The backend already emits the numbers below on every `/file/ai-edit`
response; nothing server-side needs to change. This spec is the contract and some display
guidance so the chat can show **tokens-per-second** and **response time** per assistant reply.

---

## Where this lives

The multi-thread AI chat is `src/pages/tasks/components/FileChat.tsx`. It already calls
`POST /file/ai-edit` (via `withProject(...)`) and renders an assistant message per reply. The
only change is: read the new `metrics` object off the response and show it on that message.

---

## The endpoint (unchanged shape + one new field)

### Request — `POST /file/ai-edit?project=<id>`

Already sent by the chat; listed here only for completeness. No change.

```ts
{
  instruction: string,                                 // the user's message
  files: Array<{ path: string }>,                      // tagged repo files
  uploads?: Array<{ name: string, content: string }>,  // reference-only files
  sessionId?: string,                                  // per-thread continuity token
  model?: 'haiku' | 'sonnet' | 'opus',
  effort?: 'low' | 'medium' | 'high',
  project?: string
}
```

### Response

```ts
{
  answer: string,                    // prose, already shown in the bubble
  sessionId: string,                 // already stored per thread
  proposals: Array<{                 // already rendered as diffs
    path: string,
    oldContent: string,
    newContent: string,
    diff: string                     // unified diff for <DiffView>
  }>,
  metrics: {                         // ⬅ NEW — this is all that's new
    responseMs: number,              // total response time, milliseconds
    responseSec: number,             // same, in seconds, 2 decimals (e.g. 5.26)
    ttftMs: number | null,           // time to first token, ms; null if unknown
    outputTokens: number,            // tokens the model generated
    inputTokens: number,             // tokens sent (prompt + files + context)
    tps: number,                     // OUTPUT tokens per second, overall, 1 decimal (e.g. 53.8)
    costUsd: number                  // model cost for this call, USD (e.g. 0.0239)
  }
}
```

**These are the model runtime's own exact numbers** (from the CLI's usage/timing envelope), not
client-side estimates. `tps` is defined as `outputTokens / responseSec` — overall throughput, not
a generation-window figure. `ttftMs` is provided separately so "time to first token" can be shown
on its own if desired.

---

## What to display

The two headline numbers you asked for are **`responseSec`** and **`tps`**. Suggested minimal
treatment — a small, muted metrics line under each assistant bubble:

```
53.8 tok/s · 5.26s · 283 tokens
```

Fuller version if there's room (tooltip or expanded row):

| Show | Field | Format |
|---|---|---|
| Speed | `tps` | `53.8 tok/s` |
| Response time | `responseSec` | `5.26s` |
| Time to first token | `ttftMs` | `3.2s` (÷1000) — omit if `null` |
| Output size | `outputTokens` | `283 tokens` |
| Input size | `inputTokens` | `9 in` (optional) |
| Cost | `costUsd` | `$0.024` (optional; 3–4 dp) |

Keep it visually secondary — this is telemetry beside the reply, not the reply.

---

## Frontend wiring (guidance, not prescriptive)

1. **Type** — extend the assistant message so the numbers ride with the reply:
   ```ts
   export interface ChatMetrics {
     responseMs: number; responseSec: number; ttftMs: number | null;
     outputTokens: number; inputTokens: number; tps: number; costUsd: number;
   }
   // ChatMsg gains: metrics?: ChatMetrics;
   ```
2. **Capture** — where the response is handled today (the assistant message is pushed with
   `text: r.answer` and `proposals: r.proposals`), also set `metrics: r.metrics`.
3. **Render** — a small caption row under the assistant bubble, next to the proposals/diff block.

---

## Edge cases the UI must tolerate

- **`metrics` may be absent or zeroed.** On a model call that returned no usable output the
  backend responds `502 { error, raw }` (no `metrics`) — the existing error/toast path handles
  that. On a successful-but-thin reply, `outputTokens`/`tps` can legitimately be `0`; render `—`
  or hide the row rather than showing `0 tok/s`.
- **`ttftMs` can be `null`** — hide the "time to first token" item when so; do not render `nulls`.
- **Never block the reply on metrics.** They are decoration; if a field is missing, still show the
  answer and proposals.
- **Don't recompute anything.** `tps` is already correct (overall throughput); do not re-derive it
  from `outputTokens / responseSec` yourself unless you want to reformat — the number is authoritative.

---

## Non-goals

- No streaming UI. The response arrives whole (one request), so there is no live token counter;
  the metrics describe the completed reply. If a live counter is wanted later, that's a separate
  streaming endpoint, not this.
- No historical/aggregate metrics view here — this spec is per-message only.
