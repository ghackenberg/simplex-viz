import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type * as tsTypes from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const ts = require('@typescript/typescript6') as typeof tsTypes;

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const PACKAGE_NAMES = ['core', 'svg', 'canvas', 'react', 'wc'] as const;

interface PackageExportTarget {
  readonly types?: string;
  readonly import?: string;
}

interface PackageJsonShape {
  readonly name: string;
  readonly sideEffects?: boolean | readonly string[];
  readonly exports: Readonly<Record<string, PackageExportTarget>>;
}

interface DocumentedEntryPoint {
  readonly subpath: string;
  readonly importPath: string;
  readonly environment: string;
  readonly domFree: boolean;
  readonly sideEffects: boolean;
  readonly rootReExported: boolean;
  readonly summary: string;
}

interface DocumentedExportRow {
  readonly symbol: string;
  readonly entrypoint?: string;
  readonly kind: string;
  readonly summary: string;
}

interface ParsedApiMdx {
  readonly packageName: string;
  readonly entryPoints: readonly DocumentedEntryPoint[];
  readonly exportsTable: readonly DocumentedExportRow[];
}

function unquoteYamlScalar(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
  }
  return trimmed;
}

function parseApiMdxFrontmatter(filePath: string): ParsedApiMdx {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') {
    throw new Error(`Missing frontmatter start delimiter in ${filePath}`);
  }
  const endIdx = lines.indexOf('---', 1);
  if (endIdx < 0) {
    throw new Error(`Missing frontmatter end delimiter in ${filePath}`);
  }
  const fmLines = lines.slice(1, endIdx);

  let packageName = '';
  const entryPoints: Record<string, string | boolean>[] = [];
  const exportsTable: Record<string, string>[] = [];

  let section: 'root' | 'entryPoints' | 'exportsTable' = 'root';
  let currentItem: Record<string, string | boolean> | null = null;
  let inMultilineBlock = false;
  let multilineIndent = 0;

  for (const line of fmLines) {
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;

    if (inMultilineBlock) {
      if (indent >= multilineIndent) {
        continue;
      }
      inMultilineBlock = false;
    }

    if (indent === 0) {
      currentItem = null;
      const topMatch = /^([a-zA-Z0-9_]+):\s*(.*)$/.exec(line);
      if (!topMatch) continue;
      const [, key, val] = topMatch;
      if (key === 'entryPoints') {
        section = 'entryPoints';
      } else if (key === 'exportsTable') {
        section = 'exportsTable';
      } else {
        section = 'root';
        if (key === 'packageName') {
          packageName = unquoteYamlScalar(val ?? '');
        }
      }
      continue;
    }

    if (section === 'root') continue;

    if (indent === 2 && line.trimStart().startsWith('- ')) {
      currentItem = {};
      if (section === 'entryPoints') {
        entryPoints.push(currentItem);
      } else {
        exportsTable.push(currentItem as Record<string, string>);
      }
      const afterDash = line.trimStart().slice(2);
      const kvMatch = /^([a-zA-Z0-9_]+):\s*(.*)$/.exec(afterDash);
      if (kvMatch) {
        const [, k, v] = kvMatch;
        const cleanVal = unquoteYamlScalar(v ?? '');
        if (cleanVal === 'true' || cleanVal === 'false') {
          currentItem[k!] = cleanVal === 'true';
        } else {
          currentItem[k!] = cleanVal;
        }
      }
      continue;
    }

    if (currentItem && indent === 4) {
      const kvMatch = /^([a-zA-Z0-9_]+):\s*(.*)$/.exec(line.trimStart());
      if (!kvMatch) continue;
      const [, k, v] = kvMatch;
      const trimmedVal = (v ?? '').trim();
      if (trimmedVal === '|-' || trimmedVal === '|') {
        inMultilineBlock = true;
        multilineIndent = 6;
        currentItem[k!] = '';
      } else if (trimmedVal === 'true' || trimmedVal === 'false') {
        currentItem[k!] = trimmedVal === 'true';
      } else {
        currentItem[k!] = unquoteYamlScalar(trimmedVal);
      }
    }
  }

  return {
    packageName,
    entryPoints: entryPoints as unknown as readonly DocumentedEntryPoint[],
    exportsTable: exportsTable as unknown as readonly DocumentedExportRow[],
  };
}

function getDtsExportedNames(dtsPaths: readonly string[]): Map<string, ReadonlySet<string>> {
  const options: tsTypes.CompilerOptions = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
    skipLibCheck: true,
  };
  const program = ts.createProgram([...dtsPaths], options);
  const checker = program.getTypeChecker();
  const result = new Map<string, ReadonlySet<string>>();

  for (const dtsPath of dtsPaths) {
    const sf = program.getSourceFile(dtsPath);
    if (!sf) {
      throw new Error(`TypeScript could not load declaration file: ${dtsPath}`);
    }
    const modSymbol = checker.getSymbolAtLocation(sf);
    if (!modSymbol) {
      result.set(dtsPath, new Set());
      continue;
    }
    const exports = checker.getExportsOfModule(modSymbol);
    result.set(
      dtsPath,
      new Set(exports.map((sym) => sym.getName())),
    );
  }

  return result;
}

describe('Documentation & package.json subpath contract verification', () => {
  const pkgRecords: Array<{
    readonly shortName: (typeof PACKAGE_NAMES)[number];
    readonly pkgJson: PackageJsonShape;
    readonly apiMdx: ParsedApiMdx;
  }> = [];

  beforeAll(() => {
    const missingAnyDist = PACKAGE_NAMES.some((pkg) => {
      const pkgJsonPath = path.join(REPO_ROOT, 'packages', pkg, 'package.json');
      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')) as PackageJsonShape;
      return Object.values(pkgJson.exports).some((target) => {
        const typesMissing = target.types
          ? !fs.existsSync(path.join(REPO_ROOT, 'packages', pkg, target.types))
          : false;
        const jsMissing = target.import
          ? !fs.existsSync(path.join(REPO_ROOT, 'packages', pkg, target.import))
          : false;
        return typesMissing || jsMissing;
      });
    });

    if (missingAnyDist) {
      execFileSync('npm', ['run', 'build:packages'], {
        cwd: REPO_ROOT,
        stdio: 'pipe',
      });
    }

    for (const shortName of PACKAGE_NAMES) {
      const pkgJsonPath = path.join(REPO_ROOT, 'packages', shortName, 'package.json');
      const apiMdxPath = path.join(REPO_ROOT, 'src', 'content', 'api', `${shortName}.mdx`);
      pkgRecords.push({
        shortName,
        pkgJson: JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')) as PackageJsonShape,
        apiMdx: parseApiMdxFrontmatter(apiMdxPath),
      });
    }
  }, 60_000);

  it('keeps package.json#exports and sideEffects in exact 1:1 sync with API docs entryPoints', () => {
    for (const { shortName, pkgJson, apiMdx } of pkgRecords) {
      expect(apiMdx.packageName).toBe(pkgJson.name);

      const exportedSubpaths = Object.keys(pkgJson.exports).sort();
      const documentedSubpaths = apiMdx.entryPoints.map((ep) => ep.subpath).sort();
      expect(documentedSubpaths, `${shortName} subpaths mismatch`).toEqual(exportedSubpaths);

      for (const ep of apiMdx.entryPoints) {
        const expectedImportPath =
          ep.subpath === '.'
            ? pkgJson.name
            : `${pkgJson.name}/${ep.subpath.replace(/^\.\//, '')}`;
        expect(ep.importPath).toBe(expectedImportPath);

        const target = pkgJson.exports[ep.subpath];
        expect(target?.import).toBeTruthy();
        expect(target?.types).toBeTruthy();

        const resolvedJs = path.join(REPO_ROOT, 'packages', shortName, target!.import!);
        const resolvedDts = path.join(REPO_ROOT, 'packages', shortName, target!.types!);
        expect(fs.existsSync(resolvedJs)).toBe(true);
        expect(fs.existsSync(resolvedDts)).toBe(true);

        const expectedSideEffects =
          Array.isArray(pkgJson.sideEffects)
            ? pkgJson.sideEffects.includes(target!.import!)
            : Boolean(pkgJson.sideEffects);
        expect(ep.sideEffects, `${ep.importPath} sideEffects mismatch`).toBe(
          expectedSideEffects,
        );
      }
    }
  });

  it('verifies every documented export symbol exists in its declared .d.ts entrypoint and respects root re-export contracts', () => {
    const allDtsPaths: string[] = [];
    for (const { shortName, pkgJson } of pkgRecords) {
      for (const target of Object.values(pkgJson.exports)) {
        if (target.types) {
          allDtsPaths.push(path.join(REPO_ROOT, 'packages', shortName, target.types));
        }
      }
    }

    const exportsByDts = getDtsExportedNames(allDtsPaths);

    for (const { shortName, pkgJson, apiMdx } of pkgRecords) {
      const epMap = new Map(apiMdx.entryPoints.map((ep) => [ep.importPath, ep]));
      const rootTypesRel = pkgJson.exports['.']?.types;
      expect(rootTypesRel).toBeTruthy();
      const rootDtsPath = path.join(REPO_ROOT, 'packages', shortName, rootTypesRel!);
      const rootExports = exportsByDts.get(rootDtsPath);
      expect(rootExports).toBeDefined();

      for (const row of apiMdx.exportsTable) {
        const effectiveImportPath = row.entrypoint ?? pkgJson.name;
        const epMeta = epMap.get(effectiveImportPath);
        expect(epMeta, `Unknown entrypoint ${effectiveImportPath} for ${row.symbol}`).toBeDefined();

        if (row.kind === 'Subpath') {
          expect(row.symbol).toBe(effectiveImportPath);
          continue;
        }

        const target = pkgJson.exports[epMeta!.subpath]!;
        const dtsPath = path.join(REPO_ROOT, 'packages', shortName, target.types!);
        const epExports = exportsByDts.get(dtsPath);
        expect(epExports?.has(row.symbol), `${effectiveImportPath} missing symbol ${row.symbol}`).toBe(true);

        if (epMeta!.subpath !== '.') {
          if (epMeta!.rootReExported) {
            expect(
              rootExports!.has(row.symbol),
              `Expected root ${pkgJson.name} to re-export ${row.symbol}`,
            ).toBe(true);
          } else {
            expect(
              rootExports!.has(row.symbol),
              `Exclusive subpath ${effectiveImportPath} symbol ${row.symbol} leaked into root ${pkgJson.name}`,
            ).toBe(false);
          }
        }
      }
    }

    // Explicitly verify zero @simplex-viz/core/dom runtime/DOM-helper exports leak onto @simplex-viz/core root
    const coreRootDts = path.join(REPO_ROOT, 'packages', 'core', 'dist', 'index.d.ts');
    const coreDomDts = path.join(REPO_ROOT, 'packages', 'core', 'dist', 'dom.d.ts');
    const coreRootExports = exportsByDts.get(coreRootDts)!;
    const coreDomExports = exportsByDts.get(coreDomDts)!;
    expect(coreDomExports.size).toBeGreaterThan(15);
    for (const domSym of coreDomExports) {
      expect(
        coreRootExports.has(domSym),
        `@simplex-viz/core/dom symbol ${domSym} must NOT leak onto @simplex-viz/core root`,
      ).toBe(false);
    }
  });

  it('documents an Entry Points section in READMEs of all multi-entrypoint packages', () => {
    for (const { shortName, apiMdx } of pkgRecords) {
      if (apiMdx.entryPoints.length <= 1) continue;
      const readmePath = path.join(REPO_ROOT, 'packages', shortName, 'README.md');
      const readme = fs.readFileSync(readmePath, 'utf8');
      expect(readme).toContain('### Entry Points');
      for (const ep of apiMdx.entryPoints) {
        expect(readme).toContain(`\`${ep.importPath}\``);
      }
    }
  });
});
