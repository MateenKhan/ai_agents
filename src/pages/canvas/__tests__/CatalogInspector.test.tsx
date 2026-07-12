// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CatalogInspector, SELECTED_CATALOG_OPTIONS_KEY, hasCatalogForNodeType } from '../components/CatalogInspector';
import type { FrameworkCatalog } from '../data/catalogTypes';

afterEach(cleanup);

// Small fixture catalog: two categories, a parent option with a nested child,
// and a deprecated option carrying a successor.
const FIXTURE: FrameworkCatalog = {
  framework: 'fixture',
  label: 'Fixture Framework',
  categories: [
    {
      id: 'cat-alpha',
      label: 'Category Alpha',
      options: [
        {
          id: 'opt-web',
          label: 'Web Starter',
          description: 'Servlet HTTP endpoints',
          docsUrl: 'https://example.com/web',
          children: [
            {
              id: 'opt-openapi',
              label: 'OpenAPI UI',
              description: 'Swagger interactive documentation',
              docsUrl: 'https://example.com/openapi',
            },
          ],
        },
        {
          id: 'opt-zuul',
          label: 'Zuul Gateway',
          description: 'Legacy Netflix edge routing',
          docsUrl: 'https://example.com/zuul',
          status: 'deprecated',
          successor: 'Spring Cloud Gateway',
        },
      ],
    },
    {
      id: 'cat-beta',
      label: 'Category Beta',
      options: [
        {
          id: 'opt-kafka',
          label: 'Kafka Messaging',
          description: 'Event streaming broker integration',
          docsUrl: 'https://example.com/kafka',
        },
      ],
    },
  ],
};

const renderInspector = (overrides: Partial<React.ComponentProps<typeof CatalogInspector>> = {}) => {
  const onUpdateNode = vi.fn();
  const utils = render(
    <CatalogInspector
      nodeId="node-1"
      nodeType="springBoot"
      nodeData={{ label: 'Auth Service' }}
      onUpdateNode={onUpdateNode}
      catalog={FIXTURE}
      {...overrides}
    />
  );
  return { onUpdateNode, ...utils };
};

describe('CatalogInspector', () => {
  it('renders the catalog heading and all category labels', () => {
    renderInspector();
    expect(screen.getByText('Fixture Framework')).toBeTruthy();
    expect(screen.getByText('Category Alpha')).toBeTruthy();
    expect(screen.getByText('Category Beta')).toBeTruthy();
  });

  it('expands only the first category by default', () => {
    renderInspector();
    expect(screen.getByText('Web Starter')).toBeTruthy();
    // Second category is collapsed, so its options are not in the document.
    expect(screen.queryByText('Kafka Messaging')).toBeNull();
  });

  it('expands a collapsed category on click', () => {
    renderInspector();
    fireEvent.click(screen.getByText('Category Beta'));
    expect(screen.getByText('Kafka Messaging')).toBeTruthy();
  });

  it('renders an external docs link per option (target=_blank, rel=noopener)', () => {
    renderInspector();
    const link = screen.getByLabelText('Docs: Web Starter') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://example.com/web');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('shows a status badge with the successor for deprecated options', () => {
    renderInspector();
    expect(screen.getByText('deprecated')).toBeTruthy();
    expect(screen.getByText(/Spring Cloud Gateway/)).toBeTruthy();
  });

  it('checking an option persists its id into node data via onUpdateNode', () => {
    const { onUpdateNode } = renderInspector();
    fireEvent.click(screen.getByLabelText('Web Starter'));
    expect(onUpdateNode).toHaveBeenCalledWith('node-1', {
      label: 'Auth Service',
      [SELECTED_CATALOG_OPTIONS_KEY]: ['opt-web'],
    });
  });

  it('unchecking removes the id while preserving other selections', () => {
    const { onUpdateNode } = renderInspector({
      nodeData: { label: 'Auth Service', [SELECTED_CATALOG_OPTIONS_KEY]: ['opt-web', 'opt-zuul'] },
    });
    const checkbox = screen.getByLabelText('Web Starter') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(onUpdateNode).toHaveBeenCalledWith('node-1', {
      label: 'Auth Service',
      [SELECTED_CATALOG_OPTIONS_KEY]: ['opt-zuul'],
    });
  });

  it('nested children render inside an expandable accordion under the parent', () => {
    renderInspector();
    expect(screen.queryByText('OpenAPI UI')).toBeNull();
    fireEvent.click(screen.getByLabelText('Expand sub-options of Web Starter'));
    expect(screen.getByText('OpenAPI UI')).toBeTruthy();
  });

  it('search filters options across categories and auto-expands matching categories', () => {
    renderInspector();
    fireEvent.change(screen.getByPlaceholderText('Search options...'), {
      target: { value: 'kafka' },
    });
    // Category Beta was collapsed; the search expands it and shows the hit.
    expect(screen.getByText('Kafka Messaging')).toBeTruthy();
    // Non-matching options and their empty categories disappear.
    expect(screen.queryByText('Web Starter')).toBeNull();
    expect(screen.queryByText('Category Alpha')).toBeNull();
  });

  it('search matches descriptions and surfaces nested children hits', () => {
    renderInspector();
    fireEvent.change(screen.getByPlaceholderText('Search options...'), {
      target: { value: 'swagger' },
    });
    // The parent is kept so the matching child has context, children auto-expand.
    expect(screen.getByText('Web Starter')).toBeTruthy();
    expect(screen.getByText('OpenAPI UI')).toBeTruthy();
  });

  it('shows an empty state when nothing matches the search', () => {
    renderInspector();
    fireEvent.change(screen.getByPlaceholderText('Search options...'), {
      target: { value: 'zzz-no-such-option' },
    });
    expect(screen.getByText('No options match your search')).toBeTruthy();
  });

  it('lazy-loads the real Spring catalog by node type when no catalog is injected', async () => {
    render(
      <CatalogInspector
        nodeId="node-2"
        nodeType="springBoot"
        nodeData={{ label: 'Payment Service' }}
        onUpdateNode={vi.fn()}
      />
    );
    // Resolves via dynamic import('../data/springCatalog') keyed by node type.
    expect(await screen.findByText('Spring Boot')).toBeTruthy();
    expect(screen.getByText('Project Metadata & Design Patterns')).toBeTruthy();
  });

  it('exposes catalog availability per node type for the page-level wiring', () => {
    expect(hasCatalogForNodeType('springBoot')).toBe(true);
    expect(hasCatalogForNodeType('nestjs')).toBe(true);
    expect(hasCatalogForNodeType('nextjs')).toBe(true);
    expect(hasCatalogForNodeType('fastapi')).toBe(true);
    expect(hasCatalogForNodeType('database')).toBe(false);
    expect(hasCatalogForNodeType(undefined)).toBe(false);
  });
});
