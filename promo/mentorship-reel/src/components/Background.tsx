import React from "react";
import { interpolate, random, useCurrentFrame } from "remotion";
import { COLORS, H, LAYOUT, W } from "../theme";
import { b, BEATS } from "../timeline";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/**
 * Свет сцены. Одиночество — холодно и темно; с наставником — мятное свечение возвращается.
 * Ключи: [доля, x, y, яркость мяты, яркость холодного света].
 */
const [W0, W1] = BEATS.who;
const { hook, pain, who, mid, cta } = LAYOUT.light;
const LIGHT: [number, number, number, number, number][] = [
  [0, ...hook, 0.16, 0],
  [8, ...hook, 0.16, 0],
  [9, ...pain, 0, 0.07],
  [W0, ...pain, 0, 0.07],
  [W0 + 1, ...who, 0.3, 0],
  [W1, ...who, 0.26, 0],
  [W1 + 1, ...mid, 0.16, 0],
  [BEATS.cta, ...mid, 0.14, 0],
  [BEATS.cta + 1, ...cta, 0.26, 0],
  [BEATS.end, ...cta, 0.3, 0],
];

const lightAt = (frame: number, col: 1 | 2 | 3 | 4) =>
  interpolate(
    frame,
    LIGHT.map(([beat]) => b(beat)),
    LIGHT.map((k) => k[col]),
    clamp,
  );

/** Дождь в сценах «боли» — рифма с фото наставника, снятым под дождём. */
const RAIN = Array.from({ length: 70 }, (_, i) => ({
  x: random(`rain-x-${i}`) * W,
  phase: random(`rain-p-${i}`),
  speed: 26 + random(`rain-s-${i}`) * 22,
  len: 50 + random(`rain-l-${i}`) * 90,
  alpha: 0.07 + random(`rain-a-${i}`) * 0.2,
}));

/** Искры, поднимающиеся вверх, — когда путь горит. */
const SPARKS = Array.from({ length: 38 }, (_, i) => ({
  x: random(`spark-x-${i}`) * W,
  phase: random(`spark-p-${i}`),
  speed: 0.8 + random(`spark-s-${i}`) * 1.8,
  r: 1.6 + random(`spark-r-${i}`) * 3.4,
  alpha: 0.15 + random(`spark-a-${i}`) * 0.45,
  sway: random(`spark-w-${i}`) * Math.PI * 2,
}));

const SPAN = H + 200;
const wrap = (v: number) => ((v % SPAN) + SPAN) % SPAN - 100;

export const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const x = lightAt(frame, 1);
  const y = lightAt(frame, 2);
  const mint = lightAt(frame, 3);
  const cold = lightAt(frame, 4);

  const rain = interpolate(frame, [b(8), b(9), b(W0 + 2), b(W1)], [0, 1, 1, 0], clamp);
  const sparks = interpolate(frame, [b(7.5), b(8.5), b(W0 + 0.5), b(W0 + 2)], [0.8, 0, 0, 1], clamp);

  return (
    <>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: [
            `radial-gradient(circle 760px at ${x}px ${y}px, rgba(54, 228, 166, ${mint}), transparent 70%)`,
            `radial-gradient(circle 900px at ${x}px ${y}px, rgba(160, 180, 210, ${cold}), transparent 70%)`,
          ].join(", "),
        }}
      />
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        {rain > 0 &&
          RAIN.map((d, i) => {
            const top = wrap(d.phase * SPAN + frame * d.speed);
            return (
              <line
                key={`r${i}`}
                x1={d.x}
                x2={d.x - d.len * 0.08}
                y1={top}
                y2={top + d.len}
                stroke={COLORS.text}
                strokeWidth={2}
                strokeLinecap="round"
                opacity={d.alpha * rain}
              />
            );
          })}
        {sparks > 0 &&
          SPARKS.map((d, i) => {
            const cy = wrap(d.phase * SPAN - frame * d.speed);
            const cx = d.x + Math.sin(frame / 40 + d.sway) * 14;
            // Мерцание, чтобы искры не выглядели как ровная сетка точек.
            const flicker = 0.6 + 0.4 * Math.sin(frame / 9 + d.sway * 3);
            return <circle key={`s${i}`} cx={cx} cy={cy} r={d.r} fill={COLORS.accent} opacity={d.alpha * sparks * flicker} />;
          })}
      </svg>
    </>
  );
};

/** Виньетка и плёночное зерно поверх всего кадра: глубина и отсутствие «цифровой» плоскости. */
export const Finish: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(ellipse 75% 60% at 50% 48%, transparent 55%, rgba(4, 6, 10, 0.6) 100%)",
        }}
      />
      <svg width={W} height={H} style={{ position: "absolute", inset: 0, mixBlendMode: "overlay", opacity: 0.18 }}>
        <filter id="grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={Math.floor(frame / 2)} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width={W} height={H} filter="url(#grain)" />
      </svg>
    </>
  );
};
