// GENERATED FILE — DO NOT EDIT MANUALLY. Run `npm run sync:brand` instead.
import { useId } from 'react';

interface SimplexLogoMarkProps {
  readonly className?: string;
}

export function SimplexLogoMark({ className = 'h-7 w-7 shrink-0' }: SimplexLogoMarkProps) {
  const uid = useId().replace(/:/g, '');
  const fillCyanId = `${uid}-cyan`;
  const fillAmberId = `${uid}-amber`;
  const fillMagentaId = `${uid}-magenta`;
  const edgeTopLeftId = `${uid}-edge-tl`;
  const edgeTopRightId = `${uid}-edge-tr`;
  const edgeBottomId = `${uid}-edge-bm`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      aria-hidden="true"
      className={className}
    >
      <defs>
        <radialGradient id={fillCyanId} cx="50%" cy="22%" r="72%">
          <stop offset="0%" stopColor="#06B6D4" stopOpacity={0.44} />
          <stop offset="100%" stopColor="#06B6D4" stopOpacity={0} />
        </radialGradient>
        <radialGradient id={fillAmberId} cx="20%" cy="78%" r="70%">
          <stop offset="0%" stopColor="#F59E0B" stopOpacity={0.42} />
          <stop offset="100%" stopColor="#F59E0B" stopOpacity={0} />
        </radialGradient>
        <radialGradient id={fillMagentaId} cx="80%" cy="78%" r="70%">
          <stop offset="0%" stopColor="#D946EF" stopOpacity={0.42} />
          <stop offset="100%" stopColor="#D946EF" stopOpacity={0} />
        </radialGradient>
        <linearGradient
          id={edgeTopLeftId}
          gradientUnits="userSpaceOnUse"
          x1={256}
          y1={95}
          x2={70}
          y2={417.2}
        >
          <stop offset="0%" stopColor="#22D3EE" stopOpacity={0.92} />
          <stop offset="100%" stopColor="#FBBF24" stopOpacity={0.92} />
        </linearGradient>
        <linearGradient
          id={edgeTopRightId}
          gradientUnits="userSpaceOnUse"
          x1={256}
          y1={95}
          x2={442}
          y2={417.2}
        >
          <stop offset="0%" stopColor="#22D3EE" stopOpacity={0.92} />
          <stop offset="100%" stopColor="#E879F9" stopOpacity={0.92} />
        </linearGradient>
        <linearGradient
          id={edgeBottomId}
          gradientUnits="userSpaceOnUse"
          x1={70}
          y1={417.2}
          x2={442}
          y2={417.2}
        >
          <stop offset="0%" stopColor="#FBBF24" stopOpacity={0.92} />
          <stop offset="100%" stopColor="#E879F9" stopOpacity={0.92} />
        </linearGradient>
      </defs>

      {/* Single maximized equilateral 60° simplex with subtle vertex color wash */}
      <polygon points="256,95 70,417.2 442,417.2" fill="#64748B" fillOpacity={0.08} />
      <polygon points="256,95 70,417.2 442,417.2" fill={`url(#${fillCyanId})`} />
      <polygon points="256,95 70,417.2 442,417.2" fill={`url(#${fillAmberId})`} />
      <polygon points="256,95 70,417.2 442,417.2" fill={`url(#${fillMagentaId})`} />

      {/* Brightened gradient edges matching each adjacent vertex pair */}
      <line
        x1={256}
        y1={95}
        x2={70}
        y2={417.2}
        stroke={`url(#${edgeTopLeftId})`}
        strokeWidth={28}
        strokeLinecap="round"
      />
      <line
        x1={256}
        y1={95}
        x2={442}
        y2={417.2}
        stroke={`url(#${edgeTopRightId})`}
        strokeWidth={28}
        strokeLinecap="round"
      />
      <line
        x1={70}
        y1={417.2}
        x2={442}
        y2={417.2}
        stroke={`url(#${edgeBottomId})`}
        strokeWidth={28}
        strokeLinecap="round"
      />

      {/* 3 Corner Vertex Nodes with shaded hue-matched ring */}
      <circle cx={256} cy={95} r={54} fill="#155E75" />
      <circle cx={256} cy={95} r={37} fill="#06B6D4" />

      <circle cx={70} cy={417.2} r={54} fill="#92400E" />
      <circle cx={70} cy={417.2} r={37} fill="#F59E0B" />

      <circle cx={442} cy={417.2} r={54} fill="#86198F" />
      <circle cx={442} cy={417.2} r={37} fill="#D946EF" />
    </svg>
  );
}
