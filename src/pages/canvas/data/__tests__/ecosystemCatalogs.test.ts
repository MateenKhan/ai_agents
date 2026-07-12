import { describe, expect, it } from 'vitest';
import type { CatalogOption, FrameworkCatalog } from '../catalogTypes';
import { NEST_CATALOG } from '../nestCatalog';
import { NEXT_CATALOG } from '../nextCatalog';
import { FASTAPI_CATALOG } from '../fastapiCatalog';

// Flatten every option and nested child into a single list so the same invariants
// apply at every depth of the catalog tree.
function flattenOptions(options: CatalogOption[]): CatalogOption[] {
  return options.flatMap((option) => [option, ...flattenOptions(option.children ?? [])]);
}

function allOptions(catalog: FrameworkCatalog): CatalogOption[] {
  return catalog.categories.flatMap((category) => flattenOptions(category.options));
}

const catalogs: Array<{ name: string; framework: string; catalog: FrameworkCatalog }> = [
  { name: 'NEST_CATALOG', framework: 'nestjs', catalog: NEST_CATALOG },
  { name: 'NEXT_CATALOG', framework: 'nextjs', catalog: NEXT_CATALOG },
  { name: 'FASTAPI_CATALOG', framework: 'fastapi', catalog: FASTAPI_CATALOG },
];

describe.each(catalogs)('$name', ({ framework, catalog }) => {
  it('declares the expected framework and a human label', () => {
    expect(catalog.framework).toBe(framework);
    expect(catalog.label.trim().length).toBeGreaterThan(0);
  });

  it('has at least 6 categories, each with a non-empty id, label, and options', () => {
    expect(catalog.categories.length).toBeGreaterThanOrEqual(6);
    for (const category of catalog.categories) {
      expect(category.id.trim().length, `category id in ${framework}`).toBeGreaterThan(0);
      expect(category.label.trim().length, `label of category ${category.id}`).toBeGreaterThan(0);
      expect(category.options.length, `options of category ${category.id}`).toBeGreaterThan(0);
    }
  });

  it('has at least 35 options including nested children', () => {
    expect(allOptions(catalog).length).toBeGreaterThanOrEqual(35);
  });

  it('gives every option and child a non-empty id, label, and description', () => {
    for (const option of allOptions(catalog)) {
      expect(option.id.trim().length, `id of ${JSON.stringify(option.label)}`).toBeGreaterThan(0);
      expect(option.label.trim().length, `label of ${option.id}`).toBeGreaterThan(0);
      expect(option.description.trim().length, `description of ${option.id}`).toBeGreaterThan(0);
    }
  });

  it('gives every option and child an https:// official docs link', () => {
    for (const option of allOptions(catalog)) {
      expect(option.docsUrl, `docsUrl of ${option.id}`).toMatch(/^https:\/\//);
    }
  });

  it('has unique option ids within the catalog (children included)', () => {
    const ids = allOptions(catalog).map((option) => option.id);
    const seen = new Set<string>();
    const duplicates = ids.filter((id) => {
      if (seen.has(id)) return true;
      seen.add(id);
      return false;
    });
    expect(duplicates).toEqual([]);
  });

  it('names a successor whenever an option is not GA', () => {
    for (const option of allOptions(catalog)) {
      if (option.status === 'maintenance' || option.status === 'deprecated') {
        expect(option.successor?.trim().length, `successor of ${option.id}`).toBeGreaterThan(0);
      }
    }
  });
});
