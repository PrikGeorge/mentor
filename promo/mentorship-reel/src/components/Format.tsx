import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COPY } from "../content";
import { clamp01 } from "../lib/motion";
import { COLORS, FONTS, LINE, SAFE, SHADES, SIZE } from "../theme";
import { b, BEATS, EXIT } from "../timeline";

/** Стек — «чипы» под линией. Появляются по одному, когда курсор уже встал на место. */
export const StackChips: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const [start, end] = BEATS.format;
  if (frame < b(start) || frame >= b(end)) return null;
  const exit = clamp01((frame - (b(end) - EXIT)) / EXIT);
  return (
    <div
      style={{
        position: "absolute",
        left: SAFE.left,
        top: LINE.captionTop + 6,
        display: "flex",
        gap: 22,
        opacity: 1 - exit,
        transform: `translateY(${-exit * 18}px)`,
      }}
    >
      {COPY.format.stack.map((name, i) => {
        const at = b(start + 0.75 + i * 0.5);
        if (frame < at) return null;
        const s = spring({ frame: frame - at, fps, config: { damping: 12, stiffness: 190, mass: 0.7 } });
        return (
          <div
            key={name}
            style={{
              transform: `translateY(${(1 - s) * 40}px) scale(${0.8 + 0.2 * s})`,
              transformOrigin: "0 50%",
              opacity: clamp01((frame - at) / 5),
              padding: "10px 28px",
              borderRadius: 999,
              border: `3px solid ${COLORS.accent}`,
              background: "rgba(54, 228, 166, 0.08)",
              boxShadow: `0 0 28px ${SHADES.accentGlow}`,
              fontFamily: FONTS.body,
              fontWeight: 700,
              fontSize: SIZE.stack,
              lineHeight: 1.2,
              color: COLORS.accent,
            }}
          >
            {name}
          </div>
        );
      })}
    </div>
  );
};
