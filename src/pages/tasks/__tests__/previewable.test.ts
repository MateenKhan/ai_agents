import { describe, it, expect } from 'vitest';
import { isVisualFile, inferPreviewable } from '../previewable';

describe('isVisualFile', () => {
  it('treats browser-rendered extensions as visual', () => {
    for (const p of ['src/App.tsx', 'a/b/Button.jsx', 'x.vue', 'y.svelte', 'index.html', 'main.css', 'theme.scss', 'page.mdx']) {
      expect(isVisualFile(p)).toBe(true);
    }
  });

  it('treats front-end directories as visual even for plain .ts/.js', () => {
    expect(isVisualFile('src/components/thing.ts')).toBe(true);
    expect(isVisualFile('app/pages/home.js')).toBe(true);
    expect(isVisualFile('public/logo.svg-loader.ts')).toBe(true);
  });

  it('treats backend / library files as non-visual', () => {
    for (const p of ['src/utils/slugify.ts', 'src/utils/index.ts', 'server/api/handler.ts', 'db/migrations.sql', 'main.py', 'pkg/util.go', 'lib/parse.rs']) {
      expect(isVisualFile(p)).toBe(false);
    }
  });

  it('never counts test/story/decl files as visual', () => {
    expect(isVisualFile('src/components/Button.test.tsx')).toBe(false);
    expect(isVisualFile('src/pages/Home.stories.tsx')).toBe(false);
    expect(isVisualFile('src/__tests__/App.tsx')).toBe(false);
    expect(isVisualFile('types/global.d.ts')).toBe(false);
  });
});

describe('inferPreviewable', () => {
  it('is true when ANY changed file is visual', () => {
    expect(inferPreviewable([{ path: 'src/utils/slugify.ts' }, { path: 'src/App.tsx' }])).toBe(true);
  });

  it('is false when every changed file is non-visual (the slugify case)', () => {
    expect(inferPreviewable([
      { path: 'src/utils/index.ts' },
      { path: 'src/utils/slugify.ts' },
      { path: 'src/utils/slugify.test.ts' },
    ])).toBe(false);
  });

  it('fails open — unknown/empty file list is previewable', () => {
    expect(inferPreviewable(null)).toBe(true);
    expect(inferPreviewable([])).toBe(true);
    expect(inferPreviewable(undefined)).toBe(true);
  });
});
