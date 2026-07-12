import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen, ChevronDown, ChevronRight, ExternalLink, Loader2, Search, X,
} from 'lucide-react';
import type { CatalogCategory, CatalogOption, FrameworkCatalog } from '../data/catalogTypes';

// Lazy loaders keyed by React Flow node type. The catalogs are ~4k lines of data in
// total, so they must never be pulled into the initial /canvas chunk — each one is
// dynamically imported the first time a node of that framework is inspected.
const CATALOG_LOADERS: Record<string, () => Promise<FrameworkCatalog>> = {
  springBoot: () => import('../data/springCatalog').then((m) => m.SPRING_CATALOG),
  nestjs: () => import('../data/nestCatalog').then((m) => m.NEST_CATALOG),
  nextjs: () => import('../data/nextCatalog').then((m) => m.NEXT_CATALOG),
  fastapi: () => import('../data/fastapiCatalog').then((m) => m.FASTAPI_CATALOG),
};

/** Node types that have an exhaustive framework catalog behind them. */
export const hasCatalogForNodeType = (nodeType: string | undefined): boolean =>
  !!nodeType && nodeType in CATALOG_LOADERS;

/** Node-data key under which checked catalog option ids are persisted. */
export const SELECTED_CATALOG_OPTIONS_KEY = 'selectedCatalogOptionIds';

interface CatalogInspectorProps {
  nodeId: string;
  nodeType: string;
  nodeData: Record<string, unknown>;
  /** Same updater the existing inspectors use: replaces the node's data object. */
  onUpdateNode: (id: string, data: Record<string, unknown>) => void;
  onClose?: () => void;
  /** Inject a catalog directly (used by tests / storybook); skips the lazy import. */
  catalog?: FrameworkCatalog;
}

const matchesQuery = (option: CatalogOption, q: string): boolean =>
  option.label.toLowerCase().includes(q) || option.description.toLowerCase().includes(q);

/** Keep an option when it (or any descendant) matches; prune non-matching children. */
const filterOptions = (options: CatalogOption[], q: string): CatalogOption[] =>
  options.reduce<CatalogOption[]>((acc, option) => {
    const filteredChildren = option.children ? filterOptions(option.children, q) : undefined;
    if (matchesQuery(option, q)) {
      // Direct hit: keep the option with all of its children intact.
      acc.push(option);
    } else if (filteredChildren && filteredChildren.length > 0) {
      acc.push({ ...option, children: filteredChildren });
    }
    return acc;
  }, []);

const StatusBadge: React.FC<{ option: CatalogOption }> = ({ option }) => {
  if (!option.status || option.status === 'ga') return null;
  const isDeprecated = option.status === 'deprecated';
  return (
    <span
      className={`inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full border ${
        isDeprecated
          ? 'bg-rose-50 text-rose-700 border-rose-200'
          : 'bg-amber-50 text-amber-700 border-amber-200'
      }`}
    >
      {option.status}
      {option.successor && (
        <span className="normal-case font-semibold">&rarr; {option.successor}</span>
      )}
    </span>
  );
};

interface OptionRowProps {
  option: CatalogOption;
  depth: number;
  selectedIds: Set<string>;
  onToggle: (optionId: string, checked: boolean) => void;
  /** When searching, child accordions open automatically so hits are visible. */
  forceExpandChildren: boolean;
}

const OptionRow: React.FC<OptionRowProps> = ({
  option, depth, selectedIds, onToggle, forceExpandChildren,
}) => {
  const [childrenOpen, setChildrenOpen] = useState(false);
  const hasChildren = !!option.children && option.children.length > 0;
  const showChildren = hasChildren && (childrenOpen || forceExpandChildren);
  const checked = selectedIds.has(option.id);

  return (
    <div data-testid={`catalog-option-${option.id}`}>
      <div
        className="group flex items-start gap-2 py-1.5 pr-1 rounded-md hover:bg-slate-50 transition-colors"
        style={{ paddingLeft: depth * 14 }}
      >
        <input
          type="checkbox"
          aria-label={option.label}
          checked={checked}
          onChange={(e) => onToggle(option.id, e.target.checked)}
          className="mt-0.5 shrink-0 accent-blue-600 cursor-pointer"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold text-slate-800">{option.label}</span>
            <a
              href={option.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={`Open official docs for ${option.label}`}
              aria-label={`Docs: ${option.label}`}
              className="text-slate-400 hover:text-blue-600 transition-colors shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink size={11} />
            </a>
            <StatusBadge option={option} />
          </div>
          <div className="text-[10px] text-slate-500 truncate" title={option.description}>
            {option.description}
          </div>
        </div>
        {hasChildren && (
          <button
            type="button"
            onClick={() => setChildrenOpen((prev) => !prev)}
            aria-label={`${showChildren ? 'Collapse' : 'Expand'} sub-options of ${option.label}`}
            className="p-0.5 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors shrink-0"
          >
            {showChildren ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        )}
      </div>
      {showChildren && (
        <div className="border-l border-slate-100 ml-1.5">
          {option.children!.map((child) => (
            <OptionRow
              key={child.id}
              option={child}
              depth={depth + 1}
              selectedIds={selectedIds}
              onToggle={onToggle}
              forceExpandChildren={forceExpandChildren}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const countOptions = (options: CatalogOption[]): number =>
  options.reduce((acc, o) => acc + 1 + (o.children ? countOptions(o.children) : 0), 0);

export const CatalogInspector: React.FC<CatalogInspectorProps> = ({
  nodeId, nodeType, nodeData, onUpdateNode, onClose, catalog: injectedCatalog,
}) => {
  const [loadedCatalog, setLoadedCatalog] = useState<FrameworkCatalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({});

  const catalog = injectedCatalog ?? loadedCatalog;

  useEffect(() => {
    if (injectedCatalog) return;
    const loader = CATALOG_LOADERS[nodeType];
    if (!loader) {
      setLoadError(`No catalog registered for node type "${nodeType}"`);
      return;
    }
    let cancelled = false;
    setLoadedCatalog(null);
    setLoadError(null);
    loader()
      .then((loaded) => {
        if (!cancelled) setLoadedCatalog(loaded);
      })
      .catch(() => {
        if (!cancelled) setLoadError('Failed to load the option catalog.');
      });
    return () => {
      cancelled = true;
    };
  }, [nodeType, injectedCatalog]);

  // Categories collapsed by default except the first one.
  useEffect(() => {
    if (!catalog) return;
    setOpenCategories(
      Object.fromEntries(catalog.categories.map((c, index) => [c.id, index === 0]))
    );
    setSearchQuery('');
  }, [catalog]);

  const selectedIds = useMemo(() => {
    const raw = nodeData[SELECTED_CATALOG_OPTIONS_KEY];
    return new Set(Array.isArray(raw) ? (raw as string[]) : []);
  }, [nodeData]);

  const handleToggle = (optionId: string, checked: boolean) => {
    const next = new Set(selectedIds);
    if (checked) next.add(optionId);
    else next.delete(optionId);
    onUpdateNode(nodeId, {
      ...nodeData,
      [SELECTED_CATALOG_OPTIONS_KEY]: Array.from(next).sort(),
    });
  };

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const isSearching = trimmedQuery.length > 0;

  const visibleCategories: CatalogCategory[] = useMemo(() => {
    if (!catalog) return [];
    if (!isSearching) return catalog.categories;
    return catalog.categories
      .map((category) => ({ ...category, options: filterOptions(category.options, trimmedQuery) }))
      .filter((category) => category.options.length > 0);
  }, [catalog, isSearching, trimmedQuery]);

  const toggleCategory = (categoryId: string) => {
    setOpenCategories((prev) => ({ ...prev, [categoryId]: !prev[categoryId] }));
  };

  return (
    <div
      data-testid="catalog-inspector"
      className="w-80 bg-white border-r border-slate-200 flex flex-col h-full shrink-0 select-none shadow-sm"
    >
      <div className="p-3.5 border-b border-slate-200 bg-slate-50/80">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
            <BookOpen size={14} className="text-slate-600" />
            {catalog ? catalog.label : 'Framework Options'}
          </h2>
          <div className="flex items-center gap-1.5">
            {catalog && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200">
                {selectedIds.size} selected
              </span>
            )}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close catalog inspector"
                className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
        <div className="text-[10px] text-slate-500 mb-2 truncate">
          Configuring <span className="font-bold text-slate-700">{(nodeData.label as string) || nodeId}</span>
        </div>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search options..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all placeholder:text-slate-400 text-slate-700"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
        {loadError ? (
          <div className="p-6 text-center text-xs text-rose-500">{loadError}</div>
        ) : !catalog ? (
          <div className="p-6 flex items-center justify-center gap-2 text-xs text-slate-400">
            <Loader2 size={14} className="animate-spin" />
            Loading option catalog...
          </div>
        ) : visibleCategories.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400">
            No options match your search
          </div>
        ) : (
          visibleCategories.map((category) => {
            // A search auto-expands every category that still has matches.
            const isOpen = isSearching || (openCategories[category.id] ?? false);
            return (
              <div key={category.id} className="py-1">
                <button
                  type="button"
                  onClick={() => toggleCategory(category.id)}
                  className="w-full flex items-center justify-between px-3.5 py-2 hover:bg-slate-50 transition-colors text-left"
                >
                  <span className="text-xs font-bold text-slate-800">{category.label}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-semibold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded-full border border-slate-200">
                      {countOptions(category.options)}
                    </span>
                    {isOpen ? (
                      <ChevronDown size={14} className="text-slate-400" />
                    ) : (
                      <ChevronRight size={14} className="text-slate-400" />
                    )}
                  </div>
                </button>
                {isOpen && (
                  <div className="px-2.5 pb-2">
                    {category.options.map((option) => (
                      <OptionRow
                        key={option.id}
                        option={option}
                        depth={0}
                        selectedIds={selectedIds}
                        onToggle={handleToggle}
                        forceExpandChildren={isSearching}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="p-2.5 border-t border-slate-200 bg-slate-50 text-[10px] text-slate-500 text-center font-medium">
        Checked options are stored on the node and drive code generation
      </div>
    </div>
  );
};
