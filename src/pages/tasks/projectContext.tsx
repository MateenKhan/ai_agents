import React, { createContext, useContext, useCallback, useEffect, useState } from 'react';
import { API_BASE, getActiveProject, setActiveProject, DEFAULT_PROJECT } from '../../apiBase';

export interface Project {
  id: string;
  name: string;
  repoPath?: string;
  emoji?: string;
  createdAt?: string;
}

export interface CreateProjectInput {
  name: string;
  repoPath?: string;
  emoji?: string;
}

export interface UpdateProjectInput {
  name?: string;
  repoPath?: string;
  emoji?: string;
}

interface ProjectContextValue {
  projects: Project[];
  activeId: string;
  loading: boolean;
  setActiveId: (id: string) => void;
  refreshProjects: () => Promise<Project[]>;
  createProject: (input: CreateProjectInput) => Promise<Project>;
  updateProject: (id: string, input: UpdateProjectInput) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveIdState] = useState<string>(() => getActiveProject());
  const [loading, setLoading] = useState(true);

  // Keep localStorage and state in lockstep so any withProject() call fired from
  // anywhere resolves the current project immediately after a switch.
  const setActiveId = useCallback((id: string) => {
    const next = id || DEFAULT_PROJECT;
    setActiveProject(next);
    setActiveIdState(next);
  }, []);

  const refreshProjects = useCallback(async (): Promise<Project[]> => {
    try {
      const res = await fetch(`${API_BASE}/projects`);
      if (!res.ok) throw new Error('Failed to fetch projects');
      const data = await res.json();
      const list: Project[] = data.projects || [];
      setProjects(list);
      // If the stored active project no longer exists, fall back to the first one.
      setActiveIdState(prev => {
        if (list.length === 0) return prev;
        if (list.some(p => p.id === prev)) return prev;
        const fallback = list[0].id;
        setActiveProject(fallback);
        return fallback;
      });
      return list;
    } catch {
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  const createProject = useCallback(async (input: CreateProjectInput): Promise<Project> => {
    const res = await fetch(`${API_BASE}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to create project');
    await refreshProjects();
    return data.project as Project;
  }, [refreshProjects]);

  const updateProject = useCallback(async (id: string, input: UpdateProjectInput): Promise<void> => {
    const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to update project');
    await refreshProjects();
  }, [refreshProjects]);

  const deleteProject = useCallback(async (id: string): Promise<void> => {
    const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to delete project');
    // If we deleted the active project, snap back to default before the list reloads.
    if (getActiveProject() === id) setActiveId(DEFAULT_PROJECT);
    await refreshProjects();
  }, [refreshProjects, setActiveId]);

  const value: ProjectContextValue = {
    projects,
    activeId,
    loading,
    setActiveId,
    refreshProjects,
    createProject,
    updateProject,
    deleteProject,
  };

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProjects(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProjects must be used within a ProjectProvider');
  return ctx;
}
