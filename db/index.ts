import { existsSync } from 'fs';
import { buildFull, buildIncremental } from './builder.js';
import { semanticSearch, blastRadius, callers, dependencies, annotate, stats } from './query.js';
import { DB_PATH } from './db.js';

const [,, cmd, ...args] = process.argv;

switch (cmd) {
  case 'build':
    console.log('Full rebuild...');
    await buildFull();
    break;

  case 'update':
    console.log('Incremental update...');
    await buildIncremental();
    break;

  case 'search': {
    const query = args.join(' ');
    if (!query) { console.error('Usage: pnpm run db:search -- "your query"'); process.exit(1); }

    // Which project's index to search. Agents run scoped to a project; the runner injects
    // CODE_INDEX_PROJECT so a task in project X searches X's index, not the default one.
    const projectId = process.env.CODE_INDEX_PROJECT ?? 'default';

    // Try daemon first (model pre-warmed = fast), fall back to direct
    const PORT = process.env.DB_SERVER_PORT ?? '6952';
    let results: any[] = [];
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query, topK: 10, projectId,
          // Identify the calling agent (set by agent-runner) for index-usage audit
          agentName: process.env.AGENT_NAME ?? null,
          taskId: process.env.TASK_ID ?? null,
        }),
        signal: AbortSignal.timeout(3000),
      });
      const data = await res.json() as { results: any[] };
      results = data.results;
    } catch {
      results = await semanticSearch(query, 10, projectId);
    }

    if (!results.length) { console.log('No results.'); break; }
    console.log(`\nTop results for: "${query}"\n`);
    results.forEach((r, i) =>
      console.log(`${i + 1}. [${r.score}] ${r.type} ${r.name}\n   ${r.path}:${r.line}\n   ${r.signature}\n`)
    );
    break;
  }

  case 'blast': {
    const file = args[0];
    if (!file) { console.error('Usage: pnpm run db:blast -- "filepath"'); process.exit(1); }
    const radius = blastRadius(file, 3);
    console.log(`\nBlast radius for: ${file}`);
    console.log(`${radius.length} files affected:\n`);
    radius.forEach(f => console.log(' ', f));
    break;
  }

  case 'callers': {
    const file = args[0];
    if (!file) { console.error('Usage: pnpm run db:callers -- "filepath"'); process.exit(1); }
    callers(file).forEach(f => console.log(f));
    break;
  }

  case 'deps': {
    const file = args[0];
    if (!file) { console.error('Usage: pnpm run db:deps -- "filepath"'); process.exit(1); }
    dependencies(file).forEach(f => console.log(f));
    break;
  }

  case 'annotate': {
    const [file, ...noteParts] = args;
    if (!file || !noteParts.length) { console.error('Usage: pnpm run db:annotate -- "filepath" "note text"'); process.exit(1); }
    annotate(file, noteParts.join(' '));
    break;
  }

  case 'ensure': {
    // Fast startup path: build ONLY if the DB is missing/empty.
    // Never runs incremental embedding — that's manual (`pnpm run db:update`)
    // or async on commit (post-commit hook), so `pnpm run dev` starts instantly.
    const name = DB_PATH.split(/[/\\]/).pop();
    if (!existsSync(DB_PATH)) {
      console.log(`${name} missing — running one-time full build...`);
      await buildFull();
    } else {
      const s = stats();
      if ((s.nodes as number) === 0) {
        console.log(`${name} empty — running one-time full build...`);
        await buildFull();
      } else {
        console.log(`${name} OK (${s.files} files, ${s.nodes} nodes) — skipping embed. Refresh manually: pnpm run db:update`);
      }
    }
    break;
  }

  case 'check': {
    const dbName = DB_PATH.split(/[/\\]/).pop();
    if (!existsSync(DB_PATH)) {
      console.log(`${dbName} missing — running full build...`);
      await buildFull();
    } else {
      const s = stats();
      if ((s.nodes as number) === 0) {
        console.log(`${dbName} empty — running full build...`);
        await buildFull();
      } else {
        console.log(`${dbName} OK (${s.files} files, ${s.nodes} nodes) — running incremental update...`);
        await buildIncremental();
      }
    }
    break;
  }

  case 'context': {
    // Regenerate the cached project brief (the "context brain") without a full re-index.
    const { generateProjectBrief } = await import('./brief.js');
    const projectId = process.env.CODE_INDEX_PROJECT ?? 'default';
    const root = process.env.CODE_INDEX_ROOT || process.cwd();
    console.log(`Generating project brief for [${projectId}]…`);
    try {
      const brief = await generateProjectBrief(projectId, root);
      console.log('\n' + brief + '\n');
    } catch (e: any) {
      console.error(`Failed: ${e?.message || e}`);
      process.exit(1);
    }
    break;
  }

  case 'stats': {
    const s = stats();
    const dbName = DB_PATH.split(/[/\\]/).pop();
    console.log(`\n${dbName} stats`);
    console.log('─────────────────────');
    Object.entries(s).forEach(([k, v]) => console.log(`  ${k.padEnd(20)} ${v}`));
    break;
  }

  default:
    console.log(`
code-search — commands:
  pnpm run db:build                          full rebuild
  pnpm run db:update                         incremental (changed files only)
  pnpm run db:search -- "query"              semantic search
  pnpm run db:blast  -- "filepath"           blast radius (who imports this)
  pnpm run db:stats                          DB stats
  pnpm run db:annotate -- "filepath" "note"  add human note to file nodes
    `);
}
