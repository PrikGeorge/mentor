import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { clamp01, EASE } from "../lib/motion";
import { LEN, PATHS, PathName } from "../paths";
import { COLORS, LINE } from "../theme";

/** Сквозная линия: участок пути, прорисованный на длину `len`. */
export const Stroke: React.FC<{ path: PathName; len: number; color?: string; opacity?: number }> = ({
  path,
  len,
  color = COLORS.accent,
  opacity = 1,
}) => {
  if (len <= 0.5 || opacity <= 0) return null;
  const total = LEN[path];
  return (
    <path
      d={PATHS[path]}
      fill="none"
      stroke={color}
      strokeWidth={LINE.stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={`${Math.min(len, total)} ${total + 20}`}
      opacity={opacity}
    />
  );
};

/** Блочный курсор терминала, стоящий на линии в точке (x, y). */
export const Cursor: React.FC<{ x: number; y: number; on: boolean; color?: string; opacity?: number }> = ({
  x,
  y,
  on,
  color = COLORS.accent,
  opacity = 1,
}) => {
  if (!on || opacity <= 0) return null;
  return (
    <rect
      x={x - LINE.cursorW / 2}
      y={y - LINE.cursorH + LINE.stroke / 2}
      width={LINE.cursorW}
      height={LINE.cursorH}
      rx={4}
      fill={color}
      opacity={opacity}
    />
  );
};

/** Эффект 2 — узел-«станция»: появляется пружиной и один раз расходится кольцом. */
export const Node: React.FC<{ x: number; y: number; at: number }> = ({ x, y, at }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < at) return null;
  const s = spring({ frame: frame - at, fps, config: { damping: 11, stiffness: 210, mass: 0.7 } });
  const ring = clamp01((frame - at) / 22);
  return (
    <g>
      {ring < 1 && (
        <circle
          cx={x}
          cy={y}
          r={17 + 34 * EASE.out(ring)}
          fill="none"
          stroke={COLORS.accent}
          strokeWidth={3}
          opacity={0.8 * (1 - ring)}
        />
      )}
      <circle cx={x} cy={y} r={17 * s} fill={COLORS.accent} />
      <circle cx={x} cy={y} r={7 * s} fill={COLORS.bg} />
    </g>
  );
};
