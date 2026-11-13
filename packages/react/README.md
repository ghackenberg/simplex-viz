# @simplex-viz/react

End-to-end type-safe React bindings, declarative JSX node renderers, and imperative controller hooks for `@simplex-viz/core` and `@simplex-viz/svg`.

## Installation

```bash
npm install @simplex-viz/core @simplex-viz/svg @simplex-viz/react
```

## Quickstart

```tsx
import { SimplexTopicGraph, useSimplexGraphController } from '@simplex-viz/react';

export function MyGraph({ items }: { items: readonly MyItem[] }) {
  const { controllerRef, handle } = useSimplexGraphController<MyItem, MyContentVisual, MyClusterVisual>();

  return (
    <SimplexTopicGraph
      controllerRef={controllerRef}
      items={items}
      getId={(item) => item.slug}
      getTags={(item) => item.hashtags}
      visualResolver={resolver}
      renderContentNode={(item, ctx) => (
        <g>
          <circle r={10} fill={ctx.mixedColorHex} />
        </g>
      )}
      renderClusterNode={(cluster) => (
        <g>
          <rect x={-50} y={-16} width={100} height={32} rx={6} fill="#0f172a" stroke={cluster.colorHex} />
          <text textAnchor="middle" y={4} fill="#f8fafc">{cluster.code}</text>
        </g>
      )}
    />
  );
}
```
