import { useState, useCallback, useEffect } from 'react';
import type { Task, TaskStatus, TaskControlAction } from '../types';
import { API_BASE, withProject, taskItemUrl } from '../../../apiBase';

// `activeId` scopes every fetch to a project. It's passed in so the hook re-runs
// (refetches) whenever the active project changes; withProject() also reads the
// persisted value so create/update/delete land on the right project.
export function useTasks(activeId?: string) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [triggeringIds, setTriggeringIds] = useState<Set<string>>(new Set());
  // Tasks with an in-flight lifecycle control call (start/pause/resume/stop) — drives disabled/pulse UI.
  const [controllingIds, setControllingIds] = useState<Set<string>>(new Set());

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(withProject(`${API_BASE}/tasks`));
      if (!res.ok) throw new Error('Failed to fetch tasks');
      const data = await res.json();
      setTasks(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const createTask = async (task: Partial<Task>, projectId?: string) => {
    try {
      const res = await fetch(withProject(`${API_BASE}/tasks`, projectId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(task),
      });
      if (!res.ok) throw new Error('Failed to create task');
      await fetchTasks();
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  };

  const updateTask = async (id: string, updates: Partial<Task>) => {
    try {
      const res = await fetch(taskItemUrl(id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Failed to update task');
      await fetchTasks();
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  };

  const deleteTask = async (id: string) => {
    try {
      const res = await fetch(taskItemUrl(id), {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete task');
      await fetchTasks();
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  };

  const deleteTasks = async (ids: string[]) => {
    try {
      const results = await Promise.allSettled(
        ids.map(id => fetch(taskItemUrl(id), { method: 'DELETE' }))
      );
      const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok)).length;
      if (failed > 0) setError(`Failed to delete ${failed} of ${ids.length} task(s)`);
      await fetchTasks();
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  };

  const triggerAgent = async (taskId: string) => {
    setTriggeringIds(prev => new Set(prev).add(taskId));
    try {
      const res = await fetch(withProject(`${API_BASE}/tasks/${taskId}/trigger`), {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to trigger agent');
      // The backend handles opening the chat via VS Code command
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setTriggeringIds(prev => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  };

  // Per-task lifecycle control: start | pause | resume | stop.
  // Hits POST /tasks/:id/<action> (project-scoped) then refetches so the board reflects control state.
  const controlTask = async (id: string, action: TaskControlAction) => {
    setControllingIds(prev => new Set(prev).add(id));
    try {
      const res = await fetch(withProject(`${API_BASE}/tasks/${encodeURIComponent(id)}/${action}`), {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`Failed to ${action} task`);
      await fetchTasks();
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setControllingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 10000); // Polling every 10s
    return () => clearInterval(interval);
    // Re-run (and re-poll) whenever the active project changes.
  }, [fetchTasks, activeId]);

  return {
    tasks,
    loading,
    error,
    triggeringIds,
    controllingIds,
    fetchTasks,
    createTask,
    updateTask,
    deleteTask,
    deleteTasks,
    triggerAgent,
    controlTask,
  };
}
