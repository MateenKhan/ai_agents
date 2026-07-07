// scripts/repair-db.ts — non-destructive SQLite repair for the board/index DBs.
// Run with the pipeline STOPPED (nothing may hold the DBs open).
//
//   npx tsx scripts/repair-db.ts          → all DBs
//   npx tsx scripts/repair-db.ts tasks    → board only (tasks.db + logs.db)
//   npx tsx scripts/repair-db.ts code     → code index only (local.db)
//
// Related recovery paths (no npm script wraps this file — run it directly as above):
//   • Board recovery sweep (reset stuck jobs, prune orphans): POST /heal on the db-server.
//   • Rebuild the code index from scratch:                     pnpm run db:build
//
// For each DB: quick_check → if corrupt, back it up, then VACUUM (rewrites the file
// cleanly, keeps every row). VACUUM is non-destructive: it does NOT empty your board.
// If VACUUM can't fix it, you're told the right fallback for that DB (backup is kept).
import { DatabaseSync } from 'node:sqlite';
import { existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

interface Target { rel: string; fallback: string; }
const ALL: Target[] = [
  { rel: 'db/tasks.db', fallback: 'restore from git:  git restore db/tasks.db' },
  { rel: 'db/logs.db',  fallback: 'delete it — logs.db recreates empty on next boot' },
  { rel: 'db/local.db', fallback: 'rebuild it:  pnpm run db:build' },
];

const arg = (process.argv[2] || '').toLowerCase();
const targets =
  arg === 'tasks' ? ALL.filter(d => d.rel !== 'db/local.db') :
  arg === 'code'  ? ALL.filter(d => d.rel === 'db/local.db') :
  ALL;

const stamp = new Date().toISOString().replace(/[:.]/g, '-');

function quickCheck(db: DatabaseSync): string {
  try {
    const r: any = db.prepare('PRAGMA quick_check').get();
    return String(r ? (r.quick_check ?? Object.values(r)[0]) : 'unknown');
  } catch (e: any) { return `error: ${e?.message}`; }
}

console.log(`[repair-db] target: ${arg || 'all'}\n`);
for (const { rel, fallback } of targets) {
  const path = join(process.cwd(), rel);
  if (!existsSync(path)) { console.log(`·  ${rel} — not present, skipping`); continue; }

  const db = new DatabaseSync(path);
  const before = quickCheck(db);
  if (before === 'ok') { console.log(`✅ ${rel} — healthy (quick_check ok)`); db.close(); continue; }

  console.log(`⚠  ${rel} — corrupt: ${before.replace(/\n/g, ' ')}`);
  const bak = `${path}.bak-${stamp}`;
  try { copyFileSync(path, bak); console.log(`   ↳ backed up → ${rel}.bak-${stamp}`); }
  catch (e: any) { console.log(`   ↳ backup failed: ${e?.message}`); }

  try {
    db.exec('VACUUM');
    const after = quickCheck(db);
    if (after === 'ok') console.log(`   ↳ ✅ repaired with VACUUM (quick_check ok) — all rows preserved`);
    else console.log(`   ↳ ✗ still corrupt after VACUUM: ${after.replace(/\n/g, ' ')}\n      → ${fallback}   (backup kept at ${rel}.bak-${stamp})`);
  } catch (e: any) {
    console.log(`   ↳ ✗ VACUUM failed: ${e?.message}\n      → ${fallback}   (backup kept at ${rel}.bak-${stamp})`);
  }
  db.close();
}
console.log('\nDone. Restart with:  npm run agents');
