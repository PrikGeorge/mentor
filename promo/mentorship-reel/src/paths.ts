import { getLength, getPointAtLength } from "@remotion/paths";
import { LINE, ROUTES, SAFE } from "./theme";

const Y = LINE.y;
const OFF_LEFT = -40;
const OFF_RIGHT = 1120;

/** Петля «хожу по кругу»: окружность под линией, начинается и заканчивается в одной точке. */
const loop = (x: number, y: number, r: number): string => {
  const k = 0.5523 * r;
  const cy = y + r;
  return [
    `M${x},${y}`,
    `C${x + k},${y} ${x + r},${cy - k} ${x + r},${cy}`,
    `C${x + r},${cy + k} ${x + k},${cy + r} ${x},${cy + r}`,
    `C${x - k},${cy + r} ${x - r},${cy + k} ${x - r},${cy}`,
    `C${x - r},${cy - k} ${x - k},${y} ${x},${y}`,
  ].join(" ");
};

const bend = (y: number): string =>
  `M${ROUTES.forkX},${Y} C${ROUTES.forkX + 85},${Y} ${ROUTES.bendX - 85},${y} ${ROUTES.bendX},${y}`;

const route = (y: number): string => `${bend(y)} H${ROUTES.nodes[2]}`;

const merge = (y: number): string =>
  `M${ROUTES.nodes[2]},${y} C${ROUTES.nodes[2] + 100},${y} ${ROUTES.nodes[2] + 100},${Y} ${OFF_RIGHT},${Y}`;

export const HOOK_END_X = 330;

export const PATHS = {
  hook: `M${SAFE.left},${Y} H${HOOK_END_X}`,
  loop: loop(HOOK_END_X, Y, 70),
  who: `M${HOOK_END_X},${Y} H${OFF_RIGHT}`,
  trunk: `M${OFF_LEFT},${Y} H${ROUTES.forkX}`,
  upper: route(ROUTES.upperY),
  lower: route(ROUTES.lowerY),
  mergeUp: merge(ROUTES.upperY),
  mergeDown: merge(ROUTES.lowerY),
  steps: `M${OFF_LEFT},${Y} H${OFF_RIGHT + 20}`,
} as const;

export type PathName = keyof typeof PATHS;

export const LEN = Object.fromEntries(
  Object.entries(PATHS).map(([name, d]) => [name, getLength(d)]),
) as Record<PathName, number>;

/** Длина кривой развилки до выхода маршрута на горизонталь (одинакова для обоих маршрутов). */
export const BEND_LEN = getLength(bend(ROUTES.upperY));

/** Длина вдоль маршрута до точки с абсциссой x на горизонтальном участке. */
export const routeAt = (x: number): number => BEND_LEN + (x - ROUTES.bendX);

/** Длина вдоль горизонтальной линии, входящей слева из-за кадра. */
export const fromLeft = (x: number): number => x - OFF_LEFT;

export const pointOn = (name: PathName, len: number): { x: number; y: number } => {
  const point = getPointAtLength(PATHS[name], Math.min(Math.max(len, 0), LEN[name]));
  if (!point) throw new Error(`Не удалось найти точку на пути ${name}`);
  return point;
};
