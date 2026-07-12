// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import AnalyticsTab, { orderRoles, roleColor } from '../AnalyticsTab';
import type { Task } from '../../types';

/**
 * The role palette must scale past the classic architect/dev/qa/merge four: the expanded
 * DEFAULT_AGENTS roster (product-owner, sre, tech-writer, …) has to chart with stable,
 * deterministic colours, while the classic four keep their historical hues untouched.
 */

// The ten expanded default roles from agentic/db/defaults.ts DEFAULT_AGENTS.
const NEW_ROLES = [
  'owner', 'product-owner', 'business-analyst', 'scrum-master', 'delivery-manager',
  'devops-engineer', 'security-engineer', 'sre', 'ui-ux-designer', 'data-engineer', 'tech-writer',
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('orderRoles', () => {
  it('keeps the classic four first, in pipeline order, then others alphabetically', () => {
    const present = ['sre', 'qa', 'product-owner', 'architect', 'dev', 'business-analyst', 'merge'];
    expect(orderRoles(present)).toEqual([
      'architect', 'dev', 'qa', 'merge',
      'business-analyst', 'product-owner', 'sre',
    ]);
  });

  it('only returns roles actually present in the data', () => {
    expect(orderRoles(['dev', 'tech-writer'])).toEqual(['dev', 'tech-writer']);
    expect(orderRoles([])).toEqual([]);
  });
});

describe('roleColor', () => {
  it('keeps the classic four colours unchanged', () => {
    expect(roleColor('architect')).toBe('bg-fuchsia-500');
    expect(roleColor('dev')).toBe('bg-accent-500');
    expect(roleColor('qa')).toBe('bg-amber-500');
    expect(roleColor('merge')).toBe('bg-emerald-500');
  });

  it('gives every expanded default role a deterministic palette colour', () => {
    for (const role of NEW_ROLES) {
      const c = roleColor(role);
      // a real colour class from the palette, never the classic four's hues, never unstyled
      expect(c).toMatch(/^bg-[a-z]+-[0-9]{3}$/);
      expect(['bg-fuchsia-500', 'bg-accent-500', 'bg-amber-500', 'bg-emerald-500']).not.toContain(c);
      // stable: hashing again yields the same class
      expect(roleColor(role)).toBe(c);
    }
  });

  it('never uses rose — the app-wide error hue', () => {
    for (const role of NEW_ROLES) expect(roleColor(role)).not.toMatch(/rose/);
  });

  it('spreads the expanded roles across distinct hues (max possible for the palette size)', () => {
    // 11 known roles into a 10-hue palette: the seeded hash lands them on 10 distinct slots.
    const distinct = new Set(NEW_ROLES.map(roleColor));
    expect(distinct.size).toBe(10);
  });
});

describe('AnalyticsTab rendering with expanded roles', () => {
  function stubFetch() {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ usage: [] }),
    } as Response));
  }

  const tasks = [
    {
      id: 'T-1', title: 'Ship the navbar', status: 'DONE',
      stageTimings: { architect: 60_000, dev: 120_000, 'product-owner': 30_000, sre: 45_000 },
    },
    {
      id: 'T-2', title: 'Harden the pipeline', status: 'DONE',
      stageTimings: { qa: 90_000, 'security-engineer': 15_000 },
    },
  ] as unknown as Task[];

  it('charts and legends non-classic roles with their palette colour', async () => {
    stubFetch();
    const { container } = render(<AnalyticsTab tasks={tasks} />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());

    const text = container.textContent ?? '';
    for (const role of ['architect', 'dev', 'qa', 'product-owner', 'security-engineer', 'sre']) {
      expect(text).toContain(role);
    }
    // the legend swatch for a new role carries its deterministic colour class
    const swatches = [...container.querySelectorAll(`.${roleColor('product-owner').replace(/:/g, '\\:')}`)];
    expect(swatches.length).toBeGreaterThan(0);
    // classic colours still present for the classic roles
    expect(container.querySelector('.bg-fuchsia-500')).not.toBeNull();
    expect(container.querySelector('.bg-amber-500')).not.toBeNull();
  });
});
