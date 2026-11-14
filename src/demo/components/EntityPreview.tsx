import type { DemoEntity } from '../data/multimodalCatalog';
import { resolveDemoTagMeta } from '../data/knowledgeCatalog';

export function EntitySpecBadge({
  entity,
  accentHex,
}: {
  readonly entity: DemoEntity;
  readonly accentHex: string;
}) {
  if (entity.kind === 'knowledge') {
    return (
      <div className="mt-2.5 space-y-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
          <span>{entity.entry.slug}</span>
          <span aria-hidden="true">·</span>
          <span>{entity.entry.contentType}</span>
          <span aria-hidden="true">·</span>
          <span>{entity.entry.readingMinutes} min</span>
          <span aria-hidden="true">·</span>
          <span>{entity.entry.publishedYear}</span>
        </div>
        <div className="text-[11px] text-cyan-700 dark:text-cyan-300">
          {entity.entry.hashtags
            .map((h) => resolveDemoTagMeta(h)?.displayTitle ?? h)
            .join(' · ')}
        </div>
      </div>
    );
  }

  if (entity.kind === 'media') {
    const m = entity.media;
    return (
      <div className="mt-2.5 space-y-2">
        <div className="flex items-center gap-2.5">
          <svg
            viewBox="0 0 64 42"
            className="h-11 w-16 shrink-0 rounded border border-slate-200 dark:border-slate-700"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id={`mp-${m.id}`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={m.palette[0]} />
                <stop offset="100%" stopColor={m.palette[1]} />
              </linearGradient>
            </defs>
            <rect width="64" height="42" fill={`url(#mp-${m.id})`} />
            <circle cx="18" cy="14" r="5" fill="#ffffff" fillOpacity="0.28" />
            <polygon points="0,42 22,22 38,33 49,24 64,42" fill="#0f172a" fillOpacity="0.48" />
            {m.mediaKind === 'video' && (
              <polygon points="27,15 39,21 27,27" fill="#ffffff" fillOpacity="0.92" />
            )}
          </svg>
          <div className="min-w-0 font-mono text-[11px] tabular-nums text-slate-600 dark:text-slate-300">
            <div>
              {m.mediaKind.toUpperCase()} · {m.aspectRatio}
            </div>
            <div className="text-slate-500 dark:text-slate-400">
              {m.resolutionLabel}
              {m.durationSec ? ` · ${m.durationSec}s` : ''}
            </div>
            <div className="text-cyan-700 dark:text-cyan-300">motif: {m.motif}</div>
          </div>
        </div>
      </div>
    );
  }

  if (entity.kind === 'voice') {
    const v = entity.voice;
    return (
      <div className="mt-2.5 space-y-2">
        <div className="rounded border border-slate-200 bg-slate-50/80 px-2.5 py-2 dark:border-slate-800 dark:bg-[#0E131D]">
          <svg
            viewBox="0 0 140 28"
            className="h-7 w-full"
            aria-label="Harmonic waveform envelope"
          >
            {v.waveform.map((amp, i) => {
              const h = Math.max(4, amp * 24);
              return (
                <rect
                  key={i}
                  x={i * 10 + 1}
                  y={14 - h / 2}
                  width={6}
                  height={h}
                  rx={1.5}
                  fill={accentHex}
                  fillOpacity={0.85}
                />
              );
            })}
          </svg>
        </div>
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
          <span>{v.speakerProfile}</span>
          <span aria-hidden="true">·</span>
          <span>{v.pitchHz} Hz</span>
          <span aria-hidden="true">·</span>
          <span>{v.durationSec}s</span>
          <span aria-hidden="true">·</span>
          <span>{v.language}</span>
        </div>
      </div>
    );
  }

  const b = entity.body;
  const p = b.proportions;
  const sw = p.shoulderW * 15;
  const ww = p.waistW * 12;
  const hw = p.hipW * 14;
  return (
    <div className="mt-2.5 flex items-center gap-3">
      <svg
        viewBox="-26 -24 52 52"
        className="h-14 w-14 shrink-0 rounded border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-[#0E131D]"
        aria-hidden="true"
      >
        <g transform={`rotate(${p.leanDeg * 0.55})`}>
          <circle cx="0" cy="-14" r="4.5" fill={accentHex} />
          <polygon
            points={`${-sw},-7 ${sw},-7 ${ww},3 ${hw},9 ${-hw},9 ${-ww},3`}
            fill={accentHex}
            fillOpacity="0.82"
          />
          <line
            x1={-hw * 0.45}
            y1="9"
            x2={-hw * 0.52}
            y2="23"
            stroke={accentHex}
            strokeWidth="3.2"
            strokeLinecap="round"
          />
          <line
            x1={hw * 0.45}
            y1="9"
            x2={hw * 0.52}
            y2="23"
            stroke={accentHex}
            strokeWidth="3.2"
            strokeLinecap="round"
          />
        </g>
      </svg>
      <div className="min-w-0 font-mono text-[11px] tabular-nums text-slate-600 dark:text-slate-300 space-y-0.5">
        <div>{b.archetype}</div>
        <div className="text-slate-500 dark:text-slate-400">
          {b.posture} · {b.heightCm} cm · lean {p.leanDeg}°
        </div>
      </div>
    </div>
  );
}
