# Piranha — Pricing (Content Draft)

> **Draft pricing-page content for the Owner's review.** Numbers are proposed anchors with
> rationale, not committed prices. Competitor figures are cited with source and access date;
> re-verify before publishing because AI-tool pricing moves fast. This is a marketing/positioning
> draft, not a legal or financial commitment.

---

## Positioning line

**Piranha is a self-hosted multi-agent coding orchestrator. Your repos, your machines, your
models — a Kanban board that drives a swarm of coding agents through plan -> build -> qa -> review,
each task in an isolated git worktree, with a human-approved merge gate before anything lands.**

Unlike hosted agents (Devin) or IDE assistants (Cursor, Copilot), Piranha **runs on your own
infrastructure**, orchestrates agents you already pay for (Claude Code today; other engines
later), and never sends your source code to us. You pay for the orchestrator, not per-token
model markup.

---

## The three tiers (aligned to the SPEC releases)

| | **Solo** | **Team** | **Enterprise** |
|---|---|---|---|
| **For** | One developer, one machine | A small team / personal fleet | Orgs needing scale, hosting help, or support SLAs |
| **Maps to SPEC** | Release 1 (standalone) | Release 2 (fleet) | Release 2–3 (fleet + hosted/support + engine adapters) |
| **Seats** | 1 | Up to [10] | Custom |
| **Workers (fleet)** | 1 (single local instance) | Up to [10] `WORKER_ID`s on a shared board | Custom / unlimited |
| **Proposed price** | **$29 / month** (or **$290 / yr**) | **$99 / seat / month** (annual discount) | **Custom** (from ~$[1,500]/mo or annual contract) |

### What gates each tier

**Solo — the standalone product (Release 1).** Everything one person on one machine needs:
- Full plan -> build -> qa -> accept -> review pipeline on a Kanban board
- **Worktree isolation** per task and the **human-approved merge gate**
- **Local code embeddings** (index stays on your disk) and file browser / AI edits
- **Cost capture + budgets** (per-task and per-day caps) and usage-aware pause/auto-resume
- Agent sandbox profiles (strict / standard / dangerous)
- SQLite backend only; single `WORKER_ID`; local bearer-token auth
- Community support

**Team — unlocks the fleet (Release 2).** Everything in Solo, plus the multi-machine swarm:
- **Fleet mode**: shared task board on the Postgres backend (`configureBackend`), N machines each
  running an orchestrator, all pulling from one queue
- Multi-`WORKER_ID` registry, heartbeat, stale-worker reclaim, per-project merge lock
- **Fleet-wide cost budgets** (summed across the shared DB) and per-worker capacity caps
- Workers panel (who's alive, what they're chewing), fleet 429 back-off
- Bearer auth + TLS guidance for private-network (Tailscale/WireGuard) fleets
- Email support
- *Gate:* the Postgres/fleet backend and multi-worker registration are license-feature-gated;
  Solo is SQLite + single worker.

**Enterprise — scale, hosting, and assurances (Release 2–3).** Everything in Team, plus:
- Unlimited / custom seats and workers
- **Engine adapters** (Release 3): run Codex/Gemini/Copilot/Aider agents per role (e.g., Architect
  on Claude, QA on Gemini) for cost control
- **Hosted-or-supported** option: we help you stand it up, or run a managed instance in your cloud
- Priority support with an SLA, security review support, onboarding
- Custom license terms, invoicing, SSO/audit expectations as the multi-user layer lands

---

## Price rationale and benchmarks

Our pricing is anchored to what teams already pay for AI coding tools, then positioned on a clear
difference: **Piranha is an orchestration layer you self-host and that you point at model
subscriptions/credits you already own.** We are not reselling tokens, so we price the
*orchestrator*, below the per-seat cost of a hosted autonomous agent and in the neighborhood of
premium IDE-assistant seats.

**Benchmarks (verify before publishing):**

- **GitHub Copilot** — Business **$19/user/mo**, Enterprise **$39/user/mo** (both moved to
  usage-based billing with included AI-credit allotments as of June 1, 2026). Source: GitHub
  Copilot Plans & pricing and the GitHub Blog "Copilot is moving to usage-based billing"
  (accessed 2026-07-12).
- **Cursor** — Business **$40/seat/mo** (Pro is $20; the $20 premium buys admin/SSO/analytics),
  20% annual discount. Source: cursor.com/pricing and 2026 pricing guides (accessed 2026-07-12).
- **Devin (Cognition)** — Core from **~$20/mo** usage-based; **Team ~$500/mo** for 250 ACUs at
  ~$2/ACU (some newer structures cite ~$80/mo base + ~$40/seat). Source: devin.ai/pricing and
  2026 pricing breakdowns (accessed 2026-07-12).

**How Piranha sits against them:**

- **Solo at $29/mo** sits just above a Cursor/Copilot individual seat, justified because Piranha
  is not one assistant — it runs a *swarm* through a full review pipeline unattended, and the
  cost caps mean you control the model spend it drives. It undercuts Devin's entry while doing
  something Devin doesn't: keeping everything on your own machine.
- **Team at $99/seat/mo** is priced above Cursor Business ($40) and Copilot Enterprise ($39)
  because the unit of value is different — a seat here commands a *fleet of orchestrated agents
  across multiple machines*, not a single in-IDE helper. It is still an order of magnitude under
  Devin's $500/mo team anchor, which is the honest comparison for "autonomous agents doing tasks
  end-to-end." Positioning: *Devin-class autonomy, self-hosted, at a fraction of the price,
  because you bring your own model subscription.*
- **Enterprise custom** captures hosting/support/engine-adapter value and the accounts that need
  SSO, SLAs, and procurement — standard for this segment.

**Pricing risk to flag:** because Piranha drives agents against the customer's *own* Claude/model
plan, the customer's true cost = Piranha seat + their model usage. The pricing page must be
explicit that model/API costs are separate (and that Piranha's built-in **cost budgets** are the
feature that keeps that bill bounded) so the total-cost comparison against all-inclusive tools
like Devin is honest.

---

## Free trial vs. open-core funnel (the strategic question)

The Owner also plans a **separate open-source "lite" product**. That changes the top-of-funnel
math and needs a deliberate choice. Framing for the decision:

**Option A — Time-limited free trial of the commercial product.**
- 14-day full-feature trial (Team-tier features unlocked), issued as a short-expiry license key
  with a generous `grace_days` — trivial to implement with the Ed25519 token model (just a near
  `exp`). See `licensing-model.md`.
- Pro: shows the real product, including fleet mode; standard SaaS motion.
- Con: self-hosted trials are higher-friction (they have to install and run it) and easier to
  quietly keep using past expiry (mitigated, not eliminated, by the license checks).

**Option B — Open-core funnel via the OSS lite edition.**
- The open-source lite edition is the top of funnel: single-agent or capped, no fleet, no
  Postgres backend, no priority support — genuinely useful, but the paid tiers gate the
  multiplying features (the swarm, the fleet, budgets-at-scale, engine adapters).
- Pro: the lite edition does the marketing and builds trust/community; conversion is "you already
  run and like the lite version, now scale it." Strong fit for a self-hosted developer tool.
- Con: risk of cannibalization if the free line is drawn too generously; needs a crisp,
  defensible gate between lite and Solo.

**Recommendation:** **do both, layered — lead with the open-core funnel, offer a trial as the
closer.**
1. **OSS lite** is the primary acquisition channel: capped, single-machine, no fleet — enough to
   fall in love with, not enough to run a team on. Draw the gate at **fleet + team-scale
   features**, which are exactly the Release 2 capabilities the Team tier sells; that line is
   natural and hard to argue with.
2. **Solo ($29)** is the "I want the full standalone product / support / no caps" upgrade for
   individuals who've outgrown lite.
3. **Trial** exists as a **short full-feature Team key** for teams evaluating the fleet before
   they commit seats — used as a sales closer, not the main funnel, since the OSS edition already
   does top-of-funnel work.

The clean gate for the lite/paid boundary is the same one the license model already enforces:
**single `WORKER_ID`, SQLite only, no fleet** = free/lite; **multi-worker Postgres fleet** = paid.
That makes the open-core line and the license-feature line the same line, which keeps both the
product story and the enforcement simple.

---

## Add-ons / notes for the Owner (not final page copy)

- Annual billing at ~2 months free (≈17–20% off) to match Cursor's annual-discount norm.
- Consider a founder/early-adopter lifetime or discounted cohort for the Solo tier to seed
  reviews and the demo-GIF-driven launch (SPEC P0.6).
- Revisit all three anchors after the first ~20 paying customers; AI-tool pricing benchmarks in
  this doc will have moved.

---

### Sources (accessed 2026-07-12)

- [GitHub Copilot · Plans & pricing](https://github.com/features/copilot/plans)
- [GitHub Copilot is moving to usage-based billing — GitHub Blog](https://github.blog/news-insights/company-news/github-copilot-is-moving-to-usage-based-billing/)
- [Cursor · Pricing](https://cursor.com/pricing)
- [Plans and Pricing | Devin](https://devin.ai/pricing/)
- [Devin AI Pricing 2026 — Costbench](https://costbench.com/software/ai-coding-assistants/devin-ai/)
