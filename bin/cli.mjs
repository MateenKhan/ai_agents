#!/usr/bin/env node
// AI-Agents CLI. Two shapes:
//   ai-agents init [dir]  — scaffold the app into a new folder (create-vite style)
//   ai-agents [start]     — boot the 3 processes in the CURRENT folder (must be an app dir)
// The app is cwd-relative (DBs, worktrees, `npm run db:build` all resolve from cwd),
// so `init` is the primary path: it lays the app down in a real, persistent folder.

import { spawn } from 'node:child_process';
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..'); // installed package root (ships the template)
const args = process.argv.slice(2);
const cmd = args[0];

const isWin = process.platform === 'win32';
// pnpm only — worktree-heavy workflow, and npm's per-worktree node_modules copies blow up disk.
const pnpm = isWin ? 'pnpm.cmd' : 'pnpm';

// Files copied into a scaffolded app. Runtime junk (node_modules, dist, *.db,
// .agent_logs, .worktrees) is skipped via the filter below even if present locally.
const TEMPLATE = [
  'db', 'scripts', 'agentic', 'src',
  'index.html', 'tsconfig.json', '.env.example',
  'vite.config.ts', 'vitest.config.ts', 'postcss.config.js', 'tailwind.config.js',
  'README.md', 'LICENSE',
];

const SKIP = /(^|[\\/])(node_modules|dist|\.git|\.agent_logs|\.worktrees|next_changes|data)([\\/]|$)|\.db(-shm|-wal)?$|\.tsbuildinfo$|\.pem$|\.key$/i;

const GITIGNORE = `node_modules
dist
.env
.env.*
!.env.example
*.pem
*.key
tsconfig.tsbuildinfo
*.db
*.db-shm
*.db-wal
.worktrees
.agent_logs
`;

function help() {
  console.log(`
AI-Agents — multi-agent task orchestrator

Usage:
  pnpm dlx @airtajal/ai-agents init [dir]   Scaffold the app into ./dir (default: ai-agents)
  ai-agents start                      Boot frontend + db-server + orchestrator (in an app dir)
  ai-agents --version                  Print version

After init:
  cd <dir> && pnpm install && pnpm run agents   # then open http://localhost:6951
`);
}

function version() {
  const p = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf-8'));
  console.log(p.version);
}

function init(rawDir) {
  const target = resolve(process.cwd(), rawDir || 'ai-agents');
  if (existsSync(target) && readdirSync(target).length > 0) {
    console.error(`✗ ${target} exists and is not empty. Pick an empty folder.`);
    process.exit(1);
  }
  mkdirSync(target, { recursive: true });
  console.log(`Scaffolding AI-Agents into ${target}`);

  for (const entry of TEMPLATE) {
    const from = join(PKG_ROOT, entry);
    if (!existsSync(from)) continue; // README/LICENSE always ship; others tolerate absence
    cpSync(from, join(target, entry), {
      recursive: true,
      filter: (src) => !SKIP.test(src),
    });
  }

  // Fresh package.json: strip publish-only fields, mark as the user's private app.
  const pkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf-8'));
  delete pkg.bin; delete pkg.files; delete pkg.publishConfig;
  pkg.name = basename(target).toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'ai-agents';
  pkg.private = true;
  writeFileSync(join(target, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

  writeFileSync(join(target, '.gitignore'), GITIGNORE);

  console.log(`
✓ Done.

Next:
  cd ${rawDir || 'ai-agents'}
  pnpm install
  cp .env.example .env      # defaults are fine locally
  pnpm run agents           # boots all 3 processes

Then open http://localhost:6951
`);
}

function start() {
  const pkgPath = join(process.cwd(), 'package.json');
  if (!existsSync(pkgPath)) {
    console.error('✗ No package.json here. Run `ai-agents init <dir>` first, then run this inside that folder.');
    process.exit(1);
  }
  let scripts = {};
  try { scripts = JSON.parse(readFileSync(pkgPath, 'utf-8')).scripts || {}; } catch { /* fall through */ }
  if (!scripts.agents) {
    console.error('✗ This folder is not an AI-Agents app (no `agents` script). Run `ai-agents init <dir>` first.');
    process.exit(1);
  }
  const child = spawn(pnpm, ['run', 'agents'], { cwd: process.cwd(), stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
}

if (cmd === 'init') init(args[1]);
else if (cmd === '-v' || cmd === '--version') version();
else if (cmd === '-h' || cmd === '--help' || cmd === 'help') help();
else if (!cmd || cmd === 'start') start();
else { console.error(`Unknown command: ${cmd}`); help(); process.exit(1); }
