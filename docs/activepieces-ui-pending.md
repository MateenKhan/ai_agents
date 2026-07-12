# Activepieces Embedded Workflow Builder UI Plan

> **Note:** All external links below were fetched and verified against the official Activepieces documentation (activepieces.com/docs), the official pieces catalog (activepieces.com/pieces), the official GitHub repository, the npm registry, and the official React Flow documentation on 2026-07-12. The embed SDK details reflect SDK version **0.13.0** (released 07/09/2026 per the [SDK changelog](https://www.activepieces.com/docs/embedding/sdk-changelog)).

## 1. Git Worktree & Subagent Assignment
- **Assigned Role:** TBD
- **Git Worktree Directory:** TBD
- **Status:** PENDING EXECUTION

---

## 2. Problem Statement
- Activepieces integration today is **backend-only** — just a webhook URL storage table (`activepieces_webhooks` in `agentic/db/migrations.ts`, mirrored in `db/activepieces_migration.sql`) and an agent tool (`TRIGGER_ACTIVEPIECES_WEBHOOK_SCHEMA` in `agentic/types.ts`).
- There is **NO embedded UI** for users to visually build automations, connect OAuth accounts (Gmail, Slack, GitHub), or configure multi-step workflows.
- Without the visual builder, a user CANNOT:
  - Connect their Gmail, Slack, Notion, or any service via OAuth
  - Drag-and-drop automation steps (trigger → filter → action)
  - Configure credentials, API keys, or piece connections
  - Test or debug workflow runs
- This makes the current Activepieces integration a dead feature.

---

## 3. Proposed Solution — Full Comparison

Activepieces is open-core: the **core is MIT-licensed**, but everything under `packages/ee` and `packages/server/api/src/app/ee` is under a separate **Commercial License**, and the [license page](https://www.activepieces.com/docs/about/license) states plainly: *"Using the enterprise features (under the packages/ee and packages/server/api/src/app/ee folder) with a self-hosted instance requires an Activepieces license."*

**The single most important research finding:** the entire embedding feature set — the [embed SDK](https://www.activepieces.com/docs/embedding/overview), [JWT user provisioning](https://www.activepieces.com/docs/embedding/provision-users), [embedding configuration / allowed iframe origins](https://www.activepieces.com/docs/embedding/configure-embedding), [piece filtering for embedded users](https://www.activepieces.com/docs/embedding/customize-pieces), and [predefined connections](https://www.activepieces.com/docs/embedding/predefined-connection) — is explicitly marked **"Enterprise feature"** in the official docs. None of it is in the MIT Community edition. The original sketch of this plan ("Activepieces is fully open-source (MIT) and can be embedded") was **wrong as stated**, and the comparison below corrects it.

### 3.1 Option A: Embed Activepieces (self-hosted instance + iframe/SDK)

Run Activepieces as a Docker service next to Piranha and surface its builder UI under a Piranha `/automations` route. This option splits into three sub-variants with very different licensing footprints:

| Variant | What you get | License / cost | Viability for Piranha |
| --- | --- | --- | --- |
| **A1 — Community Edition, linked UI (no embed SDK)** | Self-hosted MIT instance ([docker](https://www.activepieces.com/docs/install/options/docker) or [docker-compose](https://www.activepieces.com/docs/install/options/docker-compose)); Piranha's `/automations` page links to (or attempts to iframe) the stock Activepieces UI; the user logs into Activepieces once, manually. Full builder, full pieces catalog, OAuth connections, webhook triggers. | **Free.** MIT permits unlimited commercial self-hosting. | **High for today's Piranha.** Piranha is a local-first, single-user tool (docker compose bound to 127.0.0.1), so "one manual Activepieces account on localhost" is an acceptable UX. No white-labeling, no auto-provisioning. Whether the CE UI allows itself to be iframed at all must be spiked (the allowed-origins mechanism is part of the enterprise embedding config); the safe fallback is a full-page link/new-tab. |
| **A2 — Self-hosted Enterprise Edition + embed SDK** | Everything in A1 plus the real embedding path: JWT auto-provisioning of users, `activepieces.configure()` SDK with white-label options, per-user project scoping via `externalProjectId`, piece filtering, predefined connections, [multi-project REST API keys](https://www.activepieces.com/docs/endpoints/overview). Activated via `AP_EDITION=ee` and a license key entered in Platform Admin → Setup → License Keys ([enterprise license docs](https://www.activepieces.com/docs/install/configure-operate/enterprise-license)). | **Paid, contact-sales.** The [pricing page](https://www.activepieces.com/pricing) lists no self-hosted enterprise price — "Ultimate" is "Annual contract / Custom". Trial keys exist, but on trial expiry *"all enterprise features will be shut down… any user other than the platform admin will be deactivated, and your private pieces will be deleted."* Requires PostgreSQL + Redis. | **Correct long-term path if Piranha becomes multi-user/SaaS**, but an annual custom-priced contract is disproportionate for a local single-user dev tool today. |
| **A3 — Activepieces Cloud (embed from cloud.activepieces.com)** | Same embed SDK, hosted by Activepieces; extra setup steps (embed subdomain + DNS verification) per [configure embedding](https://www.activepieces.com/docs/embedding/configure-embedding). | Cloud plans: "Standard — Free, then $5 per active flow per month"; embedding sits in the custom-priced tier ([pricing](https://www.activepieces.com/pricing)). | **Low.** Piranha is local-first; shipping user automation data to a third-party cloud contradicts the product's 127.0.0.1-only security posture (see `docker-compose.yml` header comments). |

**Option A strengths (all variants):**
- **755-piece catalog for free** — the [official pieces catalog](https://www.activepieces.com/pieces) currently shows 755 pieces across ~17 categories; OAuth flows, token refresh, credential encryption (`AP_ENCRYPTION_KEY`), retries, and versioning are all handled by the platform.
- **Webhook interop already matches Piranha's existing backend integration:** every flow with a webhook trigger gets a unique URL, `/sync` suffix gives synchronous request/response (timeout `AP_WEBHOOK_TIMEOUT_SECONDS`, default 30s), and the [Webhook piece](https://www.activepieces.com/pieces/webhook) provides Catch Webhook / Return Response / Respond and Wait. Piranha's existing `trigger_activepieces_webhook` agent tool keeps working unchanged.
- **Project/tenant scoping is built in:** every Activepieces project isolates its own flows, connections, and tables ([project structure docs](https://www.activepieces.com/docs/admin-guide/guides/structure-projects)); with EE, the JWT's `externalProjectId` claim auto-creates and scopes a project per Piranha project, and the [REST API](https://www.activepieces.com/docs/endpoints/overview) (Platform/EE-only API keys) can create flows ([POST /v1/flows](https://www.activepieces.com/docs/endpoints/flows/create)) and upsert connections ([POST /v1/app-connections](https://www.activepieces.com/docs/endpoints/connections/upsert)) programmatically.
- **Self-hosted OAuth is not painful:** with `AP_CLOUD_AUTH_ENABLED=true` (the default), a self-hosted instance uses Activepieces-hosted OAuth apps, so users do not have to register their own Google/Slack/GitHub OAuth applications to connect accounts ([environment variables](https://www.activepieces.com/docs/install/reference/environment-variables)).

**Option A weaknesses:**
- A second server-side stack (Node + Postgres + Redis for production shape; PGLite + in-memory queue for the single-container image, which the docs say is *"only meant for personal use or testing"* — acceptable for Piranha's local single-user deployment, and consistent with how Piranha already ships).
- Anything beyond "one local account, stock UI" is paywalled (see licensing caveats below).

### 3.2 Option B: Build a Custom Visual Workflow Builder (@xyflow/react + pieces as npm packages)

Piranha already ships `@xyflow/react` for the `/canvas` Architecture Canvas (`src/pages/canvas/CanvasPage.tsx`), so rendering a drag-and-drop flow editor is genuinely cheap — [React Flow](https://reactflow.dev/learn) is exactly the right library for the canvas surface. The fatal cost is everything *behind* the canvas. An honest bill of materials:

| Subsystem Option B must build | Why it cannot be skipped | What Activepieces provides instead |
| --- | --- | --- |
| **Piece execution runtime** | Pieces *are* published as npm packages (verified: [`@activepieces/piece-gmail`](https://registry.npmjs.org/@activepieces/piece-gmail) v0.12.8 depends on `@activepieces/pieces-framework`, `@activepieces/pieces-common`, `@activepieces/shared`), but they are **declarative definitions executed by the Activepieces engine**, not standalone clients. Actions/triggers receive a framework `context` (auth, store, webhook URL, propsValue) that something must construct and honor ([trigger reference](https://www.activepieces.com/docs/build-pieces/piece-reference/triggers/overview), [building pieces overview](https://www.activepieces.com/docs/build-pieces/building-pieces/overview)). | The engine/worker (`AP_WORKER_CONCURRENCY`, sandbox modes via `AP_EXECUTION_MODE`). |
| **OAuth2 app + token lifecycle** | Each OAuth piece needs a registered OAuth app per provider (Google, Slack, GitHub, Notion…), the authorize/callback dance, encrypted token storage, and refresh-token rotation. | Hosted OAuth apps (`AP_CLOUD_AUTH_ENABLED`) + encrypted connection vault (`AP_ENCRYPTION_KEY`). |
| **Trigger infrastructure** | Polling triggers need a scheduler with per-trigger dedupe state; webhook triggers need public URL routing, registration/renewal against third-party APIs, and payload storage. | Redis-backed queue, webhook endpoints under `AP_FRONTEND_URL`, the framework `store`. |
| **Dynamic property resolution** | Piece config UIs are server-driven: dropdowns like "choose a Slack channel" execute piece code with live credentials to populate options. A custom builder must host that server-side execution too. | Built into builder + engine. |
| **Run history, retries, logs, versioning** | Users must debug failing automations; flows must survive piece version bumps. | Runs UI, flow versioning, `AP_EXECUTION_DATA_RETENTION_DAYS`. |

Bottom line: Option B re-implements roughly the entire Activepieces server (23.2k-star codebase, ~60% community-contributed pieces per the [GitHub repo](https://github.com/activepieces/activepieces)) to avoid an iframe. Realistic effort is **months of engineering for 5 connectors** versus **days for 755**. The npm packages are only useful if you also run their engine — at which point you are running Activepieces anyway.

### 3.3 Decision Recommendation

**Choose Option A, variant A1 (Community Edition, free, MIT) now; treat A2 (Enterprise embed SDK) as a paid upgrade decision gated on Piranha going multi-user.**

1. **A1 fits Piranha's actual deployment model.** Piranha is a single-user, localhost-only tool. One local Activepieces account is a one-time 30-second setup; JWT auto-provisioning solves a multi-tenant problem Piranha does not have yet.
2. **A1 is legally clean for a proprietary/commercial Piranha.** The MIT core imposes no obligations on Piranha's own proprietary code; running an unmodified Community container side-by-side (orchestrated by `docker-compose.yml`) creates no derivative-work or copyleft exposure. What Piranha must NOT do: enable `packages/ee` code paths without a license, strip Activepieces branding from the CE UI, or resell CE as "Piranha Automations Cloud" hosted multi-tenant — the last one is legal under MIT but crosses into exactly the use case Activepieces monetizes, and would force the A2 conversation anyway.
3. **Budget the licensing caveat explicitly:** if Piranha is ever sold as hosted/multi-tenant software with seamless in-app automations (no visible Activepieces login), that REQUIRES the Enterprise embedding features and therefore a **custom-priced annual contract with Activepieces sales** (no public price; [pricing](https://www.activepieces.com/pricing), [license](https://www.activepieces.com/docs/about/license)). This line item must appear in any commercial planning for Piranha.
4. **Reject Option B** except as a far-future escape hatch. Re-validate only if the Activepieces licensing terms become hostile or the project stalls.

**Phase 1 spike must answer one open question:** whether a Community Edition instance can be iframed from `http://localhost:6951` (the docs gate "Allowed Websites" origin config behind the enterprise embedding settings; CE may or may not send restrictive frame headers). If iframing is blocked, `/automations` renders a managed launcher (status, flow list via webhook registry, "Open Builder" new-tab button) instead of an inline iframe — the feature remains fully usable.

---

## 4. User Story
> "I want to click a trigger like 'New Gmail Email', connect my Google account via OAuth, add a filter step, then send a Slack message — all from inside Piranha without leaving the app."

---

## 5. Reference: Embedding SDK, Provisioning, and Deployment Options

### 5.A Embed SDK `activepieces.configure()` options (22 options)

Source: the official [Embed Builder docs](https://www.activepieces.com/docs/embedding/embed-builder), SDK 0.13.0 (`<script src="https://cdn.activepieces.com/sdk/embed/0.13.0.js">`, no `async`/`defer`). `configure()` returns a promise that resolves after authentication completes. **Enterprise feature** — applies to variant A2/A3 only.

| Option | Type | What it does | Docs |
| --- | --- | --- | --- |
| **instanceUrl** (required) | string | URL of your Activepieces instance the iframe loads from (e.g. `http://localhost:8080`). | [docs](https://www.activepieces.com/docs/embedding/embed-builder) |
| **jwtToken** (required) | string | Short-lived provisioning JWT generated by your backend; exchanged for a longer-lived session token. | [docs](https://www.activepieces.com/docs/embedding/provision-users) |
| **prefix** | string | URL prefix so embedded routes nest under your host app's routing (e.g. `/automations`). | [docs](https://www.activepieces.com/docs/embedding/embed-builder) |
| **embedding.containerId** | string | ID of the HTML element that hosts the builder iframe. | [docs](https://www.activepieces.com/docs/embedding/embed-builder) |
| **navigation.handler** | `({route}) => void` | Callback fired on every route change inside the iframe (route may include search params). | [docs](https://www.activepieces.com/docs/embedding/navigation) |
| **embedding.builder.disableNavigation** | boolean \| `'keep_home_button_only'` | Hides folder name and home/delete options in the builder header (or keeps only the home button). | [docs](https://www.activepieces.com/docs/embedding/embed-builder) |
| **embedding.builder.hideFlowName** | boolean | Hides the flow name and its actions dropdown in the builder header. | [docs](https://www.activepieces.com/docs/embedding/embed-builder) |
| **embedding.builder.homeButtonClickedHandler** | `() => void` | Replaces the default home-button navigation with your own handler. | [docs](https://www.activepieces.com/docs/embedding/embed-builder) |
| **embedding.builder.homeButtonIcon** | `'logo'` \| `'back'` | Switches the home button icon (`back` also removes the tooltip). | [docs](https://www.activepieces.com/docs/embedding/embed-builder) |
| **embedding.dashboard.hideSidebar** | boolean | Hides the dashboard sidebar. | [docs](https://www.activepieces.com/docs/embedding/embed-builder) |
| **embedding.dashboard.hideFlowsPageNavbar** | boolean | Hides the flows/issues/runs navigation bar on the flows page. | [docs](https://www.activepieces.com/docs/embedding/embed-builder) |
| **embedding.dashboard.hidePageHeader** | boolean | Removes the page header section in the dashboard. | [docs](https://www.activepieces.com/docs/embedding/embed-builder) |
| **embedding.hideFolders** | boolean | Removes folder functionality from flows table and builder. | [docs](https://www.activepieces.com/docs/embedding/embed-builder) |
| **embedding.hideTables** | boolean | Hides the Tables UI (the Table piece inside flows stays available). | [docs](https://www.activepieces.com/docs/embedding/embed-builder) |
| **embedding.hideActiveUsers** | boolean | Hides presence avatars; the embedded user is also hidden from other collaborators. | [docs](https://www.activepieces.com/docs/embedding/embed-builder) |
| **embedding.hideGlobalSearch** | boolean | Disables the search button and the CMD+K / Ctrl+K command palette (new in SDK 0.13.0). | [docs](https://www.activepieces.com/docs/embedding/sdk-changelog) |
| **embedding.hideExportAndImportFlow** | boolean | Removes flow export/import options. | [docs](https://www.activepieces.com/docs/embedding/embed-builder) |
| **embedding.hideDuplicateFlow** | boolean | Removes the flow duplication option. | [docs](https://www.activepieces.com/docs/embedding/embed-builder) |
| **embedding.styling.fontUrl** | string | Custom font stylesheet URL (must be set together with `fontFamily`; default Roboto). | [docs](https://www.activepieces.com/docs/embedding/embed-builder) |
| **embedding.styling.fontFamily** | string | Font family name applied inside the embed (requires `fontUrl`). | [docs](https://www.activepieces.com/docs/embedding/embed-builder) |
| **embedding.styling.mode** | `'light'` \| `'dark'` | Theme mode of the embedded UI. | [docs](https://www.activepieces.com/docs/embedding/embed-builder) |
| **embedding.locale** | ISO 639-1 string | UI language: `en`, `nl`, `de`, `fr`, `es`, `ja`, `zh`, `pt`, `zh-TW`, `ru`. | [docs](https://www.activepieces.com/docs/embedding/embed-builder) |

### 5.B Embed SDK methods beyond `configure()` (3 methods)

| Method | Signature | What it does | Docs |
| --- | --- | --- | --- |
| **connect** | `activepieces.connect({pieceName, connectionName?, newWindow?})` → `Promise<{connection?: {id, name}}>` | Opens the connection (OAuth) dialog for one piece inside your SaaS; `connectionName` becomes the connection's externalId/display name; `connection` is undefined if the user cancels. Requires Activepieces ≥ 0.34.5, SDK ≥ 0.3.2. | [docs](https://www.activepieces.com/docs/embedding/embed-connections) |
| **navigate** | `activepieces.navigate({route})` | Drives the embedded UI to `/flows`, `/flows/{flowId}`, `/runs`, `/runs/{runId}`, `/connections`, `/tables`, `/tables/{tableId}`, `todos`, `todos/{todoId}`. Chain after `configure()` resolves. | [docs](https://www.activepieces.com/docs/embedding/navigation) |
| **request** | `activepieces.request({path, method, body?, queryParams?})` | Calls the instance REST API as the embedded user; SDK prepends `{instanceUrl}/api/v1`. Supports GET/POST/PUT/DELETE/OPTIONS/PATCH/HEAD. Requires Activepieces ≥ 0.34.5, SDK ≥ 0.3.6. | [docs](https://www.activepieces.com/docs/embedding/sdk-server-requests) |

Related embedding capabilities, each with its own doc page: [embeddable MCP server](https://www.activepieces.com/docs/embedding/embeddable-mcp) (embedded users authorize AI tools to run their project's flows via a popup), [predefined connections](https://www.activepieces.com/docs/embedding/predefined-connection) (platform-admin global connections with scope `PLATFORM`, matched to projects by an externalId naming convention such as `gelato_org_1234`, so `requireAuth:false` pieces need no user credential entry), and [piece filtering](https://www.activepieces.com/docs/embedding/customize-pieces) (tag pieces in Platform Admin → Setup → Pieces, then filter per token).

### 5.C JWT provisioning claims (13 payload claims + `kid` header)

Source: [Provision Users docs](https://www.activepieces.com/docs/embedding/provision-users). **Enterprise feature.** Keys are generated in Platform Settings → Signing Keys; tokens are signed **RS256** with the private key, with the signing key ID in the JWT header `kid`. The docs stress a very short `exp` because the JWT is exchanged for a longer-lived token.

| Claim | What it does |
| --- | --- |
| `version` | Provisioning token schema version — currently `"v3"`. |
| `externalUserId` | Your (Piranha's) unique user ID; Activepieces creates or logs in the matching user. |
| `externalProjectId` | Your project ID; Activepieces creates or reuses the matching isolated project (this is the tenant-scoping mechanism). |
| `firstName` / `lastName` | Display name of the provisioned user. |
| `role` | Project role of the embedded user: `EDITOR`, `VIEWER`, or `ADMIN`. |
| `exp` | Unix expiry timestamp — keep very short. |
| `piecesFilterType` | `"NONE"` (all pieces) or `"ALLOWED"` (restrict to tagged pieces). |
| `piecesTags` | With `"ALLOWED"`: piece tags to sync into the token's project ([customize pieces](https://www.activepieces.com/docs/embedding/customize-pieces)). |
| `tasks` | Task (execution step) limit for the project. |
| `aiCredits` | AI credit allocation for the project. |
| `concurrencyPoolKey` / `concurrencyPoolLimit` | Optional shared concurrency pool assignment and its limit. |

### 5.D Self-hosted deployment options (12 options)

Source: [install overview](https://www.activepieces.com/docs/install/overview).

| Option | What it does | Docs |
| --- | --- | --- |
| **Docker (single container)** | `docker run -d -p 8080:80 -v ~/.activepieces:/root/.activepieces -e AP_REDIS_TYPE=MEMORY -e AP_DB_TYPE=PGLITE -e AP_FRONTEND_URL="http://localhost:8080" activepieces/activepieces:latest` — PGLite embedded Postgres + in-memory queue; docs: personal use/testing only. | [docs](https://www.activepieces.com/docs/install/options/docker) |
| **Docker Compose** | Production-recommended: Activepieces + PostgreSQL + Redis; clone repo, `sh tools/deploy.sh` to generate env, `docker compose -p activepieces up`; port 8080. | [docs](https://www.activepieces.com/docs/install/options/docker-compose) |
| **Helm (Kubernetes)** | Helm chart deployment for k8s/enterprise shapes. | [docs](https://www.activepieces.com/docs/install/overview) |
| **AWS (Pulumi)** | Infrastructure-as-code deployment to AWS. | [docs](https://www.activepieces.com/docs/install/overview) |
| **GCP (VM template)** | Google Cloud VM-based deployment. | [docs](https://www.activepieces.com/docs/install/overview) |
| **Railway / Easypanel / Elestio / PikaPods / RepoCloud / Zeabur** | One-click PaaS deployments (several community-maintained). | [docs](https://www.activepieces.com/docs/install/overview) |
| **Activepieces Cloud** | Managed hosting — "the fastest option" per the docs; not local-first. | [docs](https://www.activepieces.com/docs/install/overview) |

### 5.E Key environment variables (20 selected)

Source: the official [environment variables reference](https://www.activepieces.com/docs/install/reference/environment-variables) (the full reference lists many more; these are the ones Piranha's compose service will touch).

| Variable | What it does |
| --- | --- |
| `AP_FRONTEND_URL` | Public URL used to build redirect URLs and **webhook URLs** — required for webhook triggers to work. |
| `AP_ENCRYPTION_KEY` | 32-char hex key encrypting stored connections (`openssl rand -hex 16`). |
| `AP_JWT_SECRET` | Hex key signing the instance's own JWTs (`openssl rand -hex 32`). |
| `AP_DB_TYPE` | `POSTGRES` (production) or `PGLITE` (embedded, single-container). |
| `AP_POSTGRES_HOST` / `AP_POSTGRES_PORT` / `AP_POSTGRES_DATABASE` / `AP_POSTGRES_USERNAME` / `AP_POSTGRES_PASSWORD` | PostgreSQL connection settings. |
| `AP_REDIS_TYPE` | `STANDALONE` (default), `SENTINEL`, or `MEMORY` (single-container mode). |
| `AP_REDIS_HOST` / `AP_REDIS_PORT` / `AP_REDIS_PASSWORD` | Redis queue connection settings. |
| `AP_EXECUTION_MODE` | Flow sandboxing strategy (default `UNSANDBOXED`; EE requires a sandboxed mode). |
| `AP_WORKER_CONCURRENCY` | Concurrent jobs per worker (default 5). |
| `AP_FLOW_TIMEOUT_SECONDS` | Maximum flow runtime (default 600). |
| `AP_WEBHOOK_TIMEOUT_SECONDS` | Synchronous (`/sync`) webhook response timeout (default 30). |
| `AP_CLOUD_AUTH_ENABLED` | Default `true`: use Activepieces-hosted OAuth apps so self-hosters skip registering their own Google/Slack/GitHub OAuth applications. |
| `AP_ALLOWED_EMBED_ORIGINS` | Pre-seeds iframe-allowed origins on self-hosted instances (merges with UI config) — embedding/EE context. |
| `AP_EDITION` | Set to `ee` to enable Enterprise Edition (license key then activated in Platform Admin → Setup → License Keys). |

### 5.F OAuth pieces Piranha names in the user story (6 pieces, of a 755-piece catalog)

Source: the [official pieces catalog](https://www.activepieces.com/pieces) ("Showing 755 pieces", fetched 2026-07-12; piece pages follow `activepieces.com/pieces/{name}`).

| Piece | What it does | Docs link |
| --- | --- | --- |
| **Gmail** | OAuth2 Gmail automation — triggers: New Email, New Labeled Email, New Attachment, New Label; actions: Send Email, Reply, Create Draft Reply, Request Approval in Email, Get/Find Email, Custom API Call. | [pieces/gmail](https://www.activepieces.com/pieces/gmail) |
| **Slack** | OAuth2 Slack automation — triggers include New Message Posted to Channel, New Direct Message, New Mention, New Reaction; actions include Send Message to User/Channel, Request Approval, Upload File, Search Messages, Create Channel, Update/Delete Message. | [pieces/slack](https://www.activepieces.com/pieces/slack) |
| **GitHub** | OAuth2 GitHub automation — 13 triggers (New PR, New Issue, Push, New Star, New Release, New Commit…) and 19 actions (Create Issue, Create PR Review Comment, Add Labels, Create/Delete Branch, Raw GraphQL Query, Create Gist…). | [pieces/github](https://www.activepieces.com/pieces/github) |
| **Notion** | Notion workspace automation — triggers: New/Updated Database Item, New Comment, Updated Page; actions: Create/Update/Find Database Item, Create Page, Append to Page, Add Comment, Archive/Restore Item. | [pieces/notion](https://www.activepieces.com/pieces/notion) |
| **Discord** | Bot/webhook-based Discord automation — triggers: New Message, New Member; actions: Send Message (bot or webhook), Request Approval in Channel, role/channel/member management, bans. | [pieces/discord](https://www.activepieces.com/pieces/discord) |
| **Webhook** | The interop piece Piranha's backend already targets — trigger: Catch Webhook (any HTTP method, unique URL, `/sync` suffix for synchronous replies); actions: Return Response, Respond and Wait for Next Webhook. | [pieces/webhook](https://www.activepieces.com/pieces/webhook) |

---

## 6. Phased Delivery Plan (Piranha file paths)

**Phase 0 — Compose service + spike (unblocks everything).**
1. Add an `activepieces` service to `docker-compose.yml`: image `activepieces/activepieces:latest`, port `127.0.0.1:8080:80`, volume `activepieces-data:/root/.activepieces`, env `AP_DB_TYPE=PGLITE`, `AP_REDIS_TYPE=MEMORY`, `AP_FRONTEND_URL=http://localhost:8080`, generated `AP_ENCRYPTION_KEY`/`AP_JWT_SECRET` — keeping Piranha's 127.0.0.1-only port policy documented at the top of that file.
2. Spike: can `http://localhost:8080` be iframed from `http://localhost:6951` on a Community instance? Record the answer in this doc; it selects iframe vs. launcher UI in Phase 1.

**Phase 1 — `/automations` route.**
3. Create `src/pages/automations/AutomationsPage.tsx`; register `<Route path="/automations" element={<AutomationsPage />} />` in `src/main.tsx` (next to the existing `/canvas` route) and add an Automations tab to `src/components/navigation/StudioNavbar.tsx`.
4. The page renders: instance health (ping `http://localhost:8080`), the per-project registered webhook list from the existing `activepieces_webhooks` table, and either the inline iframe or an "Open Builder" new-tab launcher per the Phase 0 spike.

**Phase 2 — Project → flow mapping in Piranha's DB.**
5. Add an `activepieces_flows` table in `agentic/db/migrations.ts` (following the existing `ACTIVEPIECES_WEBHOOKS` column-list pattern there) and mirror it in `db/activepieces_migration.sql`: `id`, `projectId`, `flowId`, `flowDisplayName`, `webhookUrl`, `syncMode` (plain vs `/sync`), `createdAt` — plus indexes on `projectId`.
6. Expose CRUD endpoints for it in `db/server.ts`, so the `/automations` page scopes flows to the active Piranha project (Community edition has no per-tenant API, so Piranha's own table is the project-scoping layer under variant A1).

**Phase 3 — Agent integration.**
7. Extend `agentic/types.ts` beside `TRIGGER_ACTIVEPIECES_WEBHOOK_SCHEMA` with a `list_activepieces_flows` tool backed by the Phase 2 table, so agents can discover and fire the current project's automations instead of needing a raw URL.
8. Support synchronous flows: when `syncMode` is set, call the `/sync` webhook URL and return the flow's response body to the agent (30s default timeout, `AP_WEBHOOK_TIMEOUT_SECONDS`).

**Phase 4 — Enterprise upgrade path (deferred; requires a paid Activepieces license).**
9. If/when Piranha goes multi-user: flip the compose service to `AP_EDITION=ee` + Postgres/Redis, activate the license key, generate a signing key, add a JWT-provisioning endpoint to `db/server.ts` (RS256, claims per section 5.C, `externalProjectId` = Piranha `projects.id`), and replace the Phase 1 iframe/launcher with the embed SDK (`configure`/`connect`/`navigate` per sections 5.A–5.B), including `piecesFilterType` tagging and white-label styling.

---

## 7. Sources

All fetched and verified 2026-07-12 (official sources only): the Activepieces embedding docs ([overview](https://www.activepieces.com/docs/embedding/overview), [configure](https://www.activepieces.com/docs/embedding/configure-embedding), [provision users](https://www.activepieces.com/docs/embedding/provision-users), [embed builder](https://www.activepieces.com/docs/embedding/embed-builder), [connections](https://www.activepieces.com/docs/embedding/embed-connections), [predefined connections](https://www.activepieces.com/docs/embedding/predefined-connection), [customize pieces](https://www.activepieces.com/docs/embedding/customize-pieces), [navigation](https://www.activepieces.com/docs/embedding/navigation), [server requests](https://www.activepieces.com/docs/embedding/sdk-server-requests), [embeddable MCP](https://www.activepieces.com/docs/embedding/embeddable-mcp), [SDK changelog](https://www.activepieces.com/docs/embedding/sdk-changelog)); install docs ([overview](https://www.activepieces.com/docs/install/overview), [docker](https://www.activepieces.com/docs/install/options/docker), [docker-compose](https://www.activepieces.com/docs/install/options/docker-compose), [environment variables](https://www.activepieces.com/docs/install/reference/environment-variables), [enterprise license](https://www.activepieces.com/docs/install/configure-operate/enterprise-license)); [license](https://www.activepieces.com/docs/about/license) and [pricing](https://www.activepieces.com/pricing); API docs ([overview](https://www.activepieces.com/docs/endpoints/overview), [create flow](https://www.activepieces.com/docs/endpoints/flows/create), [upsert connection](https://www.activepieces.com/docs/endpoints/connections/upsert)); [project structure](https://www.activepieces.com/docs/admin-guide/guides/structure-projects); developer docs ([building pieces](https://www.activepieces.com/docs/build-pieces/building-pieces/overview), [triggers reference](https://www.activepieces.com/docs/build-pieces/piece-reference/triggers/overview)); the [pieces catalog](https://www.activepieces.com/pieces) and the six piece pages linked in section 5.F; the [activepieces GitHub repository](https://github.com/activepieces/activepieces); the npm registry entry for [`@activepieces/piece-gmail`](https://registry.npmjs.org/@activepieces/piece-gmail); and the [React Flow documentation](https://reactflow.dev/learn).
