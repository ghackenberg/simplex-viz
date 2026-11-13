# Changelog

Alle relevanten Änderungen an **SimplexViz** (`@simplex-viz/core`, `@simplex-viz/svg`, `@simplex-viz/react`) werden in dieser Datei im Format [Keep a Changelog](https://keepachangelog.com/de/1.1.0/) dokumentiert und über `@changesets/cli` verwaltet.

## [0.2.0] - 2026-11-13

### Hinzugefügt
- **`@simplex-viz/core`**:
  - Synchrone One-Shot-Funktion `solveSimplexSnapshot(items, options?)` für überlappungsfreie Layouts ohne `SimplexRendererAdapter` oder Animationsschleife.
- **`@simplex-viz/svg`**:
  - Einzeiler-Factory `createSimplexSvg(target, itemsOrOptions)`, CSS-Selektor-Support in `SimplexSvgController`, drei eingebaute Presets (`'geometric'`, `'glyphs'`, `'badges'`), Standard-Interaktivität (`zoom-to-cursor` + `focusOnClusterClick`), optionaler DOM-Hover-Tooltip sowie Re-Exports zentraler Core-Helfer und Typen.
- **`@simplex-viz/react`**:
  - Zero-Config `<SimplexTopicGraph items={items} preset="glyphs" tooltip />`, Keyless-JSX-Renderer (`renderContentNode`/`renderClusterNode` ohne `VisualResolver`), eingebautes React-Tooltip-Overlay sowie Re-Exports aus `@simplex-viz/svg` und `@simplex-viz/core`.
- **Demo-App & Dokumentation**:
  - Selbst gehostete Fonts via `@fontsource` (ohne Google-Fonts-CDN-Anfragen), vereinfachtes Ein-Dreieck-Logo sowie Quickstart-first-Dokumentation in allen READMEs.

## [0.1.0] - 2026-11-13

### Hinzugefügt
- **`@simplex-viz/core`**:
  - Dynamischer gezahnter $60^\circ$-Simplex-Mesh-Generator (`buildSimplexMesh`) mit $0^\circ$/$90^\circ$-Orientierungs- und Paritäts-Optimierung.
  - Zweistufiges Themen-Clustering (`computeSimplexClustering`) mit regularisierter Jaccard-Partition, Simulated Annealing QAP-Einbettung, Weighted-Hitting-Set mit Rückwärts-Pruning, Explaining-Away-Einheitszuordnung und Ungarischem Bipartite Matching.
  - Perzeptuelle OKLab-Farbzuweisung und chroma-erhaltende Farbmischung.
  - Exakte konvexe Hüllen-Kollisionsprüfung (`computeConvexMtv` für Kreis/Kreis, Kreis/Polygon und Polygon/Polygon SAT) sowie hierarchischer Zwei-Phasen-Solver (`solveTwoPhaseLayout`) mit `0.0 px` Überlappungsgarantie.
  - Unterbrechbare, kritisch gedämpfte Feder-Integratoren (`stepCriticallyDampedSpring`) und Dual-Layer-Transition-Tracker.
  - Schemafreie, bedingte Hybrid-Accessors (`ItemIdentityConfig`) und Ende-zu-Ende-typsichere Tag-/Cluster-Metadaten (`TTagMeta`, `TClusterMeta`).
- **`@simplex-viz/svg`**:
  - Framework-unabhängige `SvgRendererAdapter`-Engine mit Keyed DOM Reconciliation, Offscreen-`getBBox()`-Vermessung und universellem Dual-Layer-Crossfade.
  - Zentrales Root-SVG-Pointer-Handling (`SimplexSvgController`) und 4 modulare `SvgNodeView`-Plugins (`GeometricShapeSvgView` mit 64-Punkt-Morphing, `MultiSectorGlyphSvgView`, `BadgeClusterSvgView`, `ClusterAnchorSvgView`).
- **`@simplex-viz/react`**:
  - Typsichere `<SimplexTopicGraph />`-Komponente und `useSimplexGraphController`-Hook mit Unterstützung für portierbare `SvgNodeView`-Plugins sowie deklarative JSX-Render-Props (`renderContentNode`, `renderClusterNode`).
- **Demo-App & CI/CD**:
  - Interaktive Showcase-Applikation mit 3 live umschaltbaren Darstellungs-Welten, Rapid-Fire-Stresstest, Kollisions-Inspektor und Interaktions-Konfigurator.
  - Vollständige Vitest-Testsuite, ESLint-Modulgrenzen-Regeln, Changesets-Konfiguration und GitHub-Actions-Workflows (`ci.yml`, `deploy-pages.yml`, `release.yml`).
