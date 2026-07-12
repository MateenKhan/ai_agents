// Shared contract for the exhaustive framework-option catalogs rendered by the canvas
// inspector. Each catalog is data-only (no React) so it can be lazy-loaded per node type
// and consumed by docs generation as well as the UI. Every option carries an official
// docs link and a one-line description — the inspector and the plan document both rely
// on those being present.

export type CatalogStatus = 'ga' | 'maintenance' | 'deprecated';

export interface CatalogOption {
  /** Stable kebab-case id, unique within its catalog (e.g. 'spring-cloud-config-server'). */
  id: string;
  label: string;
  /** One line: what this does and when you'd pick it. */
  description: string;
  /** Official documentation / project page for someone to refer to. */
  docsUrl: string;
  /** Omitted means 'ga'. 'maintenance'/'deprecated' entries should name a successor. */
  status?: CatalogStatus;
  /** Recommended replacement when status is maintenance/deprecated (e.g. Hystrix → Resilience4j). */
  successor?: string;
  /** Nested sub-options (rendered as an expandable accordion under the parent). */
  children?: CatalogOption[];
}

export interface CatalogCategory {
  id: string;
  label: string;
  options: CatalogOption[];
}

export interface FrameworkCatalog {
  /** 'spring-boot' | 'nestjs' | 'nextjs' | 'fastapi' | ... */
  framework: string;
  /** Human name shown as the inspector heading. */
  label: string;
  categories: CatalogCategory[];
}
