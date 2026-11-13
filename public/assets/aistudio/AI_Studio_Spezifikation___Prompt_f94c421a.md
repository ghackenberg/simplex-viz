# Master-Prompt & Architektur-Spezifikation: Triangulations-basierte Visualisierung für getaggte Inhaltssammlungen

Entwickle eine vollständige, produktionsreife und Open-Source-fertige **TypeScript- und React-Workspace-Architektur** zur interaktiven Visualisierung getaggter Inhaltssammlungen auf einem dynamischen $60^\circ$-Dreiecksgitter (Simplex-Mesh) mit **schemafreiem, Ende-zu-Ende-typsicherem Daten- und Cluster-Modell**, **vollständig austauschbarer Knotendarstellung**, **streng überlappungsfreier Platzierung**, **unterbrechbaren Echtzeit-Animationen**, **strikter 3-Paket-Architektur** sowie **vollständiger Dokumentation, Test-Suite und GitHub-CI/CD-Pipeline für GitHub Pages und npmjs.org**.

## 1. Übergeordnete Software- & Repository-Architektur (3 npm-Pakete + Demo-App)

Strukturiere das Repository als sauberes **Multi-Package-Workspace-Projekt** (`pnpm-workspace.yaml`), das gleichzeitig **sofort ohne vorherigen Build-Schritt in der Google-AI-Studio-Vorschau** läuft (über Root-`index.html`, Vite-Konfiguration und TypeScript-`paths`-Aliases auf die Paket-Quelltexte) und beim Export nach GitHub als eigenständige npm-Pakete gebaut, getestet und veröffentlicht werden kann:

```text
├── index.html                        # Root-Einstiegspunkt für Demo-App (AI Studio & Vite kompatibel)
├── package.json                      # Root-Workspace-Skripte (dev, build, lint, typecheck, test, release)
├── pnpm-workspace.yaml               # Workspaces: packages/*, apps/* (bzw. src/demo)
├── tsconfig.base.json                # Strikte gemeinsame TS-Basis + Path-Aliases für Live-Dev
├── eslint.config.js                  # ESLint v9 Flat Config inkl. strikter Modulgrenzen-Regeln
├── vitest.config.ts                  # Workspace-weite Test- & Coverage-Konfiguration
├── .changeset/config.json            # SemVer- & Changelog-Steuerung für npmjs.org Releases
├── .github/workflows/                # CI, GitHub Pages Deployment & npm Trusted Publishing
│   ├── ci.yml
│   ├── deploy-pages.yml
│   └── release.yml
├── packages/
│   ├── core/                         # @simplex-viz/core (eigene package.json, README.md, tsup/vite build)
│   ├── svg/                          # @simplex-viz/svg  (eigene package.json, README.md, tsup/vite build)
│   └── react/                        # @simplex-viz/react (eigene package.json, README.md, tsup/vite build)
├── src/demo/                         # Interaktive Demo-Applikation (für AI Studio Preview & GitHub Pages)
├── README.md                         # Hauptdokumentation mit Architektur, Quickstart & Live-Demo-Link
├── LICENSE                           # MIT-Lizenz
├── CONTRIBUTING.md                   # Entwicklungs-, Architektur- & Pull-Request-Leitfaden
└── CHANGELOG.md                      # Versionshistorie nach Keep-a-Changelog / Changesets
```

### Die vier Module und ihre strikten Grenzen

1. **`@simplex-viz/core` (`packages/core`) – Headless Visualisierungs-, Geometrie-, Animations- und Interaktionskern:**
   * **Null Abhängigkeiten** zu React, Vue, Angular, HTML, DOM, `window`, `document` oder `SVGElement` (`"dependencies": {}`).
   * **Null Schema-Zwang & volle Ende-zu-Ende-Typsicherheit:** Der Core schreibt kein JSON-Format und keine Domänenfelder wie `title`, `url` oder `meta` vor. Er arbeitet generisch über `<TItem, TContentVisual, TClusterVisual, TTagMeta = undefined, TClusterMeta = undefined>`: Sowohl beliebige Inhaltsdaten `TItem` als auch optionale Tag-Zusatzdaten `TTagMeta` und abgeleitete Cluster-Zusatzdaten `TClusterMeta` bleiben über den gesamten Lebenszyklus ohne Type-Casts erhalten.
   * **Null hartcodierte Knotenformen:** Der Core kennt weder Kreise, Sterne noch Text-Badges als feste Darstellungs-Enums, sondern arbeitet generisch über typsichere, reine Daten-Deskriptoren (`TContentVisual`, `TClusterVisual`) und deren konvexe Kollisionsgeometrien (`ConvexGeometry`).
   * **Zukunftssicherer Renderer-Vertrag (`SimplexRendererAdapter` & `HullMeasurer`):** Der Core kommuniziert mit jeder Darstellungs-Engine ausschließlich über abstrakte Geometrie-Messung und Frame-Snapshots (`SceneFrameSnapshot`). Dadurch kann später bei Bedarf ein `@simplex-viz/canvas`- oder WebGL-Paket ergänzt werden, **ohne eine einzige Codezeile in `@simplex-viz/core` zu ändern**.

2. **`@simplex-viz/svg` (`packages/svg`) – Framework-unabhängige SVG-Rendering-Engine:**
   * Baut ausschließlich auf `@simplex-viz/core` auf (**keinerlei Abhängigkeit zu React**), sodass dieses Paket direkt in **Vanilla TypeScript, Vue, Angular, Svelte oder Web Components** eingebettet werden kann.
   * Implementiert den `SimplexRendererAdapter` des Cores auf Basis eines performanten SVG-Szenengraphen: Keyed DOM Reconciliation für Knoten-Gruppen (`<g>`), direkte Attribut-/Transform-Updates (`translate(x,y) scale(s)`) mit $60\text{ fps}$ ohne Framework-Re-Render-Overhead, automatische Offscreen-`getBBox()`-Vermessung sowie eine offene **`SvgNodeView<TVisual>`-Plugin-Schnittstelle**.

3. **`@simplex-viz/react` (`packages/react`) – Dünne React-Integrationsschicht:**
   * Deklariert `react` und `react-dom` ausschließlich als `peerDependencies` (`>=18.0.0`) und baut auf `@simplex-viz/core` sowie `@simplex-viz/svg` auf (`<SimplexTopicGraph<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta> />` sowie Hook `useSimplexGraphController`).
   * Reicht `TItem`, `TTagMeta`, `TClusterMeta` und typisierte `ClusterDescriptor`-Objekte ohne Type-Casts Ende-zu-Ende typsicher bis in `VisualResolver`, Custom-JSX-Komponenten und sämtliche Interaktions-Callbacks durch.
   * Unterstützt sowohl **portierbare `SvgNodeView`-Plugins** als auch optionale **deklarative React-JSX-Render-Props (`renderContentNode`, `renderClusterNode`)** mit automatischer `getBBox()`-Konvexhüllen-Vermessung.

4. **`demo-app` (`src/demo`) – Interaktive Referenz-Anwendung & GitHub-Pages-Showcase:**
   * Erzeugt einen reichhaltig typisierten Beispieldatensatz ($> 110$ Fachbeiträge mit eigenen Domänenfeldern plus kuratiertem Tag-Lexikon `TTagMeta` und abgeleiteten Cluster-Statistiken `TClusterMeta`) und demonstriert volle TypeScript-Inferenz für Inhalte **und** Cluster, den Live-Austausch komplett unterschiedlicher Knotendarstellungen zur Laufzeit, garantierte Überlappungsfreiheit durch konvexe Hüllen sowie unterbrechbare Übergänge bei schnellen Inhalts-Mutationen.

## 2. Schemafreies, Ende-zu-Ende-typsicheres Daten-, Tag- & Cluster-Modell (`@simplex-viz/core`)

Die Bibliothek darf **kein festes JSON-Schema** und **keine überflüssigen Pflichtfelder** erzwingen. Algorithmisch benötigt der Core pro Inhalt ausschließlich eine eindeutige `id` und eine Liste von `tags` – erlaubt aber auf Wunsch die typsichere Anreicherung von Inhalten, Tags und berechneten Clustern.

### 2.1 Bedingtes Hybrid-Accessor-Muster für Inhalte (`TItem`)

Implementiere die Typdefinitionen so, dass der Aufrufer beliebige eigene Domänenobjekte `TItem` unverändert übergeben kann:

* Besitzt `TItem` bereits `{ id: string; tags: readonly string[] }`, sind `getId` und `getTags` **optional** (und greifen standardmäßig auf `item.id` bzw. `item.tags` zu).
* Weicht `TItem` davon ab (z. B. `{ slug: string; hashtags: string[]; headline: string; readingMinutes: number }`), erzwingt der TypeScript-Compiler `getId` bzw. `getTags` **zur Compile-Zeit als Pflicht-Konfiguration**:

```ts
export interface DefaultTaggedItem {
  readonly id: string;
  readonly tags: readonly string[];
}

export type ItemIdentityConfig<TItem> =
  (TItem extends { readonly id: string }
    ? { getId?: (item: TItem) => string }
    : { getId: (item: TItem) => string }) &
  (TItem extends { readonly tags: readonly string[] }
    ? { getTags?: (item: TItem) => readonly string[] }
    : { getTags: (item: TItem) => readonly string[] });
```

* Intern extrahiert der Core über `getId` und `getTags` die Strings, trimmt Leerzeichen, normalisiert Tag-Schreibweisen konsistent (konfigurierbar über `normalizeTag?: (raw: string) => string`) und ignoriert leere Tag-Einträge sowie Elemente mit $0$ gültigen Tags sauber ohne Laufzeitfehler.
* Das unveränderte Original-Objekt `item: TItem` bleibt per Referenz verknüpft und wird in allen nachgelagerten Schnittstellen **mit seinem exakten Originaltyp `TItem`** bereitgestellt – ohne `any`, ohne `unknown` und ohne Wrapper.

### 2.2 Typsichere Tag-Metadaten (`TTagMeta`) & Abgeleitete Cluster-Daten (`TClusterMeta`)

Da Themen-Cluster zur Laufzeit dynamisch aus den Daten berechnet werden, muss der Aufrufer auch bei der Übersetzung eines Clusters in seine visuelle Darstellung (`resolveClusterVisual`, `renderClusterNode`) und in Cluster-Events vollen typsicheren Zugriff auf alle zugehörigen Informationen haben:

1. **Optionale Tag-Metadaten (`TTagMeta`):**
   Über `resolveTagMeta?: (normalizedTag: string) => TTagMeta | undefined` (oder eine Map/Record) kann die Anwendung jedem Tag eigene strukturierte Zusatzinformationen mitgeben (z. B. Anzeigename, Kategorie-Icon, Beschreibung, Prioritätsgewicht für das Cluster-Label).

2. **Voll typisierte `ClusterMemberRef<TItem>` & `ClusterDescriptor<TItem, TTagMeta, TClusterMeta>`:**
   Jeder berechnete Schwerpunkt exponiert nicht nur seine `coreTags` und `sharedTags`, sondern auch typisierte Tag-Deskriptoren, alle anteilig zugeordneten Original-Inhalte `members` (mit ihrem exakten Typ `TItem`!) sowie ein frei berechenbares Metadaten-Objekt `meta: TClusterMeta`:

```ts
export interface TagDescriptor<TTagMeta = undefined> {
  readonly tag: string; // Normalisierter Tag-Schlüssel
  readonly frequency: number; // Anzahl Inhalte mit diesem Tag
  readonly meta: TTagMeta | undefined;
}

export interface ClusterMemberRef<TItem> {
  readonly item: TItem; // Unverändertes Original-Objekt mit vollem Typ!
  readonly itemId: string;
  readonly coverage: number; // w_{ik} in [0..1]
  readonly normalizedWeight: number; // \tilde{w}_{ik} in (0..1] auf der aktiven Gitter-Einheit
  readonly isExclusiveVertexMember: boolean; // true, falls Inhalt zu 100 % auf dieser Gitter-Ecke liegt
}

export interface ClusterDerivationContext<TItem, TTagMeta = undefined> {
  readonly clusterIndex: number; // Gitterpunkt-Index 0..K-1
  readonly clusterUid: string; // Über Re-Clusterings hinweg stabile Identität
  readonly code: string; // z. B. "T1"
  readonly defaultLabel: string; // Automatisch aus Top-Core-Tags abgeleitet
  readonly colorHex: string;
  readonly oklab: readonly [number, number, number];
  readonly gridNode: { readonly row: number; readonly col: number; readonly x: number; readonly y: number };
  readonly coreTags: readonly TagDescriptor<TTagMeta>[];
  readonly sharedTags: readonly TagDescriptor<TTagMeta>[];
  readonly members: readonly ClusterMemberRef<TItem>[]; // Alle Inhalte mit \tilde{w}_{ik} > 0
}

export interface ClusterDescriptor<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined
> extends ClusterDerivationContext<TItem, TTagMeta> {
  readonly meta: TClusterMeta;
}
```

3. **Bedingter Hook `deriveClusterMeta`:**
   * Wird `TClusterMeta` vom Aufrufer genutzt (d. h. `TClusterMeta` ist nicht `undefined`), berechnet `deriveClusterMeta(ctx: ClusterDerivationContext<TItem, TTagMeta>): TClusterMeta` einmalig pro Cluster-Update beliebige typsichere Domänenwerte für den Cluster (z. B. sprechender Cluster-Titel aus `TTagMeta`, dominanter `contentType`, durchschnittliche Lesezeit aller `ctx.members.map(m => m.item)` oder ein benutzerdefiniertes Icon).
   * Wird kein `deriveClusterMeta` benötigt, bleibt `TClusterMeta = undefined` komplett optional ohne Boilerplate.

## 3. Mathematischer Visualisierungskern (`@simplex-viz/core`)

### 3.1 Dynamisches gezahntes $60^\circ$-Dreiecksgitter (Simplex-Mesh)

Gegeben seien eine verfügbare Rechteckfläche $(B, H_{\text{ges}})$, ein konfigurierbares `innerPadding` $p$, sowie das erlaubte Seitenlängen-Intervall $[s_{\min}, s_{\max}]$ und eine Obergrenze $K_{\max}$ für Themen-Cluster:

* Nutzbare Innenfläche: $W = \max(80, B - 2p)$ und $H = \max(80, H_{\text{ges}} - 2p)$.
* Generiere Kandidaten für ein **gezahntes gleichseitiges Dreiecksgitter** (alternierende Zeilen mit $C$ und $C - 1$ Gitterpunkten, Höhenfaktor $\frac{\sqrt{3}}{2}$), prüfe sowohl $0^\circ$- als auch $90^\circ$-Orientierung sowie beide Zeilen-Paritäten (`wideFirst = true | false`).
* Bestimme für jeden Kandidaten $(C, R)$ mit $3 \le K \le \min(K_{\max}, \lvert H_{\text{tags}} \rvert)$ die maximal einpassbare Seitenlänge $s_{\text{fit}}$ und wähle unter allen Kandidaten mit $s_{\min} \le s_{\text{fit}} \le s_{\max}$ denjenigen mit der höchsten Flächenausnutzung $\eta$ (Fallback bei extremen Viewports: minimaler Abstand zu $[s_{\min}, s_{\max}]$).
* Zentriere das Gitter symmetrisch im Rechteck und trianguliere benachbarte Zeilen direkt über ihre Gitter-Indizes (offene Zahnkante am Rand, sodass ausnahmslos jedes Dreieck exakt $60^\circ$-Innenwinkel und Kantenlänge $s$ besitzt).

### 3.2 Zweistufiges Themen-Clustering mit minimaler Tag-Überlappung

Aus allen vorkommenden Tags $H_{\text{tags}}$ und den $K$ Gitterpunkten berechnet der Core die Themen-Schwerpunkte $T_0, \dots, T_{K-1}$ (optional mit deterministischem PRNG-Seed für 100 % reproduzierbare Unit-Tests):

1. **Phase 1 – Ausgewogene Core-Partition & Gitter-Einbettung:**
   * Berechne die paarweise Co-Occurrence-Ähnlichkeit (regularisierter Jaccard-Index) aller Tags.
   * Partitioniere $H_{\text{tags}}$ balanciert in $K$ disjunkte Kern-Mengen $T_k^{\text{core}}$ ($\bigcup_k T_k^{\text{core}} = H_{\text{tags}}$, kein Tag geht verloren).
   * Bette die $K$ Cluster per Simulated Annealing (Quadratic Assignment Problem) so auf die $K$ Gitterpunkte ein, dass gemeinsam in Inhalten auftretende Cluster möglichst direkte Gitter-Nachbarn (Hop-Distanz $1$) werden.

2. **Phase 2 – Minimale Tag-Überlappung (Weighted Hitting-Set + Pruning):**
   * Ein Inhalt $i$ mit Tag-Menge $C_i$ gilt als planar konfliktfrei abgedeckt, wenn mindestens ein Gitter-Dreieck $f = \{a, b, c\}$ existiert, sodass $C_i \subseteq T_a \cup T_b \cup T_c$.
   * Solange nicht abgedeckte Inhalte existieren, füge iterativ dasjenige Paar $(\text{Tag } h, \text{Cluster } k)$ als `sharedTag` hinzu, das die meisten offenen Dreiecks-Defizite heilt – mit Nachbarschaftsbonus für zusammenhängende Tag-Zonen auf dem Gitter.
   * Entferne anschließend in einem Rückwärts-Pruning-Durchlauf jede redundante Tag-Kopie, ohne die $100\%$-Abdeckung zu verletzen.

### 3.3 Ideale Baryzentrische Zielposition & Perzeptuelle Farbmischung

* Für jeden Inhalt $i$ und jeden Schwerpunkt $k$ ist die Überdeckung definiert als:

$$
w_{ik} = \frac{\lvert C_i \cap T_k \rvert}{\lvert T_k \rvert}, \quad T_k = T_k^{\text{core}} \cup T_k^{\text{shared}}
$$

* **Kleinste planare Einheit (Explaining-Away):** Weise Inhalt $i$ der kleinsten Gitter-Einheit $S_i$ (1. Gitter-Ecke $\prec$ 2. Gitter-Kante $\prec$ 3. Gitter-Dreieck) zu, die alle Tags $C_i$ vollständig überdeckt ($C_i \subseteq \bigcup_{k \in S_i} T_k$). Bei mehreren Kandidaten derselben Dimension gewinnt das höchste $\sum_{k \in S_i} w_{ik}$.
* Berechne aus den auf $S_i$ normierten Gewichten $\tilde{w}_{ik} = \frac{w_{ik}}{\sum_{m \in S_i} w_{im}}$ den idealen baryzentrischen Ankerpunkt $(bx_i, by_i) = \sum_{k \in S_i} \tilde{w}_{ik} p_k$.
* Weise jedem Cluster $k$ eine kontrastreiche Farbe im **OKLab-Farbraum** zu (optimiert auf maximalen Nachbarschaftskontrast entlang der Gitterkanten) und mische die Inhaltsfarbe aus $\tilde{w}_{ik}$ in OKLab inklusive Chroma-Erhaltung gegen Vergrauung.
* Befülle erst nach der Einheits-Zuordnung für jeden Cluster $k$ die typisierte Liste `members: ClusterMemberRef<TItem>[]` und rufe optional `deriveClusterMeta` auf, sodass `resolveClusterVisual` und `resolveContentVisual` auf die vollständigen, gegenseitig verknüpften Strukturen zugreifen können.

## 4. Vollständig austauschbare Knotendarstellung & Renderer-Vertrag

Die Darstellung von Inhaltsknoten und Themen-Clustern darf **keinerlei starren Form-Vorgaben** unterliegen und muss sowohl für Inhalte als auch für Cluster vollen typsicheren Datenzugriff bieten, während `@simplex-viz/core` komplett unabhängig von SVG bleibt.

### 4.1 Reine Daten-Deskriptoren im Core (`VisualResolver`) & Abstrakter Renderer-Adapter

1. **Generischer `VisualResolver<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta>` im Core:**
   Sowohl bei Inhalten (`item: TItem` inkl. typisierter Referenzen auf seine aktiven Cluster) als auch bei Clustern (`cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>`) stehen sämtliche eigenen Zusatzdaten typsicher bereit, um frei gestaltbare Deskriptoren `TContentVisual` und `TClusterVisual` zu erzeugen:

```ts
export interface ContentLayoutContext<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined
> {
  readonly id: string;
  readonly tags: readonly TagDescriptor<TTagMeta>[];
  readonly mixedColorHex: string;
  readonly mixedOklab: readonly [number, number, number];
  readonly unitClusters: ReadonlyArray<{
    readonly cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>;
    readonly weight: number; // \tilde{w}_{ik}
    readonly coverage: number; // w_{ik}
  }>; // Länge 1 (Ecke), 2 (Kante) oder 3 (Dreieck)
}

export interface VisualResolver<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined
> {
  resolveContentVisual(
    item: TItem,
    ctx: ContentLayoutContext<TItem, TTagMeta, TClusterMeta>
  ): TContentVisual;

  resolveClusterVisual(
    cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>
  ): TClusterVisual;

  /** Stabiler Cache-Schlüssel, damit der Core Änderungen am Visual erkennt, neu vermisst und überblendet */
  getVisualCacheKey(visual: TContentVisual | TClusterVisual): string;
}
```

2. **Renderer-unabhängige Schnittstellen `HullMeasurer` & `SimplexRendererAdapter` im Core:**
   Damit `@simplex-viz/svg` heute als einzige Engine dient, morgen aber ohne Core-Änderung ein `@simplex-viz/canvas`-Paket danebengestellt werden kann, definiert der Core diesen Vertrag:

```ts
export interface NodeRenderState<TVisual> {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly scale: number; // Vom Kollisionslöser berechneter Faktor alpha
  readonly opacity: number;
  readonly visual: TVisual;
  readonly hull: ConvexGeometry; // Unskalierte Hülle bei Faktor 1.0
  readonly interaction: {
    readonly isHovered: boolean;
    readonly isPinned: boolean;
    readonly isDimmed: boolean;
    readonly isHighlighted: boolean;
  };
  readonly transition: {
    readonly from: TVisual;
    readonly to: TVisual;
    readonly progress: number; // [0..1]
  } | null;
}

export interface HullMeasurer<TContentVisual, TClusterVisual> {
  measureContentHull(visual: TContentVisual, cacheKey: string): ConvexGeometry;
  measureClusterHull(visual: TClusterVisual, cacheKey: string): ConvexGeometry;
}

export interface SimplexRendererAdapter<TContentVisual, TClusterVisual>
  extends HullMeasurer<TContentVisual, TClusterVisual> {
  renderFrame(snapshot: SceneFrameSnapshot<TContentVisual, TClusterVisual>): void;
  destroy(): void;
}
```

### 4.2 Austauschbare `SvgNodeView<TVisual>`-Plugins in `@simplex-viz/svg`

Da `TContentVisual` und `TClusterVisual` frei vom Aufrufer definierte Typen sind, hat jede `SvgNodeView<TVisual>` **vollen typsicheren Zugriff** auf exakt die Felder, die `resolveContentVisual` bzw. `resolveClusterVisual` hineingelegt hat:

```ts
export interface SvgNodeView<TVisual> {
  /**
   * Optional: Analytische Konvexhülle bei Skalierung 1.0.
   * Falls nicht angegeben, rendert @simplex-viz/svg den Knoten automatisch einmalig
   * in eine versteckte <defs>-Messgruppe und leitet über getBBox() ein konvexes Polygon ab!
   */
  measureConvexHull?(visual: TVisual, measureSvg: SVGSVGElement): ConvexGeometry;

  /**
   * Erzeugt oder aktualisiert das Innere der Knoten-<g>-Gruppe um den lokalen Ursprung (0,0).
   * Position (x,y), Skalierung (alpha) und Basis-Opazität setzt die SVG-Engine performant auf dem äußeren <g>.
   */
  mountOrUpdate(groupEl: SVGGElement, visual: TVisual, state: NodeRenderState<TVisual>): void;
}
```

* **Mitgelieferte modulare `SvgNodeView`-Plugins (nutzbar in React, Vue, Angular, Vanilla TS):**
  Liefere mindestens drei eigenständige, sofort einsetzbare View-Plugins in `@simplex-viz/svg` mit (z. B. `GeometricShapeSvgView`, `MultiSectorGlyphSvgView`, `BadgeClusterSvgView`).
* **Zusätzlicher React-JSX-Komfort in `@simplex-viz/react`:**
  Biete neben der Übergabe beliebiger `SvgNodeView`-Plugins auch typisierte JSX-Render-Props an, die **sowohl bei Inhalten als auch bei Clustern** vollen Zugriff auf `TItem`, `TTagMeta` und `TClusterMeta` gewähren und automatisch via `getBBox()` für den Kollisionslöser vermessen werden:
  * `renderContentNode?: (item: TItem, ctx: ContentLayoutContext<TItem, TTagMeta, TClusterMeta>, state: NodeRenderState<TContentVisual>) => ReactNode`
  * `renderClusterNode?: (cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>, state: NodeRenderState<TClusterVisual>) => ReactNode`

## 5. Konvexe Bounding-Geometrien & Zweistufiges Überlappungsfreies Layout

Kein einziger Knoten darf im Ruhezustand mit einem anderen Knoten oder dem Viewport-Rand überlappen – ganz gleich, welches `SvgNodeView`-Plugin oder welche JSX-Komponente gerade aktiv ist!

### 5.1 Konvexe Hüllen-Repräsentation (`ConvexGeometry`)

```ts
export type ConvexGeometry =
  | { readonly kind: 'circle'; readonly radius: number }
  | { readonly kind: 'polygon'; readonly vertices: ReadonlyArray<{ readonly x: number; readonly y: number }> }; // Gegen den Uhrzeigersinn sortierte konvexe Hülle um (0,0)
```

* Biete im Core Hilfsfunktionen `computeConvexHull(points)` (Monotone Chain), `rectToConvexPolygon(w, h, cornerRadius)` und `regularPolygon(sides, radius)` an.
* Skaliert der Layout-Algorithmus einen Knoten mit Faktor $\alpha > 0$, skaliert seine konvexe Hülle exakt linear mit $\alpha$ um $(x, y)$.

### 5.2 Exakte Kollisionsprüfung konvexer Geometrien

Implementiere im Core schnelle, exakte 2D-Penetrationsberechnungen (Minimum Translation Vector, MTV) für beliebige Paare aus `ConvexGeometry` mittels:

* Kreis-Kreis-Analytik,
* **Separating Axis Theorem (SAT)** für Kreis-Polygon und Konvex-Polygon-Polygon,
* beschleunigt durch ein dynamisches **Uniform Spatial Hash Grid**.

### 5.3 Hierarchischer Zwei-Phasen-Platzierungs- und Skalierungs-Algorithmus

1. **Stufe 1 – Platzierung & Skalierung der Themen-Cluster (Priorität 1):**
   * Platziere die $K$ Themen-Cluster auf ihren Gitterkoordinaten $p_0, \dots, p_{K-1}$.
   * Prüfe mit ihren aktuell gemeldeten konvexen Hüllen (bei $\alpha_{\text{cluster}} = 1.0$), ob sich zwei Cluster-Hüllen berühren oder den Viewport-Rand verletzen.
   * Bestimme den maximalen Skalierungsfaktor $\alpha_{\text{cluster}} \in (0, 1]$, sodass alle Cluster-Hüllen inklusive Mindestabstand `clusterGapPx` strikt disjunkt und innerhalb des Viewports liegen (inkl. sanftem Clamping von Rand-Clustern nach innen). Fixiere danach die Cluster-Hüllen als **unbewegliche konvexe Hindernisse**.

2. **Stufe 2 – Platzierung & Skalierung der Inhaltsknoten im Restraum (Priorität 2):**
   * Jeder Inhaltsknoten $i$ startet an seiner idealen baryzentrischen Koordinate $(bx_i, by_i)$ (bei identischen Startpunkten deterministisch auf einer minimalen Phyllotaxis-Spirale vorversetzt).
   * Gesucht ist der **größtmögliche gemeinsame Skalierungsfaktor** $\alpha_{\text{content}} \in [\alpha_{\min}, 1.0]$ sowie Positionen $(x_i, y_i)$, sodass:
     1. **Null Überlappung** zwischen allen Inhalts-Hüllen untereinander (Mindestabstand `itemGapPx`),
     2. **Null Überlappung** zwischen jeder Inhalts-Hülle und jeder fixierten Themen-Cluster-Hülle,
     3. **Null Überlappung** mit den Außenrändern des Viewports,
     4. Minimale quadratische Abweichung $\sum_i \lVert (x_i, y_i) - (bx_i, by_i) \rVert^2$ vom idealen baryzentrischen Ort.
   * **Lösungsverfahren (Binärsuche über $\alpha_{\text{content}}$ + Projizierte Relaxation):**
     * Prüfe zunächst $\alpha_{\text{content}} = 1.0$ über $M$ Iterationen einer gedämpften Position-Based-Dynamics-Schleife (Rückstellkraft Richtung $(bx_i, by_i)$ plus harte MTV-Kollisionsprojektion).
     * Falls die maximale Rest-Penetration $\epsilon_{\max} > 0.05\text{ px}$ bleibt, bestimme per **Binärsuche** ($8\text{–}10$ Schritte auf $(0, 1]$) das größte $\alpha_{\text{content}}$ mit $\epsilon_{\max} = 0$, gefolgt von einem reinen Hard-Separation-Polishing-Pass ohne Rückstellkraft, der **mathematisch $0.0\text{ px}$ Überlappung garantiert**.

## 6. Dynamische Inhalts-Mutationen & Unterbrechbare Echtzeit-Überblendung

### 6.1 Typsichere Transaktions-API (sowohl in `@simplex-viz/svg` als auch in `@simplex-viz/react`)

```ts
controller.addItems(items: TItem | readonly TItem[]): void;
controller.removeItems(ids: string | readonly string[]): void;
controller.setItems(items: readonly TItem[]): void;
```

### 6.2 Stabile Cluster-Identität bei Neuberechnung (Bipartite Matching)

* Matche neue Cluster $T^{\text{neu}}_0, \dots, T^{\text{neu}}_{K'-1}$ optimal auf bisherige Cluster $T^{\text{alt}}_0, \dots, T^{\text{alt}}_{K-1}$ über eine Kostenmatrix aus **Tag-Jaccard-Ähnlichkeit** und **euklidischer Gitter-Distanz** (Ungarischer Algorithmus).
* Gematchte Cluster behalten ihre stabile `clusterUid` und nach Möglichkeit ihre OKLab-Farbe, während Position, Skalierung, ihr neu abgeleitetes `meta: TClusterMeta` und ihr `TClusterVisual` weich in den neuen Zielzustand übergehen.
* Neu hinzukommende Cluster ($K' > K$) blenden sanft ein (`enter`), wegfallende Cluster ($K' < K$) blenden sanft aus (`exit`).

### 6.3 Unterbrechbare Animation aus jedem Zwischenzustand

Trifft während einer laufenden Überblendung ($0 < t < 1$) erneut eine Inhalts-Mutation oder ein Wechsel des `VisualResolver` / der `SvgNodeView` ein, **darf die Animation niemals hart springen**:

* Kontinuierliche Größen (`x`, `y`, `scale`, `opacity`, Hintergrund-Dreiecksfarben) werden über zustandsbehaftete, kritisch gedämpfte Feder-Integratoren (mit Erhaltung der aktuellen Geschwindigkeit $\dot{x}, \dot{y}$) oder $C^1$-stetiges Re-Targeting exakt ab dem aktuellen Zwischenstand fortgeführt.
* Knoten im Zustand `exiting`, die durch ein direkt folgendes `addItems` wieder hinzukommen, kehren nahtlos aus ihrer aktuellen Zwischen-Opazität und Zwischen-Position um.

### 6.4 Allgemeingültiges Überblenden beliebiger Knoten- und Text-Darstellungen

Da `TContentVisual` und `TClusterVisual` völlig frei gewählt und sogar zur Laufzeit gegen ein komplett anderes Darstellungs-Plugin ausgetauscht werden können, unterstützt `@simplex-viz/svg` ein **zweistufiges Übergangsprotokoll**:

1. **Spezialisiertes Custom-Morphing (optional pro `SvgNodeView`):** Wenn eine `SvgNodeView` weiß, wie sie `transition.from` und `transition.to` parametrisch ineinander überführt (z. B. SVG-Pfad-Interpolation zwischen Polygonen/Sternen mit resampelten $N = 64$ Stützpunkten oder fließende Breiten-Interpolation eines Pill-Rechtecks), aktualisiert sie direkt den interpolierten Zwischenzustand für `transition.progress`.
2. **Universeller Dual-Layer-Crossfade + Hüllen-Interpolation (automatischer Standard für JEDE beliebige Darstellung & Textlabel-Wechsel):**
   * Bietet eine `SvgNodeView` kein Spezial-Morphing an (z. B. wenn sich das Textlabel oder die Metadaten-Anzeige eines Cluster-Badges ändern oder die gesamte Darstellungsart von *Stern* zu *Mini-Artikelkarte* wechselt), interpoliert der Core für die laufende Kollisionsfreiheit die **konvexe Hülle** zwischen Alt- und Neu-Geometrie, während die SVG-Engine innerhalb des Knoten-`<g>` automatisch eine ausblendende Alt-Ebene `<g class="layer-from">` mit Opazität $(1 - p)$ und eine einblendende Neu-Ebene `<g class="layer-to">` mit Opazität $p$ (inklusive proportionaler Skalierungsangleichung) führt und `<g class="layer-from">` bei $p = 1$ sauber entfernt.
   * Bei erneuter Unterbrechung mitten im Crossfade ($0 < p < 1$) wird der aktuell dominierende Zustand als neuer Ausgangspunkt fixiert, sodass niemals mehr als zwei Ebenen pro Knoten aktiv sind.

## 7. Voll konfigurierbare, Renderer-unabhängige Interaktions-Architektur

**Wichtige Architekturentscheidung für spätere Canvas-Erweiterbarkeit:** Hänge Pointer-Listener in `@simplex-viz/svg` **nicht** einzeln an tausende SVG-Kindelemente, sondern erfasse Pointer-, Click-, ContextMenu- und Wheel-Events zentral auf dem Wurzel-`<svg>`, transformiere die Koordinaten über die 2D-Kamera-Matrix (`zoom`, `panX`, `panY`) des Cores und führe das **Hit-Testing mathematisch im Core gegen die aktuellen konvexen Hüllen** durch! Sowohl Inhalts- als auch Cluster-Events liefern die voll typisierten Domänenobjekte (`TItem`, `TTagMeta`, `TClusterMeta`, `TContentVisual`, `TClusterVisual`) zurück:

* **`onContentHover?: (event: ContentHoverEvent<TItem, TContentVisual, TTagMeta, TClusterMeta> | null) => void`** (enthält `item: TItem`, `layoutContext`, `visual: TContentVisual`, `screenPosition`, `worldPosition`)
* **`onClusterHover?: (event: ClusterHoverEvent<TItem, TClusterVisual, TTagMeta, TClusterMeta> | null) => void`** (enthält `cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>` inklusive `cluster.meta` und `cluster.members`, `visual: TClusterVisual`, `screenPosition`, `worldPosition`)
* **`onLeftClick?: (target: HitTarget<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta>, rawEvent: NormalizedPointerEvent) => void`** (diskriminierte Union über `kind: 'content' | 'cluster' | 'background'`, mit vollem Typzugriff auf `target.item` bzw. `target.cluster`)
* **`onRightClick?: (target: HitTarget<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta>, rawEvent: NormalizedPointerEvent) => boolean | void`** (unterdrückt bei Rückgabe von `true` das Browser-Kontextmenü für eigene Kontextmenüs)
* **`onWheel?: 'zoom-to-cursor' | 'pan-vertical' | 'none' | ((event: NormalizedWheelEvent, camera: CameraController) => void)`**

## 8. Anforderungen an die Demo-Applikation (`demo-app`)

Baue auf `@simplex-viz/react` eine übersichtliche, moderne Demo-Oberfläche (Tailwind CSS, Dark Mode), die gezielt die **Ende-zu-Ende-Typsicherheit für Inhalte, Tags und Cluster**, die **Austauschbarkeit der Darstellung**, die saubere Paket-Trennung und die algorithmischen Garantien demonstriert:

1. **Eigenes Domänenmodell für `TItem`, `TTagMeta` & `TClusterMeta`:**
   * Definiere in der `demo-app` bewusst ein eigenes Inhalts-Interface `KnowledgeEntry` (`{ slug: string; headline: string; hashtags: readonly string[]; contentType: 'article' | 'video' | 'project'; readingMinutes: number }`, $> 110$ Einträge), ein Tag-Lexikon `TagTaxonomyInfo` (`{ displayTitle: string; domainCategory: string }`) sowie ein abgeleitetes `TopicClusterSummary` (`{ title: string; memberCount: number; avgReadingMinutes: number; dominantType: KnowledgeEntry['contentType'] }`).
   * Binde alles über `getId={e => e.slug}`, `getTags={e => e.hashtags}`, `resolveTagMeta` und `deriveClusterMeta` an `<SimplexTopicGraph />` an – sodass im Code sichtbar wird, dass sowohl Inhalts-Views als auch Cluster-Badges und Tooltips **ohne einen einzigen Type-Cast** direkt auf `entry.readingMinutes` bzw. `cluster.meta.avgReadingMinutes` und `cluster.members` zugreifen.

2. **Live-Austausch komplett unterschiedlicher Darstellungs-Plugins (`SvgNodeView`-Presets & Custom React JSX):**
   Implementiere mindestens **drei völlig unterschiedliche, live umschaltbare Darstellungs-Welten** (inklusive weicher Überblendung beim Umschalten!):
   * **Preset A – „Geometrische Kodierung (`SvgNodeView`)“:** Inhaltsknoten wechseln ihre Form nach `entry.contentType` (Kreis, abgerundete Raute, 5-zackiger Stern); Themen-Cluster als kompakte Doppelring-Anker mit Code und Mitgliederzahl aus `cluster.meta.memberCount`.
   * **Preset B – „Mehrteilige Themen-Glyphen & Dynamische Text-Badges (`SvgNodeView`)“:** Inhaltsknoten als mehrfarbige Donut-/Sektor-Glyphen (deren Ringsegmente exakt die prozentualen Themengewichte $\tilde{w}_{ik}$ zeigen); Themen-Cluster als dynamisch vermessene Pill-Badges mit kuratiertem Titel aus `cluster.meta.title`, Tag-Zähler und Ø-Lesezeit.
   * **Preset C – „Custom React-JSX Mini-Cards (`renderContentNode` & `renderClusterNode`)“:** Sowohl Inhaltsknoten als auch Themen-Cluster als echte deklarative React-SVG-Komponenten (kompakte Mini-Karten mit `entry.headline`-Snippet und `entry.readingMinutes` bzw. reichhaltige Cluster-Header-Badges mit `cluster.meta.dominantType`), die automatisch via `getBBox()` vermessen und vom Zwei-Phasen-Solver herunterskaliert werden, um $0$ Überlappungen zu garantieren.

3. **Dynamische Mutationen & Rapid-Fire-Stresstest:**
   * Buttons: **„+ 1 Inhalt“**, **„+ 10 Inhalte“**, **„- 1 Inhalt“**, **„- 10 Inhalte“** sowie **„Rapid-Fire Mutation Test“** (mehrfache Mutationen alle $250\text{ ms}$ mitten in laufenden Übergängen, wobei sich auch abgeleitete Cluster-Metadaten und Badge-Texte live ändern und sauber per Crossfade/Hüllen-Interpolation überblenden).

4. **Kollisions- & Geometrie-Inspektor:**
   * Größen-Multiplikator-Regler (um gezielt dichte Packungen zu erzwingen) + Toggle **„Konvexe Bounding-Hüllen einblenden“**, der die vom jeweiligen View-Plugin bzw. `getBBox()` gelieferten `ConvexGeometry`-Polygone/Kreise live einzeichnet.
   * Echtzeit-Telemetrie für $K$ Cluster, berechnete Skalierungsfaktoren $\alpha_{\text{cluster}}$ und $\alpha_{\text{content}}$, **aktuelle Anzahl Überlappungen (muss nach Konvergenz exakt `0` sein)** und FPS.

5. **Interaktions-Konfigurator:**
   * Live-Auswahl im UI für das Verhalten bei `Hover Content`, `Hover Cluster`, `Left Click`, `Right Click` (eigenes Kontextmenü z. B. zum direkten Entfernen oder Anpinnen eines Knotens) und `Mouse Scroll`.

## 9. Open-Source-Dokumentation, Code-Qualität, Releases & CI/CD

Generiere alle folgenden Konfigurationsdateien, Tests, Dokumentationen und GitHub-Workflows vollständig mit im Repository:

### 9.1 Umfassende Projektdokumentation

1. **Root `README.md`:**
   * Projektvision, mathematisches Funktionsprinzip des gezahnten $60^\circ$-Simplex-Gitters & der minimalen Tag-Überlappung, ASCII-/Mermaid-Architekturdiagramm (`core` $\rightarrow$ `svg` $\rightarrow$ `react`), Link zur GitHub-Pages-Live-Demo, Quickstart-Codebeispiele (sowohl für React als auch Vanilla TS / Vue via `@simplex-viz/svg`) sowie Übersicht über eigene `SvgNodeView`-Plugins.
2. **Paket-spezifische `README.md` in `packages/core`, `packages/svg` und `packages/react`:**
   * Damit auf `npmjs.org` für jedes veröffentlichte Paket eine maßgeschneiderte Installations- und API-Referenz angezeigt wird.
3. **`LICENSE`:** Vollständiger Lizenztext unter der **MIT-Lizenz**.
4. **`CONTRIBUTING.md`:** Anleitung für lokales Workspace-Setup (`pnpm install`, `pnpm dev`, `pnpm test`), strikte Architektur-Regeln (Modulgrenzen, Verbot von `any`), Anleitung zum Schreiben neuer `SvgNodeView`-Plugins sowie zum Anlegen eines Changesets (`pnpm changeset`) für Pull Requests.
5. **`CHANGELOG.md`:** Nach dem Format *Keep a Changelog* / kompatibel mit `@changesets/cli` (initialisiert mit `v0.1.0`).
6. **TSDoc-Kommentare:** Dokumentiere alle öffentlichen Interfaces, Typ-Parameter und Funktionen in `core`, `svg` und `react` mit präzisen TSDoc-Kommentaren (`/** ... */`), sodass IDEs und API-Generatoren (TypeDoc) vollständige Inline-Hilfen anzeigen.

### 9.2 Code-Qualität: Linting, Formatierung & Automatisierte Tests

1. **Statische Analyse & Mechanische Durchsetzung der Modulgrenzen (`eslint.config.js` + TypeScript):**
   * `tsconfig.base.json` mit `"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": false` und `"noImplicitOverride": true`.
   * **ESLint v9 Flat Config** (`typescript-eslint`) mit expliziten `no-restricted-imports`-Regeln pro Paketverzeichnis:
     * In `packages/core/**`: Jeglicher Import aus `react`, `react-dom`, `@simplex-viz/svg` oder `@simplex-viz/react` bricht den Lint-Lauf mit Fehler ab; zusätzlich `lib: ["ES2022"]` **ohne `"DOM"`** in `packages/core/tsconfig.json`, damit versehentliche Zugriffe auf `window`, `document` oder `SVGElement` bereits zur Compile-Zeit unmöglich sind!
     * In `packages/svg/**`: Jeglicher Import aus `react`, `react-dom` oder `@simplex-viz/react` bricht den Lint-Lauf mit Fehler ab.

2. **Automatisierte Test-Suite mit `Vitest` (`pnpm test` & `pnpm test:coverage`):**
   * **Mathematische & Geometrische Invarianten-Tests (`packages/core/__tests__`):**
     * *Mesh-Test:* Verifiziert für verschiedene Viewport-Größen $(B, H_{\text{ges}})$, dass alle Dreiecke exakt gleichseitig ($60^\circ \pm 10^{-4}$) sind und das Padding eingehalten wird.
     * *Clustering- & Überlappungs-Test:* Verifiziert, dass $0$ Tags verworfen werden ($\bigcup_k T_k = H_{\text{tags}}$) und für $100\%$ aller Inhalte eine abdeckende planare Gitter-Einheit existiert ($0$ Kreuzungskanten).
     * *SAT- & Null-Kollisions-Test:* Prüft für dichte Punktmengen und gemischte konvexe Polygone/Kreise, dass nach Abschluss des Zwei-Phasen-Solvers die paarweise Penetration zwischen allen Knoten und Clustern exakt $0.0\text{ px}$ ($\le 10^{-4}$) beträgt.
     * *Animations-Unterbrechungs-Test:* Simuliert `addItems`/`removeItems` mitten in laufenden Übergängen ($t \in (0, 1)$) und prüft Stetigkeit ohne NaN/Sprünge.
   * **Compile-Time Type-Tests (`*.test-d.ts` mit `expectTypeOf`):**
     * Beweist, dass `ItemIdentityConfig<TItem>` bei fehlendem `id`/`tags` `getId`/`getTags` erzwingt und `TItem`, `TTagMeta` sowie `TClusterMeta` exakt typisiert in `VisualResolver` und Events ankommen.
   * **SVG- & React-Integrationstests (`packages/svg/__tests__`, `packages/react/__tests__`):**
     * Rendert den Graphen unter `jsdom`/`happy-dom` (inkl. deterministischem `getBBox()`-Polyfill für die Testumgebung), prüft DOM-Reconciliation der `<g>`-Knoten, Dual-Layer-Crossfade und Custom-JSX-Rendering.

### 9.3 Paket-Build, SemVer-Versionierung & Release auf `npmjs.org`

1. **Sauberes Library-Bundling pro Paket (`packages/*/package.json` + `tsup` oder `vite` Library-Mode):**
   * Jedes der drei Pakete (`@simplex-viz/core`, `@simplex-viz/svg`, `@simplex-viz/react`) erzeugt Dual-ESM-Output + vollständige `.d.ts`-Deklarationen + Source Maps mit modernem `"exports"`-Feld, `"types"`, `"files": ["dist", "README.md", "LICENSE"]` und `"sideEffects": false` für optimales Tree-Shaking.
   * Integriere ein Validierungsskript (`publint` / `@arethetypeswrong/cli`), das vor jedem Publish sicherstellt, dass die Paket-Exporte und TypeScript-Typen fehlerfrei auflösen.

2. **Versionierung mit `@changesets/cli` (`.changeset/config.json`):**
   * Konfiguriere `linked` bzw. `fixed` Versioning für `["@simplex-viz/core", "@simplex-viz/svg", "@simplex-viz/react"]` mit `"access": "public"`, damit Versionssprünge nach **Semantic Versioning (SemVer)** konsistent über alle drei Pakete verwaltet und `CHANGELOG.md`-Dateien automatisch gepflegt werden.

### 9.4 Deployment der Demo-App auf GitHub Pages

* Konfiguriere `vite.config.ts` für den Demo-Build (`pnpm build:demo`) so, dass der `base`-Pfad dynamisch über `process.env.GITHUB_PAGES_BASE ?? './'` gesetzt wird – dadurch funktionieren alle Assets sowohl unter `https://<org-oder-user>.github.io/<repo-name>/` als auch lokal und in Google AI Studio fehlerfrei.

### 9.5 Vollständige GitHub Actions CI/CD-Pipelines (`.github/workflows/`)

Lege drei klar getrennte, produktionsreife GitHub-Actions-Workflows an:

1. **`.github/workflows/ci.yml` (Quality Gate bei jedem Push & Pull Request):**
   * Nutzt `pnpm/action-setup` + Node 22 LTS mit Lockfile-Caching (`--frozen-lockfile`).
   * Führt nacheinander aus: `pnpm lint` (inkl. Modulgrenzen-Check) $\rightarrow$ `pnpm typecheck` (inkl. DOM-freiem Check für `core`) $\rightarrow$ `pnpm test --coverage` $\rightarrow$ `pnpm build:packages` (inkl. `publint` Paket-Validierung) $\rightarrow$ `pnpm build:demo`.

2. **`.github/workflows/deploy-pages.yml` (Automatisches GitHub-Pages-Deployment der Demo-App):**
   * Triggert bei Pushes auf `main` (sowie manuell via `workflow_dispatch`).
   * Baut die Demo-App mit `GITHUB_PAGES_BASE: /${{ github.event.repository.name }}/` und veröffentlicht das Artefakt sauber über die offiziellen Actions `actions/configure-pages`, `actions/upload-pages-artifact` und `actions/deploy-pages` (ohne separaten `gh-pages`-Branch, mit minimalen Berechtigungen `pages: write`, `id-token: write`).

3. **`.github/workflows/release.yml` (Automatisierter Release-PR & npmjs.org Publish mit Provenance):**
   * Triggert bei Pushes auf `main` und nutzt `changesets/action`.
   * Liegen unveröffentlichte Changesets vor, erstellt/aktualisiert der Workflow automatisch einen **„Version Packages“-Pull-Request** (mit hochgezählten Paketversionen und generierten `CHANGELOG.md`-Einträgen).
   * Wird dieser Release-PR gemergt, baut der Workflow alle drei Pakete und veröffentlicht sie mit **npm Provenance Attestation** (`NPM_CONFIG_PROVENANCE: true`, Berechtigung `id-token: write` + `NPM_TOKEN` / npm Trusted Publishing) auf `npmjs.org` inklusive automatischer GitHub-Releases.

## 10. Qualitätskriterien für die Code-Generierung

* Schreibe **vollständigen, strikt typisierten TypeScript-Code** ohne Platzhalter (`// TODO` ist verboten) und ohne `any`- oder `as unknown`-Casts beim Durchreichen von `TItem`, `TTagMeta`, `TClusterMeta`, `TContentVisual` und `TClusterVisual`.
* Stelle sicher, dass die Anwendung **sofort lauffähig** ist (über die Root-`index.html` und `src/demo` für Live-Preview) und gleichzeitig alle Workspace-Paketdateien, Vitest-Tests, Dokumentationsdateien und GitHub-Workflows vollständig ausformuliert sind.
* Stelle sicher, dass jedes beliebige `SvgNodeView`-Plugin und jede React-JSX-Knotenkomponente allein über ihre (explizite oder automatisch per `getBBox()` ermittelte) `ConvexGeometry` garantiert überlappungsfrei platziert, skaliert, per Core-Hit-Test getroffen und weich übergeblendet wird.