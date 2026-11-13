# Contributing to SimplexViz

Vielen Dank für dein Interesse an **SimplexViz**! Dieses Dokument beschreibt das lokale Workspace-Setup, die strikten Architektur-Grenzen und den Release-Workflow.

## Lokales Setup

```bash
pnpm install
pnpm dev          # Startet Demo-App auf Port 3000 (direkt gegen Paket-Quelltexte)
pnpm test         # Führt Vitest-Testsuite aus
pnpm lint         # Prüft ESLint Flat Config + TypeScript-Modulgrenzen
```

## Strikte Architektur- & Modulgrenzen

Die Trennung der drei Pakete wird mechanisch über TypeScript (`packages/core/tsconfig.json`) und ESLint (`eslint.config.js`) erzwungen:

1. **`@simplex-viz/core`** (`packages/core`):
   - **Keine** Laufzeit-Abhängigkeiten (`"dependencies": {}`).
   - **Kein** DOM (`lib: ["ES2022"]` ohne `"DOM"`), kein `window`, kein `document`, kein `SVGElement`.
   - **Kein** Import von `react`, `react-dom`, `@simplex-viz/svg` oder `@simplex-viz/react`.
2. **`@simplex-viz/svg`** (`packages/svg`):
   - Hängt ausschließlich von `@simplex-viz/core` ab.
   - **Kein** Import von `react`, `react-dom` oder `@simplex-viz/react`.
3. **Keine `any`- oder `as unknown`-Casts** beim Durchreichen generischer Typen (`TItem`, `TTagMeta`, `TClusterMeta`, `TContentVisual`, `TClusterVisual`).

## Eigene `SvgNodeView`-Plugins entwickeln

1. Definiere einen reinen Daten-Deskriptor `TVisual` ohne DOM-Referenzen.
2. Implementiere `mountOrUpdate(groupEl, visual, state)` um den lokalen Ursprung `(0, 0)`.
3. Implementiere optional `measureConvexHull(visual)` für analytische Konvexhüllen oder lasse die Methode weg, damit `@simplex-viz/svg` automatisch per Offscreen-`getBBox()` vermisst.
4. Ergänze Tests unter `packages/svg/__tests__` und führe `pnpm test` sowie `pnpm build:packages` aus.

## Changesets & Pull Requests

Erstelle für nutzerrelevante Änderungen ein Changeset:

```bash
pnpm changeset
```

Wähle die betroffenen Pakete (`@simplex-viz/core`, `@simplex-viz/svg`, `@simplex-viz/react`), den SemVer-Typ (`patch`, `minor`, `major`) und füge eine präzise Beschreibung hinzu. Stelle vor dem PR sicher, dass `pnpm lint`, `pnpm test` und `pnpm build:packages` erfolgreich durchlaufen.
