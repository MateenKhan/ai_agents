import { parse } from '@typescript-eslint/typescript-estree';
import type { TSESTree } from '@typescript-eslint/typescript-estree';
import { readFileSync, statSync } from 'fs';
import { createHash } from 'crypto';

export interface ParsedNode {
  name: string;
  type: 'function' | 'class' | 'component' | 'hook' | 'interface' | 'type' | 'ui_element';
  startLine: number;
  endLine: number;
  signature: string;
  notes?: string;
}

export interface ParsedFile {
  path: string;
  language: string;
  hash: string;
  lastModified: number;
  nodes: ParsedNode[];
  imports: string[];
}

export function parseFile(absPath: string, rootDir: string): ParsedFile | null {
  try {
    const content = readFileSync(absPath, 'utf-8');
    const stat = statSync(absPath);
    const hash = createHash('md5').update(content).digest('hex');
    const isTsx = absPath.endsWith('.tsx') || absPath.endsWith('.jsx');
    const language = absPath.endsWith('.tsx') ? 'tsx'
      : absPath.endsWith('.ts')  ? 'typescript'
      : absPath.endsWith('.jsx') ? 'jsx'
      : 'javascript';

    const ast = parse(content, { jsx: isTsx, loc: true, tokens: false, comment: false });

    const lines = content.split('\n');
    const nodes: ParsedNode[] = [];
    const imports: string[] = [];

    const sig = (line: number) => lines[line - 1]?.trim().slice(0, 120) ?? '';
    const isComp = (n: string) => /^[A-Z]/.test(n);
    const isHook = (n: string) => /^use[A-Z]/.test(n);
    const nodeType = (n: string): ParsedNode['type'] =>
      isComp(n) ? 'component' : isHook(n) ? 'hook' : 'function';

    function visit(node: TSESTree.Node) {
      switch (node.type) {
        case 'ImportDeclaration': {
          const src = node.source.value as string;
          if (src.startsWith('.')) imports.push(src);
          break;
        }
        case 'FunctionDeclaration':
        case 'TSDeclareFunction': {
          const n = (node as TSESTree.FunctionDeclaration).id?.name;
          if (n) nodes.push({ name: n, type: nodeType(n), startLine: node.loc.start.line, endLine: node.loc.end.line, signature: sig(node.loc.start.line) });
          break;
        }
        case 'ClassDeclaration': {
          const n = (node as TSESTree.ClassDeclaration).id?.name;
          if (n) nodes.push({ name: n, type: 'class' as any, startLine: node.loc.start.line, endLine: node.loc.end.line, signature: sig(node.loc.start.line) });
          break;
        }
        case 'VariableDeclaration': {
          for (const decl of (node as TSESTree.VariableDeclaration).declarations) {
            if (decl.id.type === 'Identifier' && decl.init) {
              const n = decl.id.name;
              const t = decl.init.type;
              if (t === 'ArrowFunctionExpression' || t === 'FunctionExpression') {
                nodes.push({ name: n, type: nodeType(n), startLine: node.loc.start.line, endLine: decl.init.loc.end.line, signature: sig(node.loc.start.line) });
              }
            }
          }
          break;
        }
        case 'TSInterfaceDeclaration': {
          const n = (node as TSESTree.TSInterfaceDeclaration).id?.name;
          if (n) nodes.push({ name: n, type: 'interface', startLine: node.loc.start.line, endLine: node.loc.end.line, signature: sig(node.loc.start.line) });
          break;
        }
        case 'TSTypeAliasDeclaration': {
          const n = (node as TSESTree.TSTypeAliasDeclaration).id?.name;
          if (n) nodes.push({ name: n, type: 'type', startLine: node.loc.start.line, endLine: node.loc.end.line, signature: sig(node.loc.start.line) });
          break;
        }
        case 'JSXOpeningElement': {
          const el = node as TSESTree.JSXOpeningElement;
          let idVal = '';
          let titleVal = '';
          const tagName = el.name.type === 'JSXIdentifier' ? el.name.name : 'element';
          
          for (const attr of el.attributes) {
            if (attr.type === 'JSXAttribute' && attr.name.type === 'JSXIdentifier') {
              if (attr.name.name === 'id' && attr.value?.type === 'Literal') {
                idVal = String(attr.value.value);
              }
              if (attr.name.name === 'title' && attr.value?.type === 'Literal') {
                titleVal = String(attr.value.value);
              }
              if (attr.name.name === 'data-feature-id' && attr.value?.type === 'Literal') {
                idVal = String(attr.value.value);
              }
              if (tagName === 'InspectorBadge' && attr.name.name === 'targetId' && attr.value?.type === 'Literal') {
                idVal = String(attr.value.value);
                titleVal = 'InspectorBadge Target';
              }
            }
          }
          if (idVal) {
            nodes.push({
              name: idVal,
              type: 'ui_element',
              startLine: node.loc.start.line,
              endLine: node.loc.end.line,
              signature: `<${tagName} id="${idVal}">`,
              notes: titleVal || undefined
            });
          }
          break;
        }
      }
      for (const key of Object.keys(node)) {
        const child = (node as any)[key];
        if (child && typeof child === 'object') {
          if (Array.isArray(child)) child.forEach(c => c?.type && visit(c));
          else if (child.type) visit(child);
        }
      }
    }

    visit(ast as unknown as TSESTree.Node);

    const relPath = absPath.replace(rootDir, '').replace(/\\/g, '/').replace(/^\//, '');
    return { path: relPath, language, hash, lastModified: Math.floor(stat.mtimeMs), nodes, imports };
  } catch {
    return null;
  }
}

export function parseCssFile(absPath: string, rootDir: string): ParsedFile | null {
  try {
    const content = readFileSync(absPath, 'utf-8');
    const stat = statSync(absPath);
    const hash = createHash('md5').update(content).digest('hex');
    const lines = content.split('\n');
    const nodes: ParsedNode[] = [];

    // Extract selector blocks: lines ending with { that aren't @keyframes frames
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line.endsWith('{') || line.startsWith('//') || line.startsWith('*')) continue;
      const selector = line.slice(0, -1).trim();
      if (!selector || selector.startsWith('@keyframes') || /^\d+%$/.test(selector)) continue;

      // Find closing brace to determine end line
      let depth = 1;
      let end = i + 1;
      while (end < lines.length && depth > 0) {
        const l = lines[end];
        depth += (l.match(/\{/g) || []).length - (l.match(/\}/g) || []).length;
        end++;
      }

      // Collect properties for signature (up to 3 lines after opening)
      const props = lines.slice(i + 1, Math.min(i + 4, end))
        .map(l => l.trim()).filter(Boolean).join(' ');

      nodes.push({
        name: selector,
        type: 'type' as any, // reuse 'type' slot for CSS selectors
        startLine: i + 1,
        endLine: end,
        signature: `${selector} { ${props} }`,
      });
    }

    const relPath = absPath.replace(rootDir, '').replace(/\\/g, '/').replace(/^\//, '');
    return { path: relPath, language: 'css', hash, lastModified: Math.floor(stat.mtimeMs), nodes, imports: [] };
  } catch {
    return null;
  }
}

export function resolveImportPath(fromDir: string, importStr: string): string {
  const parts = (fromDir + '/' + importStr).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.') out.push(p);
  }
  return out.join('/');
}
