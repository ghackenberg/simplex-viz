# @simplex-viz/wc

## 0.13.0

### Minor Changes

- Add `shift-click-selects` attribute & `shiftClickSelects` property (#27), forward custom `SimplexDomTooltipRenderer` objects via `el.tooltip` (#28), expose `el.getLegendModel(options?)`, and dispatch bubbling/composed `simplex-legend-change` `CustomEvent`s synced with zoom, filter, focus, and timeline state (#29).

### Patch Changes

- Updated dependencies
  - @simplex-viz/core@0.13.0
  - @simplex-viz/svg@0.13.0

## 0.12.1

### Patch Changes

- Embed the official `SimplexViz / wc` Emerald banner logo (`logo-wc.png`) and Light DOM architecture preview (`preview-wc.png`) in `README.md` for GitHub and npmjs.org.
- Updated dependencies
  - @simplex-viz/core@0.12.1
  - @simplex-viz/svg@0.12.1

## 0.12.0

### Minor Changes

- Initial `@simplex-viz/wc` package providing the framework-agnostic `<simplex-topic-graph>` Custom Element (`SimplexTopicGraphElement`), SSR-safe `defineSimplexTopicGraphElement()` helper, `@simplex-viz/wc/define` auto-registration subpath, 23 reactive HTML attributes + inline `<script type="application/json">` support, typed JS properties with pre-upgrade preservation, standard bubbling `CustomEvent`s, and full imperative delegation including `getViewState()`/`restoreViewState()`, multi-selection, `reducedMotion`, and `exportSvg()`/`exportPng()` (#26).

### Patch Changes

- Updated dependencies
  - @simplex-viz/core@0.12.0
  - @simplex-viz/svg@0.12.0
