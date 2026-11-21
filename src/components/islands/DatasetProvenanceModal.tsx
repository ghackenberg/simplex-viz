import { useEffect } from 'react';
import {
  getDatasetSourceInfo,
  type DemoDatasetId,
} from '../../demo/data/multimodalCatalog';

export interface DatasetProvenanceMeta {
  readonly title: string;
  readonly domainLabel: string;
  readonly representationLabel: string;
  readonly dimensionsSummary: string;
  readonly itemCount: number;
  readonly requiresTags: boolean;
  readonly sourceShort: string;
  readonly sourceUrl: string;
  readonly license: string;
  readonly attribution: string;
}

const DATASET_DISPLAY_SPEC: Record<
  DemoDatasetId,
  {
    readonly title: string;
    readonly domainLabel: string;
    readonly representationLabel: string;
    readonly dimensionsSummary: string;
    readonly requiresTags: boolean;
  }
> = {
  knowledge: {
    title: 'arXiv Computer Science & Geometry Papers',
    domainLabel: 'Academic Literature',
    representationLabel: 'Multi-Category Tag Hypergraph',
    dimensionsSummary:
      'arXiv CS & Math subject categories (cs.CG, cs.GR, cs.HC, cs.LG, cs.CV, math.MG)',
    requiresTags: true,
  },
  'github-repos': {
    title: 'GitHub Visualization & WebGL Ecosystems',
    domainLabel: 'Open-Source Software',
    representationLabel: 'Discrete Repository Topics',
    dimensionsSummary:
      'Curated GitHub repository topics (#webgl, #d3, #threejs, #svg, #canvas, #graph, #wasm)',
    requiresTags: true,
  },
  media: {
    title: 'Vega Cinema Reception & Box-Office Vectors',
    domainLabel: 'Cinema & Media Analytics',
    representationLabel: 'Dual Weighted Embeddings',
    dimensionsSummary:
      '4D Critical/Audience Reception Vector + 4D Production Budget & Box-Office Scale Vector',
    requiresTags: false,
  },
  voice: {
    title: 'UCI Deterding Spoken Vowel Formants',
    domainLabel: 'Speech & Acoustic Phonetics',
    representationLabel: '10D LPC Log-Area Vector',
    dimensionsSummary:
      '10D Linear Predictive Coding (LPC) vocal-tract log-area parameters across 11 British English vowels',
    requiresTags: false,
  },
  'zoo-species': {
    title: 'UCI Zoo Animal Morphology Kernel',
    domainLabel: 'Comparative Biology',
    representationLabel: 'Pairwise Similarity Kernel S(a, b)',
    dimensionsSummary:
      'Gower-weighted morphological similarity S(a, b) ∈ [0, 1] over 16 anatomical & ecological traits',
    requiresTags: false,
  },
  'body-shape': {
    title: 'Palmer Station Antarctic Penguin Morphometrics',
    domainLabel: 'Ecological Morphometrics',
    representationLabel: '6D Standardized Biometric Vector',
    dimensionsSummary:
      'Culmen length, culmen depth, flipper span, body mass, culmen ratio & size index across Antarctic islands',
    requiresTags: false,
  },
};

export function resolveDatasetProvenanceMeta(
  datasetId: DemoDatasetId,
  itemCount: number,
): DatasetProvenanceMeta {
  const spec = DATASET_DISPLAY_SPEC[datasetId];
  const source = getDatasetSourceInfo(datasetId);
  return {
    title: spec.title,
    domainLabel: spec.domainLabel,
    representationLabel: spec.representationLabel,
    dimensionsSummary: spec.dimensionsSummary,
    itemCount,
    requiresTags: spec.requiresTags,
    sourceShort: source.sourceShort,
    sourceUrl: source.sourceUrl,
    license: source.license,
    attribution: source.attribution,
  };
}

interface DatasetInfoButtonProps {
  readonly isOpen: boolean;
  readonly onOpen: () => void;
  readonly compactMobile?: boolean;
}

export function DatasetInfoButton({
  isOpen,
  onOpen,
  compactMobile = false,
}: DatasetInfoButtonProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      aria-label="Dataset Info"
      title="Dataset Info"
      className={`inline-flex h-7 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70 dark:border-slate-700 dark:bg-[#0B0F17] dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 ${
        compactMobile ? 'w-7 px-0 sm:w-auto sm:px-2.5' : 'px-2.5'
      }`}
    >
      <svg
        className="h-3.5 w-3.5 shrink-0 text-cyan-600 dark:text-cyan-400"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <ellipse cx="12" cy="5" rx="8" ry="3" />
        <path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
        <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
      </svg>
      <span className={compactMobile ? 'hidden sm:inline' : undefined}>
        Dataset Info
      </span>
    </button>
  );
}

interface DatasetProvenanceModalProps {
  readonly isOpen: boolean;
  readonly meta: DatasetProvenanceMeta;
  readonly onClose: () => void;
}

export function DatasetProvenanceModal({
  isOpen,
  meta,
  onClose,
}: DatasetProvenanceModalProps) {
  // Close modal on Escape in capture phase so Full Screen mode stays open if active
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(ev: KeyboardEvent) {
      if (ev.key === 'Escape') {
        ev.stopImmediatePropagation();
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sv-dataset-modal-title"
      onClick={onClose}
      className="not-prose fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-[2px]"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xl dark:border-slate-800 dark:bg-[#0B0F17]"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2
              id="sv-dataset-modal-title"
              className="text-base font-bold tracking-tight text-slate-950 dark:text-white"
            >
              Open Dataset Provenance
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {meta.title}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dataset info modal"
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-xs text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            ✕
          </button>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
          {meta.attribution}
        </p>

        <dl className="mt-4 divide-y divide-slate-200/80 border-y border-slate-200/80 text-xs tabular-nums dark:divide-slate-800/80 dark:border-slate-800/80">
          <div className="flex items-baseline justify-between gap-4 py-2.5">
            <dt className="text-slate-500 dark:text-slate-400 shrink-0">Domain</dt>
            <dd className="font-medium text-right text-slate-900 dark:text-slate-100">
              {meta.domainLabel}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 py-2.5">
            <dt className="text-slate-500 dark:text-slate-400 shrink-0">Modality</dt>
            <dd className="font-mono text-right text-slate-800 dark:text-slate-200">
              {meta.representationLabel}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 py-2.5">
            <dt className="text-slate-500 dark:text-slate-400 shrink-0">Dimensions</dt>
            <dd className="font-mono text-right text-slate-800 dark:text-slate-200">
              {meta.dimensionsSummary}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 py-2.5">
            <dt className="text-slate-500 dark:text-slate-400 shrink-0">Records</dt>
            <dd className="font-mono font-semibold text-right text-slate-900 dark:text-slate-100">
              {meta.itemCount} items
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 py-2.5">
            <dt className="text-slate-500 dark:text-slate-400 shrink-0">License</dt>
            <dd className="font-mono text-right text-slate-800 dark:text-slate-200">
              {meta.license}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 py-2.5">
            <dt className="text-slate-500 dark:text-slate-400 shrink-0">Tags Required</dt>
            <dd className="font-mono text-right text-slate-800 dark:text-slate-200">
              {meta.requiresTags ? 'true' : 'false'}
            </dd>
          </div>
        </dl>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <a
            href={meta.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold text-cyan-700 hover:underline dark:text-cyan-300 whitespace-nowrap"
          >
            Upstream Source ({meta.sourceShort}) ↗
          </a>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
