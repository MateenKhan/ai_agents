# Piranha — Licensing & Activation Model (Design)

> **Design document, not code.** This describes how offline-friendly license keys should work for
> Piranha and how they map onto seams that already exist in the codebase (the planned db-server
> bearer auth and the fleet `WORKER_ID` model). No licensing code should be built from this until
> the Owner signs off on the approach and the build-vs-buy verdict in the last section.

---

## 1. Goals and constraints

Piranha is **self-hosted and single-user local today**, with fleet/team mode planned for
Releases 2–3 (see `docs/SPEC.md`). That shapes every requirement:

- **Offline-friendly.** A self-hosted instance must validate its license **without phoning home**.
  Customers run Piranha on private networks, air-gapped boxes, and Tailscale/WireGuard fleets
  (SPEC Release 2 Phase 3). A licensing scheme that requires a callback to our servers on every
  boot would break exactly the deployments we sell to.
- **Tamper-evident, not tamper-proof.** Object code on the customer's machine can always be
  patched by a determined attacker. The realistic goal is to make honest customers stay honest
  and make casual overuse (extra seats, extra workers, past expiry) require deliberate
  circumvention that breaches the EULA. We optimize for that, not for DRM that survives a
  motivated cracker.
- **Cheap to operate.** Single-founder product. Key issuance should be a small signing step at
  checkout/renewal, not a service with uptime obligations on the critical path of customer boots.
- **Maps onto what exists.** We should reuse the planned bearer-token auth seam (SPEC P1.7) and
  the `WORKER_ID` fleet identity model (SPEC Release 2) rather than inventing parallel machinery.

---

## 2. The license key: an Ed25519-signed offline token

### 2.1 Shape

A license key is a signed token the customer pastes in once (or drops in a file / env var). It
carries the entitlements as **claims**; the signature makes it unforgeable without our private
key.

Recommended concrete form: a compact signed token — either a JWT with `alg: EdDSA` (Ed25519) or,
preferably, a minimal custom envelope `base64url(payload) + "." + base64url(signature)` to avoid
JWT footguns (the `alg: none` family of bugs). Payload (canonical JSON):

```jsonc
{
  "v": 1,                       // schema version
  "lic": "PIR-9F2A-...",        // license id (for support + revocation lists)
  "org": "Acme Robotics",       // licensee name, shown in UI
  "tier": "team",               // "solo" | "team" | "enterprise"
  "seats": 5,                   // max named human seats
  "workers": 10,                // max fleet WORKER_IDs (1 for solo)
  "features": ["fleet", "postgres", "priority-support"],
  "iat": 1752300000,            // issued-at (epoch seconds)
  "exp": 1783836000,            // expiry (epoch seconds)
  "grace_days": 14              // post-expiry grace window
}
```

### 2.2 Why Ed25519

- **Asymmetric** — we sign with a private key that never leaves our issuing environment; the
  Software ships only the **public** key. A customer (or a leaked build) cannot mint new keys.
  This is the property a symmetric HMAC scheme cannot give us: with HMAC the verification secret
  is the signing secret, and it would sit inside the distributed object code.
- **Small and fast** — 64-byte signatures, 32-byte public key, verification in well under a
  millisecond. Fine to verify on every boot and periodically at runtime.
- **Boring and available** — Ed25519 verification is in Node's built-in `crypto` (`sign`/`verify`
  with a `ed25519` key, or `crypto.verify(null, msg, publicKey, sig)`), so **zero new
  dependencies**. No native modules, works the same on the Windows/dev boxes and Linux
  containers Piranha already targets.

### 2.3 Key management

- Private signing key lives only in the Owner's issuing tool (offline or in a locked-down CI
  secret), never in the repo, never in a build. Treat it like the release-signing key.
- Public verification key is embedded as a constant in the Software. Plan for **key rotation**:
  ship an array of accepted public keys and stamp a `kid` (key id) in the token header so we can
  roll to a new signing key without invalidating outstanding licenses.
- Keep an internal ledger mapping `lic` -> customer, tier, term. That ledger, not the token, is
  the source of truth for support and renewals.

---

## 3. How a self-hosted instance validates (no phone-home)

Validation is pure local cryptography plus clock checks. Sequence at boot and periodically:

1. **Load** the key from the first available source: `PIRANHA_LICENSE` env var, then a
   `license.key` file next to the data dir (alongside the existing `db/.secret.key` convention),
   then a value stored in the DB `system_state`.
2. **Verify signature** against the embedded public key(s). Bad signature -> treat as unlicensed.
3. **Check claims:** `v` supported; `exp` vs. current time; derive grace state (Section 4);
   `tier`/`features`/`seats`/`workers` become the runtime entitlement object.
4. **Enforce scope locally** (Section 5): compare live seat/worker usage against the claim caps.
5. **Surface state in the UI** on the start screen / settings — org name, tier, seats used/total,
   days to expiry — reusing the same start-screen real estate that SPEC P1.7 already earmarks for
   showing the bearer token.

**No network call is involved.** The only "server" in the picture is ours at *issuance* time, not
at *validation* time.

### 3.1 The clock problem and the optional heartbeat

The one thing offline validation cannot fully police is a customer rolling the system clock back
to dodge expiry. Mitigations, in order of how much they cost the customer's offline story:

- **Monotonic high-water mark (recommended default).** Persist the newest timestamp the instance
  has ever seen (e.g., in `system_state`). If the wall clock is earlier than the stored
  high-water mark by more than a small skew, treat it as suspicious and fall back to the stored
  time for expiry math. This defeats casual clock-rollback without any network dependency.
- **Optional signed refresh (opt-in, for hosted/enterprise).** For customers who *are* online, a
  periodic fetch of a fresh short-lived signed token (or a signed "not-before-now" heartbeat) from
  our issuing endpoint tightens expiry. This is strictly optional and off by default so the
  offline promise holds for everyone else.
- **Revocation list (optional).** A signed, occasionally-updated revocation list (`lic` ids) can
  be distributed for customers who opt into refresh; offline customers simply never fetch it.
  Revocation for a fully-offline instance is inherently limited — accept that and price/contract
  accordingly.

---

## 4. Grace periods and failure modes

Licensing must **fail soft**, never brick a running production orchestrator over a clock edge or a
missing file. States:

| State | Trigger | Behavior |
|---|---|---|
| **Valid** | signature ok, `now < exp` | full entitlements |
| **Grace** | `exp <= now < exp + grace_days` | full entitlements; persistent non-blocking banner "License expired — renew within N days"; log warnings |
| **Expired** | `now >= exp + grace_days` | **degrade, don't brick**: stop dispatching *new* agent work / block fleet mode, keep the UI, board, logs, and merge gate usable so in-flight work can be reviewed and landed; prominent renew prompt |
| **Missing / invalid** | no key or bad signature | unlicensed mode — same degraded posture as Expired, with a "activate a license" call to action |

Design rules:
- **In-flight tasks are never killed** by a license transition. Expiry stops *new* dispatch; it
  does not abort a running worktree or discard an unmerged, human-approved change.
- Grace length comes from the token (`grace_days`), so we can grant a generous window to a
  specific enterprise deal without a new build.
- A short **boot skew tolerance** (e.g., a few minutes) prevents flapping around the exact expiry
  second.

---

## 5. Mapping onto existing seams

### 5.1 The bearer-token / auth seam (SPEC P1.7)

SPEC P1.7 already plans a bearer token generated at first boot, shown on the start screen, and
checked in the db-server middleware chain. **The license layer sits beside it, not on top of it —
they answer different questions:**

- **Bearer token = authentication.** "Is this request allowed to talk to *this* db-server?" One
  secret per instance, unrelated to entitlements.
- **License key = entitlement.** "What is this instance allowed to *do* — which tier, how many
  seats/workers, is it in term?"

Concretely, the license check becomes **one more piece of middleware** (or a small startup
gate + a middleware for feature-gated routes) in the same chain SPEC P1.7 introduces:
request-id/timing -> CORS -> body-limit -> error-envelope -> **auth (bearer)** -> **entitlement
(license)** -> route. Feature-gated endpoints (fleet, Postgres backend, etc.) consult the
resolved entitlement object; ungated endpoints don't. This reuses the middleware spine from SPEC
P0.5 rather than threading license state through every handler.

The start screen already has to display the bearer token; it displays license status in the same
panel. One surface, two facts.

### 5.2 The fleet `WORKER_ID` model (SPEC Release 2)

Fleet mode is where seat/worker metering actually bites, and Piranha already has the primitives:

- `WORKER_ID` (default `${os.hostname()}:${process.pid}`, overridable via env) plus the `workers`
  table, `registerWorker`/`heartbeatWorker`, and stale-worker reclaim (`agentic/db/tasks.ts`,
  `agentic/engine/orchestrator.ts`).
- The shared Postgres `Store` (`configureBackend({kind:'postgres'})`) that centralizes all tables
  for a fleet.

**Worker metering falls out of this for free.** In fleet mode the hub already knows the set of
live `WORKER_ID`s via the registry + heartbeat. The license enforcement point is the hub: when a
worker registers or heartbeats, count **distinct live workers**; if it would exceed the license
`workers` cap, refuse to register the surplus worker (park it with a clear "license worker limit
reached — N/N" message) rather than silently letting it claim tasks. Because there is exactly one
shared DB in fleet mode, there is exactly one authoritative place to enforce the cap — no
distributed agreement needed. The atomic-claim design rule ("keep the hub dumb, the claim is the
scheduler") extends cleanly: the license cap is just an admission check at registration time.

**Seat metering** is softer (seats are humans, not processes). Track named users where the app
has an identity notion; until Piranha has real multi-user accounts (single-user local today),
"seats" is primarily a *contractual* number surfaced in the UI and enforced honor-system + at the
worker layer, tightening to hard enforcement when Release 2/3 introduces real accounts. Do not
over-build seat DRM before the product even has user accounts.

- **Solo/local tier:** `workers: 1`, `seats: 1`. The single local instance is both hub and
  worker; enforcement is trivial (the one process).
- **Team/fleet tier:** `workers: N`. Hub enforces the cap at `registerWorker`. This is the tier
  where the `WORKER_ID` registry earns its keep.
- **Fleet cost budgets** (SPEC Release 2 Phase 4, sum-over-shared-PG) are orthogonal but live in
  the same hub; the license tier can also gate whether fleet-wide budgets are available at all.

### 5.3 Feature gating touch points (concrete)

Gate at these existing seams, not scattered `if` checks:
- **Backend selection** — `configureBackend({kind:'postgres'})` / `getStore.ts`: Postgres/fleet
  backend requires a tier with the `fleet`/`postgres` feature; solo tier is SQLite-only.
- **Worker registration** — `registerWorker` in `agentic/db/tasks.ts`: worker-cap admission check.
- **db-server middleware** — the SPEC P0.5 chain: entitlement middleware for gated routes.
- **Start screen / settings** — license status display beside the bearer token.

---

## 6. Anti-abuse posture (be honest about it)

State plainly for the Owner: a customer running our object code can patch out the check. We are
not shipping DRM that beats a reverse engineer, and we should not spend budget pretending to.
What the Ed25519 scheme *does* buy:

- No one can **mint** a key (private key never ships).
- No one can **edit** a key (tier/seats/exp) without breaking the signature.
- Casual overuse (spin up an 11th worker on a 10-worker license, run a month past expiry) is
  **blocked by default** and requires deliberate binary patching, which is an unambiguous EULA
  breach we can act on contractually.

That is the right amount of protection for a self-hosted developer tool. Layering optional online
refresh/revocation on top (Section 3.1) is available for the enterprise deals that want it.

---

## 7. Build vs. buy

### Options considered

| Option | What it is | Fit for Piranha |
|---|---|---|
| **Roll-your-own (Ed25519 offline tokens)** | ~A few hundred lines: an issuing CLI that signs tokens with our private key, plus a verifier in the app using Node's built-in `crypto`. | **Strong.** Zero new runtime deps, fully offline by construction, maps directly onto the existing bearer-auth middleware and `WORKER_ID` registry. We control the format and the failure modes. Cost is ours to build/maintain and to secure the signing key. |
| **[Keygen](https://keygen.sh)** | Licensing/distribution API; can be self-hosted (it is itself source-available) and supports offline/cryptographic (Ed25519) license files. | **Good fit if we outgrow roll-your-own.** Offline license files match our constraint; self-hostable so we're not forcing a phone-home. Adds a dependency and, for the managed tier, per-active-license cost. Worth it once issuance, entitlements, renewals, and a customer portal become real work. |
| **[Cryptolens](https://cryptolens.io)** | Hosted license-key API with offline activation support and SDKs. | **Workable but .NET-centric** and hosted-first; the offline story exists but the ergonomics and SDK weight suit .NET desktop apps more than a Node/TS self-hosted server. Introduces a vendor on a path we want to keep offline. |
| **LemonSqueezy / Paddle license API, Gumroad, etc.** | Licensing bolted onto a merchant-of-record checkout. | Convenient because they also handle billing/VAT, but their license verification is **online-first** — the opposite of our core constraint. Fine for the *billing* side; do not rely on them for the *offline validation* side. |

### Recommendation

**Roll our own Ed25519 offline license keys for launch (Solo + early Team), and keep Keygen as the
documented migration target.** Rationale:

- The offline-validation requirement is non-negotiable for a self-hosted product, and a
  home-grown signed token is the *simplest* thing that satisfies it — no vendor, no phone-home, no
  new dependency (Node's built-in `crypto` does Ed25519).
- It slots directly into seams we're already building: the P1.7 bearer-auth middleware chain and
  the `WORKER_ID` registry. The marginal code is small and lives where related code already lives.
- The scope at launch is small (issue a key at checkout, verify it locally, gate a few features),
  so a third-party licensing platform is over-tooling for the problem we have now.
- **Switch to Keygen (self-hosted or managed) when** issuance volume, per-customer license
  portals, seat self-service, activation analytics, or trials-at-scale turn licensing into a
  product of its own — most likely around the Team/Enterprise push in Release 2/3. Keygen's
  offline license files preserve the no-phone-home guarantee, so migrating does not betray the
  core constraint.
- For **billing/payments**, use a merchant-of-record (Paddle/LemonSqueezy/Stripe) regardless of
  the licensing choice; wire "payment succeeded -> sign and email a license key" as a small step.
  Keep billing and offline *validation* as separate concerns.

**Verdict in one line:** roll-your-own Ed25519 offline tokens now (no deps, offline by design,
fits existing seams); adopt Keygen later when licensing becomes its own product surface.
