import type { ContentLayoutContext } from '@simplex-viz/core';
import type { SimplexTheme } from '@simplex-viz/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CommonsThumbManifest } from '../../demo/commonsThumbs';
import type { TagTaxonomyInfo } from '../../demo/data/knowledgeCatalog';
import {
  type DemoClusterSummary,
  type DemoEntity,
  type ZooSpeciesItem,
} from '../../demo/data/multimodalCatalog';
import {
  playSynthesizedVowel,
  stopActiveVowelPlayback,
} from '../../demo/vowelAudio';
import {
  ZOO_SYMBOL_PRIMITIVES,
  resolveZooSymbolKind,
} from '../../demo/zooSymbols';

export interface SelectedDemoNodeState {
  readonly item: DemoEntity;
  readonly layoutContext?: ContentLayoutContext<
    DemoEntity,
    TagTaxonomyInfo,
    DemoClusterSummary
  >;
}

function extractZooTraitBadges(zoo: ZooSpeciesItem): readonly string[] {
  const t = zoo.traits;
  const labels: string[] = [];
  if ((t[8] ?? 0) > 0.5) labels.push('Vertebrate');
  else labels.push('Invertebrate');
  if ((t[3] ?? 0) > 0.5) labels.push('Milk');
  if ((t[0] ?? 0) > 0.5) labels.push('Hair');
  if ((t[1] ?? 0) > 0.5) labels.push('Feathers');
  if ((t[2] ?? 0) > 0.5) labels.push('Eggs');
  if ((t[5] ?? 0) > 0.5) labels.push('Aquatic');
  if ((t[4] ?? 0) > 0.5) labels.push('Airborne');
  if ((t[11] ?? 0) > 0.5) labels.push('Fins');
  if ((t[6] ?? 0) > 0.5) labels.push('Predator');
  if ((t[7] ?? 0) > 0.5) labels.push('Toothed');
  if ((t[9] ?? 0) > 0.5) labels.push('Air-breathing');
  if ((t[10] ?? 0) > 0.5) labels.push('Venomous');
  if (zoo.legs > 0) labels.push(`${zoo.legs} Legs`);
  else labels.push('Legless');
  if ((t[13] ?? 0) > 0.5) labels.push('Tail');
  if ((t[14] ?? 0) > 0.5) labels.push('Domestic');
  return labels;
}

function buildArxivBibtex(
  arxivId: string | undefined,
  title: string,
  author: string | undefined,
  year: number,
  categories: readonly string[],
): string {
  const citeKey = `${(author ?? 'author').split(/\s+/).pop()?.toLowerCase() ?? 'paper'}${year}`;
  const primaryClass = categories[0] ?? 'cs.CG';
  return `@article{${citeKey},
  title         = {${title}},
  author        = {${author ?? 'Unknown'}},
  year          = {${year}},
  eprint        = {${arxivId ?? ''}},
  archivePrefix = {arXiv},
  primaryClass  = {${primaryClass}}
}`;
}

const REPO_LANG_DOTS: Readonly<Record<string, string>> = {
  TypeScript: '#3178c6',
  JavaScript: '#eab308',
  Rust: '#f97316',
  Python: '#38bdf8',
  Go: '#06b6d4',
  HTML: '#ef4444',
  CSS: '#8b5cf6',
  Clojure: '#10b981',
  'C++': '#f43f5e',
  C: '#64748b',
  Java: '#d97706',
  Shell: '#22c55e',
};

/**
 * Shared state hook managing single content-node selection and mesh pinning (`pinnedIds`)
 * across Hero & Example atlases.
 */
export function useDemoNodeInspector(allItems: readonly DemoEntity[]) {
  const [selected, setSelected] = useState<SelectedDemoNodeState | null>(null);

  // Clear selection automatically when switching dataset
  useEffect(() => {
    stopActiveVowelPlayback();
    setSelected(null);
  }, [allItems]);

  // Escape key closes inspector
  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        stopActiveVowelPlayback();
        setSelected(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selected]);

  const handleContentClick = useCallback(
    (
      item: DemoEntity,
      layoutContext?: ContentLayoutContext<
        DemoEntity,
        TagTaxonomyInfo,
        DemoClusterSummary
      >,
    ) => {
      stopActiveVowelPlayback();
      setSelected((prev) =>
        prev && prev.item.id === item.id ? null : { item, layoutContext },
      );
    },
    [],
  );

  const clearSelection = useCallback((): boolean => {
    if (!selected) return false;
    stopActiveVowelPlayback();
    setSelected(null);
    return true;
  }, [selected]);

  const pinnedIds = useMemo(
    () => (selected ? [selected.item.id] : []),
    [selected],
  );

  return {
    selected,
    pinnedIds,
    handleContentClick,
    clearSelection,
  };
}

interface DemoNodeInspectorOverlayProps {
  readonly selected: SelectedDemoNodeState | null;
  readonly theme: SimplexTheme;
  readonly thumbManifest?: CommonsThumbManifest;
  readonly onClose: () => void;
}

export function DemoNodeInspectorOverlay({
  selected,
  theme,
  thumbManifest,
  onClose,
}: DemoNodeInspectorOverlayProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isPlayingVowel, setIsPlayingVowel] = useState(false);

  useEffect(() => {
    setCopiedKey(null);
    setIsPlayingVowel(false);
    return () => {
      stopActiveVowelPlayback();
    };
  }, [selected?.item.id]);

  if (!selected) return null;

  const { item, layoutContext } = selected;
  const accentHex = layoutContext?.mixedColorHex ?? (theme === 'light' ? '#0891b2' : '#22d3ee');
  const unitClusters = layoutContext?.unitClusters ?? [];

  const copyText = (text: string, key: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text).then(() => {
        setCopiedKey(key);
        window.setTimeout(() => {
          setCopiedKey((prev) => (prev === key ? null : prev));
        }, 1800);
      });
    }
  };

  const renderBarycentricMixBar = () => {
    if (unitClusters.length === 0) return null;
    let offsetPct = 0;
    return (
      <div className="space-y-1.5">
        <svg
          viewBox="0 0 100 4"
          preserveAspectRatio="none"
          className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800"
        >
          {unitClusters.map((uc) => {
            const w = Math.max(2, uc.weight * 100);
            const x = offsetPct;
            offsetPct += w;
            return (
              <rect
                key={uc.cluster.clusterUid}
                x={x}
                y={0}
                width={w}
                height={4}
                fill={uc.cluster.colorHex}
              />
            );
          })}
        </svg>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-slate-600 dark:text-slate-300">
          {unitClusters.map((uc) => (
            <span key={uc.cluster.clusterUid} className="inline-flex items-center gap-1">
              <svg viewBox="0 0 8 8" className="h-2 w-2 shrink-0">
                <circle cx={4} cy={4} r={4} fill={uc.cluster.colorHex} />
              </svg>
              <span className="font-medium">{uc.cluster.meta.title}</span>
              <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500">
                {Math.round(uc.weight * 100)}%
              </span>
            </span>
          ))}
        </div>
      </div>
    );
  };

  return (
    <aside
      aria-label="Selected node details"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      className="pointer-events-auto absolute inset-x-2.5 bottom-2.5 z-30 max-h-[64%] overflow-y-auto rounded-xl border border-slate-200/95 bg-white/96 shadow-lg backdrop-blur-md sm:left-auto sm:right-3 sm:bottom-3 sm:w-[324px] sm:max-h-[calc(100%-3.5rem)] dark:border-slate-700/85 dark:bg-[#0B101B]/96"
    >
      {/* 1. VEGA CINEMA CARD */}
      {item.kind === 'media' && (() => {
        const m = item.media;
        const posterUrl = thumbManifest?.[m.mediaCredit.localPath]?.inspectorSrc;
        const cleanTitle = m.title.replace(/\s*\(\d{4}\)\s*$/, '');
        const roi = m.budgetMusd > 0 ? (m.worldwideGrossMusd / m.budgetMusd).toFixed(1) : '—';
        const recAvg =
          m.semanticEmbedding.reduce((acc, v) => acc + v, 0) /
          Math.max(1, m.semanticEmbedding.length);
        const prodAvg =
          m.styleEmbedding.reduce((acc, v) => acc + v, 0) /
          Math.max(1, m.styleEmbedding.length);

        return (
          <div className="space-y-3 p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                {posterUrl && (
                  <img
                    src={posterUrl}
                    alt={cleanTitle}
                    width={64}
                    height={96}
                    decoding="async"
                    className="h-24 w-16 shrink-0 rounded-lg border border-slate-200/80 bg-slate-900 object-cover shadow-xs dark:border-slate-700/80"
                  />
                )}
                <div className="min-w-0 pt-0.5">
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-medium text-slate-500 dark:text-slate-400">
                    <svg viewBox="0 0 8 8" className="h-2 w-2 shrink-0">
                      <circle cx={4} cy={4} r={4} fill={accentHex} />
                    </svg>
                    <span>{m.genre}</span>
                    <span>·</span>
                    <span>{m.releaseYear}</span>
                    <span>·</span>
                    <span>{m.runtimeMin}m</span>
                    {m.mpaa && (
                      <span className="rounded border border-slate-300/90 px-1 py-0 font-mono text-[9px] dark:border-slate-700">
                        {m.mpaa}
                      </span>
                    )}
                  </div>
                  <h4 className="mt-1 text-sm font-bold leading-snug text-slate-950 dark:text-white">
                    {cleanTitle}
                  </h4>
                  <p className="mt-1 font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                    IMDb {m.imdbRating.toFixed(1)} · RT {m.rottenTomatoes}%
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close inspector"
                className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-slate-50 px-2.5 py-1.5 dark:bg-slate-900/80">
                <div className="text-[10px] text-slate-500 dark:text-slate-400">
                  Worldwide Gross
                </div>
                <div className="mt-0.5 font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                  ${m.worldwideGrossMusd.toFixed(1)}M
                </div>
              </div>
              <div className="rounded-lg bg-slate-50 px-2.5 py-1.5 dark:bg-slate-900/80">
                <div className="text-[10px] text-slate-500 dark:text-slate-400">
                  Budget ({roi}× ROI)
                </div>
                <div className="mt-0.5 font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                  ${m.budgetMusd.toFixed(1)}M
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
                <span>Dual-Vector Profile</span>
                <span className="font-mono">
                  Critics {Math.round(recAvg * 100)}% · Scale {Math.round(prodAvg * 100)}%
                </span>
              </div>
              {renderBarycentricMixBar()}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/80 pt-2 text-[10px] text-slate-500 dark:border-slate-800/80 dark:text-slate-400">
              <span>
                Poster:{' '}
                <a
                  href={m.mediaCredit.licenseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-slate-800 dark:hover:text-slate-200"
                >
                  {m.mediaCredit.licenseShort}
                </a>{' '}
                ·{' '}
                <a
                  href={m.mediaCredit.commonsFileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-slate-800 dark:hover:text-slate-200"
                >
                  Commons ↗
                </a>
              </span>
              <a
                href={m.mediaCredit.wikipediaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-semibold text-cyan-700 hover:text-cyan-600 dark:text-cyan-400 dark:hover:text-cyan-300"
              >
                Wikipedia ↗
              </a>
            </div>
          </div>
        );
      })()}

      {/* 2. UCI VOWELS CARD (Manual Play Button Only — Never Auto-Played) */}
      {item.kind === 'voice' && (() => {
        const v = item.voice;
        const handleTogglePlay = () => {
          if (isPlayingVowel) {
            stopActiveVowelPlayback();
            setIsPlayingVowel(false);
          } else {
            setIsPlayingVowel(true);
            playSynthesizedVowel(v, () => {
              setIsPlayingVowel(false);
            });
          }
        };

        return (
          <div className="space-y-3 p-3.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-base font-bold text-slate-950 dark:text-white">
                  <svg viewBox="0 0 40 40" className="absolute inset-0 h-full w-full">
                    <rect
                      x={0.75}
                      y={0.75}
                      width={38.5}
                      height={38.5}
                      rx={7.5}
                      fill={accentHex}
                      fillOpacity={0.14}
                      stroke={accentHex}
                      strokeWidth={1.5}
                    />
                  </svg>
                  <span className="relative">{v.language}</span>
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-950 dark:text-white">
                    Vowel “{v.exampleWord}”
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {v.speakerName} ({v.speakerSex}) · ~{v.pitchHz} Hz F0
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close inspector"
                className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            {/* 10D LPC Vocal-Tract Envelope + Explicit Play Button */}
            <div className="flex items-center gap-3 rounded-lg border border-slate-200/80 bg-slate-50/90 p-2.5 dark:border-slate-800 dark:bg-slate-900/70">
              <button
                type="button"
                onClick={handleTogglePlay}
                className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-cyan-500 dark:text-slate-950 dark:hover:bg-cyan-400 transition-colors"
              >
                <span>{isPlayingVowel ? '■' : '▶'}</span>
                <span>{isPlayingVowel ? 'Stop' : 'Play Vowel'}</span>
              </button>

              <svg
                viewBox="0 0 100 32"
                aria-label="10-channel LPC formant envelope"
                className="h-8 flex-1"
              >
                {v.waveform.map((amp, idx) => {
                  const barH = Math.max(5, amp * 28);
                  return (
                    <rect
                      key={idx}
                      x={idx * 10 + 1.5}
                      y={30 - barH}
                      width={7}
                      height={barH}
                      rx={1.5}
                      fill={accentHex}
                      fillOpacity={isPlayingVowel ? 1 : 0.85}
                    />
                  );
                })}
              </svg>
            </div>

            {renderBarycentricMixBar()}
          </div>
        );
      })()}

      {/* 3. UCI ZOO SPECIES CARD */}
      {item.kind === 'zoo-species' && (() => {
        const z = item.zoo;
        const credit = z.mediaCredit;
        const avatarUrl = credit
          ? thumbManifest?.[credit.localPath]?.inspectorSrc
          : undefined;
        const symbolKind = resolveZooSymbolKind(z.speciesName, z.taxonomicGroup);
        const primitives = ZOO_SYMBOL_PRIMITIVES[symbolKind];
        const traitBadges = extractZooTraitBadges(z);
        const bgCutout = theme === 'light' ? '#f8fafc' : '#0f172a';
        const wikiHref =
          credit?.wikipediaUrl ??
          `https://en.wikipedia.org/wiki/${encodeURIComponent(z.title.replace(/\s+/g, '_'))}`;

        return (
          <div className="space-y-3 p-3.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={z.title}
                    width={48}
                    height={48}
                    decoding="async"
                    className="h-12 w-12 shrink-0 rounded-full border border-slate-200/90 bg-slate-100 object-cover dark:border-slate-700/90 dark:bg-slate-900"
                  />
                ) : (
                  <svg
                    viewBox="-12 -12 24 24"
                    className="h-11 w-11 shrink-0 rounded-full bg-slate-50 dark:bg-slate-900"
                  >
                    <circle
                      cx={0}
                      cy={0}
                      r={11.2}
                      fill="none"
                      stroke={accentHex}
                      strokeWidth={1.2}
                    />
                    {primitives.map((prim, idx) => {
                      if (prim.tag === 'circle') {
                        return (
                          <circle
                            key={idx}
                            cx={prim.attrs.cx}
                            cy={prim.attrs.cy}
                            r={prim.attrs.r}
                            fill={prim.cutout ? bgCutout : accentHex}
                          />
                        );
                      }
                      if (prim.tag === 'ellipse') {
                        return (
                          <ellipse
                            key={idx}
                            cx={prim.attrs.cx}
                            cy={prim.attrs.cy}
                            rx={prim.attrs.rx}
                            ry={prim.attrs.ry}
                            fill={prim.cutout ? bgCutout : accentHex}
                          />
                        );
                      }
                      return (
                        <path
                          key={idx}
                          d={String(prim.attrs.d)}
                          fill={prim.cutout ? bgCutout : accentHex}
                        />
                      );
                    })}
                  </svg>
                )}
                <div>
                  <h4 className="text-sm font-bold text-slate-950 dark:text-white">
                    {z.title}
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {z.taxonomicGroup} · 16 Morphological Traits
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close inspector"
                className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            <div className="flex flex-wrap gap-1">
              {traitBadges.map((trait) => (
                <span
                  key={trait}
                  className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 dark:bg-slate-800/90 dark:text-slate-300"
                >
                  {trait}
                </span>
              ))}
            </div>

            {renderBarycentricMixBar()}

            <div className="space-y-1 border-t border-slate-200/80 pt-2 dark:border-slate-800/80">
              <div className="flex items-center justify-between gap-2">
                {credit ? (
                  <span className="truncate text-[10px] text-slate-500 dark:text-slate-400">
                    Photo: {credit.author}
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">
                    UCI Zoo Morphology Record
                  </span>
                )}
                <a
                  href={wikiHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-[11px] font-semibold text-cyan-700 hover:text-cyan-600 dark:text-cyan-400 dark:hover:text-cyan-300"
                >
                  Wikipedia ↗
                </a>
              </div>
              {credit && (
                <div className="text-[10px] text-slate-500 dark:text-slate-400">
                  <a
                    href={credit.licenseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-slate-800 dark:hover:text-slate-200"
                  >
                    {credit.licenseShort}
                  </a>{' '}
                  (resized) ·{' '}
                  <a
                    href={credit.commonsFileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-slate-800 dark:hover:text-slate-200"
                  >
                    Wikimedia Commons ↗
                  </a>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* 4. PALMER PENGUINS BIOMETRICS CARD */}
      {item.kind === 'body-shape' && (() => {
        const b = item.body;
        const speciesDisplay = b.species === 'Adelie' ? 'Adélie' : b.species;
        const metrics = [
          {
            label: 'Culmen Length',
            value: `${b.billLengthMm.toFixed(1)} mm`,
            pct: Math.max(6, Math.min(100, ((b.billLengthMm - 32) / 28) * 100)),
          },
          {
            label: 'Culmen Depth',
            value: `${b.billDepthMm.toFixed(1)} mm`,
            pct: Math.max(6, Math.min(100, ((b.billDepthMm - 13) / 8.5) * 100)),
          },
          {
            label: 'Flipper Span',
            value: `${b.flipperLengthMm} mm`,
            pct: Math.max(6, Math.min(100, ((b.flipperLengthMm - 170) / 62) * 100)),
          },
          {
            label: 'Body Mass',
            value: `${b.bodyMassG.toLocaleString('en-US')} g`,
            pct: Math.max(6, Math.min(100, ((b.bodyMassG - 2650) / 3700) * 100)),
          },
        ];

        return (
          <div className="space-y-3 p-3.5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 shrink-0">
                    <circle cx={5} cy={5} r={5} fill={accentHex} />
                  </svg>
                  <span>{speciesDisplay}</span>
                  <span>·</span>
                  <span>{b.island} Island</span>
                  <span>·</span>
                  <span>{b.sex}</span>
                </div>
                <h4 className="mt-0.5 text-sm font-bold text-slate-950 dark:text-white">
                  {b.title}
                </h4>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close inspector"
                className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2 rounded-lg bg-slate-50 p-2.5 dark:bg-slate-900/75">
              {metrics.map((m) => (
                <div key={m.label} className="space-y-0.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-600 dark:text-slate-400">{m.label}</span>
                    <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                      {m.value}
                    </span>
                  </div>
                  <svg
                    viewBox="0 0 100 4"
                    preserveAspectRatio="none"
                    className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
                  >
                    <rect
                      x={0}
                      y={0}
                      width={Math.round(m.pct)}
                      height={4}
                      rx={2}
                      fill={accentHex}
                    />
                  </svg>
                </div>
              ))}
            </div>

            {renderBarycentricMixBar()}
          </div>
        );
      })()}

      {/* 5. GITHUB REPOSITORIES CARD */}
      {item.kind === 'knowledge' && item.entry.repoName && (() => {
        const e = item.entry;
        const langDot =
          (e.repoLanguage && REPO_LANG_DOTS[e.repoLanguage]) || accentHex;
        const cloneCmd = e.repoUrl ? `git clone ${e.repoUrl}.git` : `git clone https://github.com/${e.headline}.git`;

        return (
          <div className="space-y-3 p-3.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                  <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 shrink-0">
                    <circle cx={5} cy={5} r={5} fill={langDot} />
                  </svg>
                  <span>{e.repoLanguage ?? 'Code'}</span>
                  <span>·</span>
                  <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">
                    {(e.repoStars ?? 0).toLocaleString('en-US')} ★
                  </span>
                </div>
                <h4 className="mt-0.5 truncate font-mono text-sm font-bold text-slate-950 dark:text-white">
                  {e.headline}
                </h4>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close inspector"
                className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            {e.repoDescription && (
              <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                {e.repoDescription}
              </p>
            )}

            <div className="flex flex-wrap gap-1">
              {e.hashtags.map((topic) => (
                <span
                  key={topic}
                  className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700 dark:bg-slate-800/90 dark:text-slate-300"
                >
                  #{topic}
                </span>
              ))}
            </div>

            {renderBarycentricMixBar()}

            <div className="flex items-center justify-between gap-2 border-t border-slate-200/80 pt-2.5 dark:border-slate-800/80">
              <button
                type="button"
                onClick={() => copyText(cloneCmd, 'clone')}
                className="cursor-pointer rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 transition-colors"
              >
                {copiedKey === 'clone' ? 'Copied ✓' : 'Copy git clone'}
              </button>
              {e.repoUrl && (
                <a
                  href={e.repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold text-cyan-700 hover:text-cyan-600 dark:text-cyan-400 dark:hover:text-cyan-300"
                >
                  GitHub Repo ↗
                </a>
              )}
            </div>
          </div>
        );
      })()}

      {/* 6. ARXIV SCIENTIFIC PAPERS CARD */}
      {item.kind === 'knowledge' && !item.entry.repoName && (() => {
        const e = item.entry;
        const bibtex = buildArxivBibtex(
          e.arxivId,
          e.headline,
          e.primaryAuthor,
          e.publishedYear,
          e.hashtags,
        );

        return (
          <div className="space-y-3 p-3.5">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-1">
                  {e.hashtags.map((cat) => (
                    <span
                      key={cat}
                      className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-cyan-300"
                    >
                      {cat}
                    </span>
                  ))}
                  <span className="text-[11px] text-slate-400">
                    · {e.publishedYear}
                  </span>
                </div>
                <h4 className="text-sm font-bold leading-snug text-slate-950 dark:text-white">
                  {e.headline}
                </h4>
                {e.primaryAuthor && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {e.primaryAuthor}
                    {e.arxivId ? ` · arXiv:${e.arxivId}` : ''}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close inspector"
                className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            {renderBarycentricMixBar()}

            <div className="flex items-center justify-between gap-2 border-t border-slate-200/80 pt-2.5 dark:border-slate-800/80">
              <button
                type="button"
                onClick={() => copyText(bibtex, 'bibtex')}
                className="cursor-pointer rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 transition-colors"
              >
                {copiedKey === 'bibtex' ? 'BibTeX Copied ✓' : 'Copy BibTeX'}
              </button>
              {e.arxivId && (
                <a
                  href={`https://arxiv.org/abs/${e.arxivId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold text-cyan-700 hover:text-cyan-600 dark:text-cyan-400 dark:hover:text-cyan-300"
                >
                  arXiv Preprint ↗
                </a>
              )}
            </div>
          </div>
        );
      })()}
    </aside>
  );
}
