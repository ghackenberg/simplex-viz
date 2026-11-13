# SimplexViz

**Triangulations-basierte, streng überlappungsfreie Visualisierung getaggter Inhaltssammlungen auf einem dynamischen $60^\circ$-Dreiecksgitter (Simplex-Mesh).**

[![CI](https://img.shields.io/badge/CI-Vitest%20%7C%20ESLint%20%7C%20Publint-06b6d4)](#ci-cd)
[![License: MIT](https://img.shields.io/badge/License-MIT-f59e0b.svg)](./LICENSE)

---

## Projektvision & Mathematisches Prinzip

Klassische Force-Directed-Layouts erzeugen bei getaggten Wissenssammlungen häufig unleserliche Haarball-Graphen mit kreuzenden Kanten und zufälligen Überlappungen. **SimplexViz** bettet Themen-Schwerpunkte stattdessen in ein **gezahntes gleichseitiges $60^\circ$-Dreiecksgitter**:

1. **Adaptives Simplex-Mesh (`buildSimplexMesh`)**: Bestimmt aus Viewport-Fläche $(B, H)$, Padding und Seitenlängen-Intervall $[s_{\min}, s_{\max}]$ die flächeneffizienteste Gitter-Orientierung ($0^\circ$ oder $90^\circ$) und Zeilenparität (`wideFirst`), sodass jedes Dreieck exakt $60^\circ$-Innenwinkel besitzt.
2. **Zweistufiges Themen-Clustering (`computeSimplexClustering`)**:
   - *Phase 1*: Regularisierte Jaccard-Co-Occurrence partitioniert alle Tags $H_{\text{tags}}$ balanciert in $K$ disjunkte Kernmengen $T_k^{\text{core}}$ und bettet sie per Simulated Annealing (QAP) auf benachbarte Gitterpunkte ein.
   - *Phase 2*: Ein Weighted-Hitting-Set-Algorithmus plus Rückwärts-Pruning ergänzt minimale `sharedTags`, bis $100\%$ aller Inhalte planar durch mindestens ein Gitter-Dreieck $f=\{a,b,c\}$ überdeckt sind ($C_i \subseteq T_a \cup T_b \cup T_c$).
3. **Explaining-Away & OKLab-Farbmischung**: Jeder Inhalt erhält die kleinste abdeckende Einheit (Ecke $\prec$ Kante $\prec$ Dreieck) mit baryzentrischen Gewichten $\tilde{w}_{ik}$ und perzeptueller OKLab-Mischung inklusive Chroma-Erhaltung.
4. **Hierarchischer Zwei-Phasen-Kollisionslöser (`solveTwoPhaseLayout`)**: Fixiert zunächst skalierte Themen-Cluster (Priorität 1) und löst anschließend alle Inhalts-Hüllen via Binärsuche über $\alpha_{\text{content}}$, Position-Based-Dynamics und SAT/Kreis-MTV-Hard-Separation garantiert auf **exakt $0{,}0\text{ px}$ Überlappung**.

---

## Architektur (Strikte 3-Paket-Trennung)

```mermaid
flowchart LR
  Core["@simplex-viz/core\n(Headless, 0 Dependencies, NO DOM)"] --> Svg["@simplex-viz/svg\n(Framework-agnostic SVG Scene Graph)"]
  Svg --> React["@simplex-viz/react\n(React Bindings & JSX Node Renderers)"]
  Core --> React
  React --> Demo["src/demo\n(Interactive Showcase & GitHub Pages)"]
```

- **`@simplex-viz/core`**: Reiner TypeScript-Kern ohne DOM-, React- oder SVG-Abhängigkeiten (`lib: ["ES2022"]`).
- **`@simplex-viz/svg`**: Framework-unabhängige SVG-Engine (`Vanilla TS`, `Vue`, `Angular`, `Svelte`) mit zentralisiertem Root-SVG-Hit-Testing, Offscreen-`getBBox()`-Vermessung und Dual-Layer-Crossfade.
- **`@simplex-viz/react`**: Dünne React-Schicht (`<SimplexTopicGraph />`, `useSimplexGraphController`) mit Ende-zu-Ende-Typsicherheit über `<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta>`.

---

## Live-Demo

Nach Aktivierung von GitHub Pages wird die interaktive Showcase-App automatisch unter `https://<org-or-user>.github.io/<repo-name>/` bereitgestellt.

---

## Quickstart

### React (`@simplex-viz/react`)

```tsx
import { SimplexTopicGraph } from '@simplex-viz/react';
import { GeometricShapeSvgView, ClusterAnchorSvgView } from '@simplex-viz/svg';

interface Article {
  readonly slug: string;
  readonly hashtags: readonly string[];
  readonly readingMinutes: number;
}

export function KnowledgeMap({ articles }: { articles: readonly Article[] }) {
  return (
    <SimplexTopicGraph
      items={articles}
      getId={(a) => a.slug}
      getTags={(a) => a.hashtags}
      deriveClusterMeta={(ctx) => ({
        count: ctx.members.length,
        avgMin: ctx.members.reduce((s, m) => s + m.item.readingMinutes, 0) / Math.max(1, ctx.members.length),
      })}
      visualResolver={{
        resolveContentVisual: (a, ctx) => ({
          shape: a.readingMinutes > 12 ? 'star' : 'circle',
          radius: 10,
          fillHex: ctx.mixedColorHex,
        }),
        resolveClusterVisual: (cluster) => ({
          code: cluster.code,
          label: cluster.defaultLabel,
          memberCount: cluster.meta.count,
          colorHex: cluster.colorHex,
          radius: 22,
        }),
        getVisualCacheKey: (v) => ('shape' in v ? `${v.shape}:${v.fillHex}` : `${v.code}:${v.memberCount}`),
      }}
      contentView={new GeometricShapeSvgView()}
      clusterView={new ClusterAnchorSvgView()}
    />
  );
}
```

### Vanilla TypeScript / Vue / Angular (`@simplex-viz/svg`)

```ts
import {
  SimplexSvgController,
  GeometricShapeSvgView,
  ClusterAnchorSvgView,
} from '@simplex-viz/svg';

const controller = new SimplexSvgController(document.getElementById('graph')!, {
  items: myItems,
  visualResolver: myResolver,
  contentView: new GeometricShapeSvgView(),
  clusterView: new ClusterAnchorSvgView(),
});

// Unterbrechbare Echtzeit-Mutationen
controller.addItems({ id: 'new-1', tags: ['geometry', 'svg'] });
controller.removeItems('old-1');
```

---

## Eigene `SvgNodeView`-Plugins schreiben

```ts
import type { SvgNodeView } from '@simplex-viz/svg';
import { rectToConvexPolygon } from '@simplex-viz/core';

interface PillVisual {
  readonly text: string;
  readonly colorHex: string;
}

export const CustomPillView: SvgNodeView<PillVisual> = {
  // Optional: Wenn weggelassen, vermisst @simplex-viz/svg automatisch via getBBox()!
  measureConvexHull: (visual) => rectToConvexPolygon(visual.text.length * 7 + 20, 26, 6),
  mountOrUpdate: (groupEl, visual) => {
    // Reines SVG DOM um lokalen Ursprung (0,0) aufbauen
  },
};
```

---

## Lokale Entwicklung & Skripte

```bash
pnpm install
pnpm dev              # Startet die interaktive Demo-App unter http://localhost:3000
pnpm lint             # ESLint (Modulgrenzen) + TypeScript Typecheck (inkl. DOM-freiem Core)
pnpm test             # Vitest Invarianten-, Type- und DOM-Integrationstests
pnpm build:packages   # Baut dist/ + .d.ts für alle drei Pakete und prüft mit publint
```
