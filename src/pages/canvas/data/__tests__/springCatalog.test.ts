import { describe, it, expect } from 'vitest';
import { SPRING_CATALOG } from '../springCatalog';
import type { CatalogOption } from '../catalogTypes';

// The Spring catalog is generated from the Spring Initializr metadata endpoint
// (start.spring.io/metadata/client) plus the legacy Netflix stack and the project
// metadata / design pattern presets. These tests pin the completeness guarantees the
// canvas inspector relies on: every entry documented and linked, ids unique, and the
// well-known options the user asked for by name actually present.

/** Depth-first flatten of options and all nested children into one list. */
function flatten(options: CatalogOption[]): CatalogOption[] {
  return options.flatMap((o) => [o, ...(o.children ? flatten(o.children) : [])]);
}

const allOptions = flatten(SPRING_CATALOG.categories.flatMap((c) => c.options));
const byId = new Map(allOptions.map((o) => [o.id, o]));

describe('SPRING_CATALOG', () => {
  it('identifies itself as the Spring Boot catalog', () => {
    expect(SPRING_CATALOG.framework).toBe('spring-boot');
    expect(SPRING_CATALOG.label).toBe('Spring Boot');
  });

  it('every option and child has a non-empty id, label, and description', () => {
    for (const option of allOptions) {
      expect(option.id, `id missing on ${JSON.stringify(option)}`).toBeTruthy();
      expect(option.label, `label missing on ${option.id}`).toBeTruthy();
      expect(option.description.trim(), `description missing on ${option.id}`).not.toBe('');
    }
  });

  it('every option and child links to official docs over https', () => {
    for (const option of allOptions) {
      expect(option.docsUrl, `docsUrl on ${option.id}`).toMatch(/^https:\/\//);
      // The Initializr metadata templates urls with {bootVersion}; the catalog must
      // resolve those to real links, never leak the placeholder.
      expect(option.docsUrl, `unresolved placeholder in ${option.id}`).not.toContain('{');
    }
  });

  it('ids are unique across the whole catalog, children included', () => {
    const ids = allOptions.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('categories also have unique, non-empty ids and labels', () => {
    const catIds = SPRING_CATALOG.categories.map((c) => c.id);
    expect(new Set(catIds).size).toBe(catIds.length);
    for (const category of SPRING_CATALOG.categories) {
      expect(category.id).toBeTruthy();
      expect(category.label).toBeTruthy();
      expect(category.options.length, `category ${category.id} is empty`).toBeGreaterThan(0);
    }
  });

  it('is exhaustive: at least 15 categories and 120 total options', () => {
    // The real Initializr metadata carries 23 categories / 216 dependencies on its
    // own; anything below these floors means the catalog regressed to a hand-picked
    // subset, which is exactly what this catalog exists to prevent.
    expect(SPRING_CATALOG.categories.length).toBeGreaterThanOrEqual(15);
    expect(allOptions.length).toBeGreaterThanOrEqual(120);
  });

  it('keeps the legacy Netflix trio with an explicit status and named successor', () => {
    for (const [id, successorFragment] of [
      ['ribbon', 'LoadBalancer'],
      ['hystrix', 'Resilience4j'],
      ['zuul', 'Gateway'],
    ] as const) {
      const option = byId.get(id);
      expect(option, `${id} missing from catalog`).toBeDefined();
      expect(['maintenance', 'deprecated']).toContain(option!.status);
      expect(option!.successor, `${id} must name a successor`).toContain(successorFragment);
    }
  });

  it('includes the flagship Spring Cloud options by id', () => {
    for (const id of ['cloud-config-server', 'cloud-gateway', 'cloud-eureka']) {
      expect(byId.get(id), `${id} missing from catalog`).toBeDefined();
    }
  });

  it('models the pending-doc suboptions as children of their parent starters', () => {
    expect(byId.get('web')?.children?.map((c) => c.id)).toContain('web-openapi-swagger');
    expect(byId.get('kafka')?.children?.map((c) => c.id)).toContain('kafka-dlt');
    expect(byId.get('security')?.children?.map((c) => c.id)).toContain('security-jwt-filter');
  });
});
