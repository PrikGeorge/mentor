import { Easing } from "remotion";
import { BEAT, EXIT } from "../timeline";

export type Ease = (t: number) => number;

export const EASE = {
  out: Easing.bezier(0.16, 1, 0.3, 1),
  inOut: Easing.bezier(0.65, 0, 0.35, 1),
  in: Easing.bezier(0.5, 0, 0.75, 0),
} satisfies Record<string, Ease>;

export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Ключ дорожки: к кадру `at` значение доходит до `v` с easing сегмента, который на нём заканчивается. */
export type Key = { at: number; v: number; ease?: Ease };

export const track = (frame: number, keys: readonly Key[]): number => {
  if (frame <= keys[0].at) return keys[0].v;
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1];
    const k = keys[i];
    if (frame <= k.at) {
      if (k.at === a.at) return k.v;
      const t = (frame - a.at) / (k.at - a.at);
      return a.v + (k.v - a.v) * (k.ease ?? EASE.inOut)(t);
    }
  }
  return keys[keys.length - 1].v;
};

const moving = (frame: number, keys: readonly Key[]): boolean =>
  Math.abs(track(frame + 1, keys) - track(frame, keys)) > 0.05;

/** Курсор терминала: в движении горит ровно, в покое мигает в такт музыке (доля вкл / доля выкл). */
export const cursorOn = (frame: number, keys: readonly Key[], appear: number): boolean => {
  if (moving(frame, keys) || moving(frame - 1, keys)) return true;
  let since = frame;
  while (since > appear && !moving(since - 1, keys)) since--;
  return Math.floor((frame - since) / BEAT) % 2 === 0;
};

/** Эффект 1 — появление текста: подъём с ease-out и короткий уход вверх. */
export const reveal = (
  frame: number,
  from: number,
  to?: number,
  rise = 38,
): { opacity: number; y: number } | null => {
  if (frame < from || (to !== undefined && frame >= to)) return null;
  const t = frame - from;
  let opacity = clamp01(t / 7);
  let y = (1 - EASE.out(clamp01(t / 18))) * rise;
  if (to !== undefined) {
    const e = clamp01((frame - (to - EXIT)) / EXIT);
    opacity *= 1 - e;
    y -= EASE.in(e) * 18;
  }
  return { opacity, y };
};
