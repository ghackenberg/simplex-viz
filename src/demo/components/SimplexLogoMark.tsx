import { useId } from 'react';

interface SimplexLogoMarkProps {
  readonly className?: string;
}

export function SimplexLogoMark({ className = 'h-7 w-7 shrink-0' }: SimplexLogoMarkProps) {
  const uid = useId().replace(/:/g, '');
  const tileId = `${uid}-tile`;
  const fillCyanId = `${uid}-cyan`;
  const fillAmberId = `${uid}-amber`;
  const fillMagentaId = `${uid}-magenta`;
  const edgeId = `${uid}-edge`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      aria-hidden="true"
      className={className}
    >
      <defs>
        <linearGradient id={tileId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#111B2E" />
          <stop offset="55%" stopColor="#090E17" />
          <stop offset="100%" stopColor="#05070C" />
        </linearGradient>
        <radialGradient id={fillCyanId} cx="50%" cy="22%" r="72%">
          <stop offset="0%" stopColor="#22D3EE" stopOpacity={0.55} />
          <stop offset="100%" stopColor="#22D3EE" stopOpacity={0} />
        </radialGradient>
        <radialGradient id={fillAmberId} cx="20%" cy="78%" r="70%">
          <stop offset="0%" stopColor="#F59E0B" stopOpacity={0.52} />
          <stop offset="100%" stopColor="#F59E0B" stopOpacity={0} />
        </radialGradient>
        <radialGradient id={fillMagentaId} cx="80%" cy="78%" r="70%">
          <stop offset="0%" stopColor="#E879F9" stopOpacity={0.52} />
          <stop offset="100%" stopColor="#E879F9" stopOpacity={0} />
        </radialGradient>
        <linearGradient id={edgeId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#67E8F9" stopOpacity={0.95} />
          <stop offset="50%" stopColor="#CBD5E1" stopOpacity={0.82} />
          <stop offset="100%" stopColor="#E879F9" stopOpacity={0.95} />
        </linearGradient>
      </defs>

      <rect
        x={16}
        y={16}
        width={480}
        height={480}
        rx={116}
        fill={`url(#${tileId})`}
        stroke="#24324A"
        strokeWidth={14}
      />

      {/* Single large equilateral 60° simplex with subtle vertex color wash */}
      <polygon points="256,108 102,375 410,375" fill="#0E1729" />
      <polygon points="256,108 102,375 410,375" fill={`url(#${fillCyanId})`} />
      <polygon points="256,108 102,375 410,375" fill={`url(#${fillAmberId})`} />
      <polygon points="256,108 102,375 410,375" fill={`url(#${fillMagentaId})`} />

      {/* Crisp single triangle outline */}
      <polygon
        points="256,108 102,375 410,375"
        fill="none"
        stroke={`url(#${edgeId})`}
        strokeWidth={26}
        strokeLinejoin="round"
      />

      {/* 3 Corner Vertex Nodes */}
      <circle cx={256} cy={108} r={54} fill="#070A12" />
      <circle cx={256} cy={108} r={37} fill="#22D3EE" />

      <circle cx={102} cy={375} r={54} fill="#070A12" />
      <circle cx={102} cy={375} r={37} fill="#F59E0B" />

      <circle cx={410} cy={375} r={54} fill="#070A12" />
      <circle cx={410} cy={375} r={37} fill="#E879F9" />
    </svg>
  );
}
