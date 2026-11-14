# Changelog

Alle relevanten Änderungen an **SimplexViz** (`@simplex-viz/core`, `@simplex-viz/svg`, `@simplex-viz/react`) werden in dieser Datei im Format [Keep a Changelog](https://keepachangelog.com/de/1.1.0/) dokumentiert und über `@changesets/cli` verwaltet.

## [0.4.0] - 2026-11-14

### Hinzugefügt
- **`@simplex-viz/core`**:
  - Baryzentrisches Dreiecks-Hit-Testing (`isPointInTriangle`, `HitTarget` `kind: 'triangle'`), `onTriangleHover`, `setFocusedTriangleIndex` sowie angereicherte `MeshTriangleRenderState`- und `MeshEdgeRenderState`-Snapshots.
- **`@simplex-viz/svg`**:
  - Austauschbare Plugins für Triangulations-Dreiecksflächen (`SvgTriangleView`: `OklabTintTriangleSvgView`, `GradientTriangleSvgView` mit durchgängigem baryzentrischem Shading, `BarycentricSectorTriangleSvgView`, `BlueprintInsetTriangleSvgView`, `DensityHeatmapTriangleSvgView`) und Mesh-Kanten (`SvgEdgeView`: `DashedMeshEdgeSvgView`, `ClusterTintedEdgeSvgView`, `PrecisionRailEdgeSvgView`, `MinimalHighlightEdgeSvgView`) inkl. Laufzeit-Wechsel über `setTriangleView`, `setEdgeView` und `setViews`.
  - Klickbare und hoverbare Dreiecksflächen mit `focusOnTriangleClick`, `onTriangleHover`, integrierten Dreiecks-Tooltips (`target.kind === 'triangle'`) und nahtlosem Drag-to-Pan über Dreiecken.
- **`@simplex-viz/react`**:
  - Neue Render- & Interaktions-Props (`triangleView`, `edgeView`, `focusedTriangleIndex`, `focusOnTriangleClick`, `onTriangleHover`), erweiterter `SimplexReactTooltipTarget` (`'triangle'`) und imperative Setter (`setTriangleView`, `setEdgeView`, `setFocusedTriangleIndex`) in `useSimplexGraphController`.
- **Demo-App & Dokumentation**:
  - Unabhängige Controls für Dreiecksflächen (inkl. *Continuous Barycentric Gradient*) und Mesh-Kanten sowie interaktive Dreiecks-Tooltips, Dreiecks-Fokus/Inspektor und Rechtsklick-Kontextmenü.

## [0.3.0] - 2026-11-14

### Hinzugefügt
- **`@simplex-viz/core`**:
  - Austauschbare Strategie-Schnittstellen über die gesamte Pipeline (`SimplexMeshStrategy`, `SimplexClusteringStrategy` mit getrenntem `initialize`/`update` sowie `sharedTagRule` & `anchorRule`, `SimplexColorStrategy`, `SimplexLayoutStrategy`).
  - Eingebaute Strategie-Factories (`createAdaptiveHexMeshStrategy`, `createFixedLatticeMeshStrategy`, `createJaccardAnnealingClusteringStrategy`, `createIncrementalAnchorClusteringStrategy`, `createOklabContrastColorStrategy`, `createThemeAdaptiveOklabColorStrategy`, `createPaletteColorStrategy`, `createPbdUniformLayoutStrategy`, `createWarmStartPbdLayoutStrategy`, `createLocalAdaptiveLayoutStrategy`) inkl. Laufzeit-Wechsel auf `SimplexGraphEngine` (`setMeshStrategy`, `setClusteringStrategy`, `setColorStrategy`, `setLayoutStrategy`).
- **`@simplex-viz/svg`**:
  - Multi-Touch **2-Finger Pinch-to-Zoom & Touch-Pan** sowie `pointercancel`-Bereinigung in `SimplexSvgController`.
  - Synchroner `cameraProxy`-Render-Sync (`engine.renderNow()`), sodass Zoom/Pan/Reset ohne Verzögerung im SVG greifen.
  - Re-Export aller Core-Strategien, Rules und `set*Strategy`-/Getter-Methoden auf `SimplexSvgController`.
- **`@simplex-viz/react`**:
  - Neue Strategie-Props (`meshStrategy`, `clusteringStrategy`, `colorStrategy`, `layoutStrategy`) auf `<SimplexTopicGraph />` und imperative Setter im Hook `useSimplexGraphController`.
- **Demo-App & Dokumentation**:
  - Entkoppelte, feingranulare Render-Einstellungen für Content- (`Geometric Shape` als Standard) und Cluster-Knoten (`Stats Pill Badge` als Standard) ohne starre Preset-Buttons.
  - Vollständig responsives Layout für Smartphones, Tablets, Laptops und Ultra-Wide-Displays (`100dvh`, `ResizeObserver`-gestützte Triangulation, Fly-Out-Drawer, klemmende Overlays) sowie Bibliotheks-Version im Header.

## [0.2.1] - 2026-11-13

### Geändert
- **Branding, Logos & README-Vorschaugrafiken**:
  - Hauptlogo (`SimplexViz`) und Paket-Logos (`core`, `svg`, `react`) auf transparenten Hintergrund, maximiertes Dreieck mit abgestuften Vertex-Ringen, aufgehellte Kantenverläufe sowie durchgängige Brand-Vertexfarben (`#06B6D4`, `#F59E0B`, `#D946EF`) umgestellt.
  - Alle vier transparenten README-Vorschaugrafiken (`preview-demo`, `preview-core`, `preview-svg`, `preview-react`) für sauberen Kontrast im Light Mode und Dark Mode überarbeitet.
  - TypeScript-Sync-Pipeline (`scripts/sync-brand.ts`) für einheitliche SVG-, PNG-, Favicon- und Social-Preview-Assets eingeführt.
- **Demo-App & CI**:
  - Automatischer und manueller Dark-/Light-Mode-Theme-Switcher in der Demo-App ohne persistente Speicherung ergänzt.
  - `pnpm-lock.yaml` für `--frozen-lockfile` in GitHub Actions aktualisiert.

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
