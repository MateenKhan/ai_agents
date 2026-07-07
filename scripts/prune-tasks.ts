// ─────────────────────────────────────────────────────────────────────────────
// prune-tasks.ts — remove tasks that lack GWT scenarios (old / free-text format),
// keeping only properly-formatted tasks. Run with the pipeline STOPPED.
//   npx tsx scripts/prune-tasks.ts            → dry run (lists what it would delete)
//   npx tsx scripts/prune-tasks.ts --apply    → actually delete
// Paths are all process.cwd()-relative via the config, so this runs on Ubuntu too.
// ─────────────────────────────────────────────────────────────────────────────
import { buildConfig, setConfig } from '../agentic/index.ts';
import { getAllTasks, deleteTask } from '../db/tasks';

setConfig(buildConfig(process.cwd()));

const apply = process.argv.includes('--apply');
const tasks = getAllTasks();
const hasScenarios = (t: any) => Array.isArray(t.scenarios) && t.scenarios.length > 0;
const keep = tasks.filter(hasScenarios);
const drop = tasks.filter(t => !hasScenarios(t));

console.log(`\n[prune-tasks] ${tasks.length} tasks — keep ${keep.length} (have GWT scenarios), remove ${drop.length} (no scenarios)\n`);
console.log('KEEP:');
for (const t of keep) console.log(`  ✓ ${t.id.slice(-6)}  [${t.status}]  ${t.title}`);
console.log('\nREMOVE:');
for (const t of drop) console.log(`  ✗ ${t.id.slice(-6)}  [${t.status}]  ${t.title}`);

if (!apply) {
  console.log(`\nDry run — nothing deleted. Re-run with --apply to remove the ${drop.length} task(s) above.`);
} else {
  for (const t of drop) deleteTask(t.id);
  console.log(`\n✅ Deleted ${drop.length} task(s). ${keep.length} kept.`);
}
