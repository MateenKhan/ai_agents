import { Router } from '../router.js';
import {
  projectIdOf,
  projectRepoPath,
  systemActivity,
  isRebuilding,
  ACTIVE_AGENTS,
  boardCorrupt
} from '../server.js';
import {
  getCodeIndexConfig,
  getHeartbeat,
  getBoardSettings,
  getAllTasks
} from '../../agentic/db/tasks.js';
import { getRecentLogs } from '../../agentic/db/logs.js';

export function registerSystemRoutes(router: Router) {
  // Delete one event from the status-widget feed (a logs.db row). id in the path.
  router.delete('/system-status/events/:id', async (req, res) => {
    try {
      const { deleteAgentLog } = await import('../../agentic/db/logs.js');
      const removed = await deleteAgentLog(Number(req.params!.id));
      res.end(JSON.stringify({ ok: true, removed }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
  });

  // Clear the event feed for the project the board is showing (plus the engine-wide
  // '__system__' lines it displays). Other projects' history is not touched.
  router.delete('/system-status/events', async (req, res) => {
    try {
      const { clearAgentLogs } = await import('../../agentic/db/logs.js');
      const removed = await clearAgentLogs(projectIdOf(req));
      res.end(JSON.stringify({ ok: true, removed }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
  });

  router.get('/system-status*', async (req, res) => {
    try {
      const pid = projectIdOf(req);
      let hb: any = null;
      try { hb = await getHeartbeat(); } catch { /* optional */ }
      const ci = await getCodeIndexConfig(pid);
      const root = ci.root || await projectRepoPath(pid);
      // Highest-priority current activity: explicit op → index rebuild → agents → idle.
      let activity: any = systemActivity.get(pid);
      if (!activity && isRebuilding(pid)) activity = { kind: 'indexing', label: 'Reading & remembering repo', detail: root, since: Date.now() };
      if (!activity && ACTIVE_AGENTS.size > 0) activity = { kind: 'agents', label: `${ACTIVE_AGENTS.size} agent(s) working`, detail: [...ACTIVE_AGENTS].join(', '), since: Date.now() };

      // Orchestrator liveness + always-on human-readable status line (from the heartbeat).
      let settings: any = {};
      try { settings = await getBoardSettings() || {}; } catch { /* optional */ }
      const lastBeatAt = hb?.lastBeatAt || null;
      const ageSec = lastBeatAt ? Math.round((Date.now() - new Date(lastBeatAt).getTime()) / 1000) : null;
      const orchestrator = {
        agentStatus: settings.agentStatus || null,
        statusLine: hb?.statusLine || null,
        lastBeatAt,
        ageSec,
        up: ageSec != null && ageSec < 30,
      };

      // Per-project task counts for the board summary.
      let counts = { pending: 0, working: 0, testing: 0, done: 0 };
      try {
        const tasks = await getAllTasks(pid);
        counts = {
          pending: tasks.filter((t: any) => t.status === 'WORKING' && !t.started).length,
          working: tasks.filter((t: any) => t.status === 'WORKING' && t.started).length,
          testing: tasks.filter((t: any) => t.status === 'TESTING').length,
          done: tasks.filter((t: any) => t.status === 'DONE').length,
        };
      } catch { /* optional */ }

      // Most recent log rows (newest-first) for the live event feed, scoped to the project the
      // board is showing. Unscoped, one project's failures scrolled through another's feed.
      // Engine-wide '__system__' lines are still included by getRecentLogs.
      let events: Array<{ id: number; ts: string; taskId: string; msg: string; type: string; projectId: string | null }> = [];
      try { events = await getRecentLogs(15, pid); } catch { /* logs.db optional */ }

      res.end(JSON.stringify({
        ok: true,
        activity: activity || { kind: 'idle', label: 'Idle', since: Date.now() },
        indexRebuilding: isRebuilding(pid),
        boardCorrupt,
        activeAgents: [...ACTIVE_AGENTS],
        circuit: hb?.circuit || null,
        mode: hb?.mode || null,
        indexRoot: root,
        orchestrator,
        counts,
        events,
      }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
  });
}
