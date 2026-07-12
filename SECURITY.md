# Security

`ai-agents` is a **local, single-user developer tool**. It orchestrates headless Claude
coding agents against your own repositories, and to do that it stores and uses Git
credentials on your machine. This document explains what it stores, how it's exposed, and
how to run it safely.

If you deploy it beyond your own laptop (a shared box, a VPS, a LAN), read **Network
exposure** and **Hardening** carefully — the defaults are chosen for a private machine.

---

## Threat model (what this is designed for)

- **In scope:** a single trusted user running the tool on a machine they control, talking
  to it from a browser on the same machine (`localhost`).
- **Out of scope (by default):** multi-tenant use, untrusted network peers, or exposing the
  API to the public internet. The server has **no authentication** — anyone who can reach
  its port can drive it. Keep it on loopback unless you add your own auth in front (reverse
  proxy with auth, VPN, SSH tunnel, firewall).

---

## What is stored, and where

Everything lives in **local SQLite files** (default `db/tasks.db`, `db/logs.db`, and the
code index `db/local.db`). Nothing is sent to any third party except the model/API calls
the agents themselves make, and Git operations against the remotes you configure.

| Data | Table / file | Sensitivity |
|---|---|---|
| Git PATs | `git_tokens` (`tasks.db`) | **Secret** — encrypted at rest (AES-256-GCM) |
| GitHub App private keys, client/webhook secrets | `github_apps` (`tasks.db`) | **Secret** — encrypted at rest (AES-256-GCM) |
| GitHub App installation IDs, app/slug/account metadata | `github_apps` (`tasks.db`) | Low — non-secret identifiers |
| Tasks, projects, board config, run config | `tasks.db` | Non-secret |
| Run/agent logs, code-index-usage audit, context memory | `logs.db` | Low — may contain code paths |

### Secrets are encrypted at rest (AES-256-GCM)

Git PATs (`git_tokens.token`) and the three GitHub-App secrets (`github_apps.privateKey`,
`clientSecret`, `webhookSecret`) are **encrypted with AES-256-GCM before they are written to
`tasks.db`**, and decrypted only in-process at the moment they are used (git auth, JWT
signing, installation-token minting). The masked HTTP responses and DB-browser endpoints
never see the plaintext.

- **Where the key comes from.** The 32-byte encryption key is read from the
  `AGENTS_SECRET_KEY` environment variable if set (hex/base64); otherwise it is loaded from
  (or generated once into) `db/.secret.key`. That key file is **git-ignored** and created
  with `0600` (owner read/write only) permissions.
- **Lazy, non-breaking migration.** Reads pass legacy plaintext straight through, so an
  existing `tasks.db` keeps working during and after the upgrade. On first boot the schema
  path runs a best-effort pass (`reencryptSecretsAtRest()`) that rewrites any remaining
  plaintext secret as ciphertext. Writing an `encrypt()`-ed value is idempotent.
- **Threat model — what this does and does not protect.** Encryption at rest protects the
  **`tasks.db` file and its backups/copies** (a synced folder, a stray copy, a stolen disk):
  the secrets are useless without the key, which lives outside the DB. It does **not** defend
  against an attacker who already has **live access to the host holding the key** — such a
  process can read `db/.secret.key` (or `AGENTS_SECRET_KEY`) and decrypt everything, exactly
  as the tool itself does. Keep the key file off any drive you sync or share, and treat host
  access as full compromise. See **Hardening** for stronger options (OS keychain, external
  key management).

### Secrets never leave the box in the clear

- **Masked over HTTP.** The API returns tokens masked (`ghp_…abcd`); GitHub App private
  keys and secrets are **omitted entirely** from list responses.
- **Stripped from Git output.** Installation tokens minted for GitHub Apps, and tokens
  baked into clone/push/pull URLs, are scrubbed (`***`) from any command output the API
  echoes back.
- **Not logged.** The request logger records method + path only, never request bodies.

> ⚠️ **Masking hides the token string, not the capability.** Because there is no auth,
> anyone who can reach the API can still *use* your credentials indirectly — trigger a
> clone/push/pull that authenticates with a stored token. This is why the network posture
> below matters more than the at-rest format.

---

## Network exposure

- **Binds to `127.0.0.1` (loopback) by default.** The server is not reachable from the
  network unless you opt in with `HOST=0.0.0.0` (which logs a warning). Only do this on a
  trusted, firewalled host.
- **CORS is restricted.** Cross-origin browser requests are allowed only from `localhost`,
  `127.0.0.1`, and the **same host** the client connected to. A malicious web page you
  happen to visit therefore cannot script this API. Override with `CORS_ALLOW_ORIGIN`
  (a specific origin, or `*` to restore wide-open behavior — not recommended).
- Non-browser callers (the agents' own `curl` calls, scripts) send no `Origin` header and
  are unaffected by CORS.

### Running on a LAN / VPS (opt-in)

If you must expose it:

```bash
HOST=0.0.0.0 CORS_ALLOW_ORIGIN=http://your-host:6951 pnpm run agents
```

and additionally: put it behind a firewall / security group, restrict the source IPs,
and ideally front it with an authenticating reverse proxy or a VPN/SSH tunnel. There is
**no built-in auth** — treat the open port as full control of your Git credentials.

---

## Git & npm hygiene (no secrets in the repo or the package)

- The databases and secret files are **git-ignored**: `*.db`, `*.db-wal`, `*.db-shm`,
  `local.db`, `.env`, `*.pem`, `*.key` (this includes `db/.secret.key`, the at-rest
  encryption key). **Never commit `tasks.db`** — it holds the encrypted tokens, and never
  commit `db/.secret.key` — together they reconstruct the plaintext secrets.
- The same paths are **npm-ignored**, so `npm publish` ships source only. Verify before a
  release: `npm pack --dry-run` must list **no** `.db`, `.env`, `.pem`, or `.key` files.
- The schema **self-creates at runtime** (`CREATE TABLE IF NOT EXISTS` + a seeded default
  project). A fresh clone/install has no database; the first run creates an empty one. You
  do not need to (and should not) commit or "empty" a database before publishing.

---

## Recommendations for users

- **Use fine-grained, least-privilege Personal Access Tokens** scoped to only the repos
  the agents need, with the minimum permissions (Contents: read, or read/write only if
  pushing). Prefer short expirations.
- **Prefer GitHub App installation tokens** where possible — they are short-lived
  (~1 hour) and auto-minted on demand, so no long-lived secret is reused for every op.
- **Don't share or sync the `db/` directory** (backups, cloud drives, screen shares). The
  secrets in `tasks.db` are encrypted, but `db/.secret.key` sits in the same directory —
  syncing both together defeats the encryption. If you must sync, exclude `.secret.key`.
- **Rotate/revoke** any token you suspect was exposed, at the provider (GitHub, GitLab,
  Bitbucket). Deleting it from the tool does not revoke it upstream.
- Run the tool as a **least-privileged OS user** with write access only to the workspace
  it needs (clone target, worktrees).

---

## Hardening (optional, for stricter environments)

- **Secrets are already AES-256-GCM encrypted at rest** (see above). For stricter setups,
  supply the key via `AGENTS_SECRET_KEY` from a secrets manager / KMS instead of the
  on-disk `db/.secret.key`, or move `git_tokens` / `github_apps` into your OS keychain
  (Keychain / Credential Manager / libsecret) so the key never touches the same disk.
- **Separate secrets from the task DB.** If you want to share your task board via Git,
  split the secret tables into a separate, always-ignored store so `tasks.db` is
  secret-free and commit-safe.
- **Put authentication in front** of the API (reverse proxy, mTLS, or an app-level token)
  before any non-loopback deployment.

---

## Reporting a vulnerability

Report security problems privately by emailing the maintainer. Include reproduction steps
and impact. We'll acknowledge and work on a fix before any disclosure.
