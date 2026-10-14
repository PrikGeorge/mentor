import React from "react";
import { interpolate, interpolateColors, useCurrentFrame } from "remotion";
import { cursorOn, EASE, Key, track } from "../lib/motion";
import { fromLeft, LEN, pointOn, routeAt } from "../paths";
import { COLORS, H, LINE, ROUTES, SAFE, SHADES, W } from "../theme";
import { b, BEATS } from "../timeline";
import { Cursor, Node, Stroke } from "./Primitives";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const CURSOR_FADE = 6;

/**
 * Хук → боль → «кто я». Курсор идёт одной дорожкой по трём участкам:
 * начинает путь, застревает, ходит по кругу серым, снова загорается и уходит вправо.
 */
const OpeningLine: React.FC<{ frame: number }> = ({ frame }) => {
  const hookLen = LEN.hook;
  const loopEnd = hookLen + LEN.loop;
  const [w0, w1] = BEATS.who;
  const keys: Key[] = [
    { at: b(0.25), v: 0 },
    { at: b(1.75), v: hookLen, ease: EASE.out },
    { at: b(8.5), v: hookLen },
    { at: b(11.5), v: loopEnd, ease: EASE.inOut },
    { at: b(w0 + 0.25), v: loopEnd },
    { at: b(w0 + 1.5), v: loopEnd + 600, ease: EASE.out },
    { at: b(w1 - 0.5), v: loopEnd + 600 },
    { at: b(w1), v: loopEnd + 790, ease: EASE.in },
  ];
  const d = track(frame, keys);
  const head =
    d <= hookLen
      ? pointOn("hook", d)
      : d <= loopEnd
        ? pointOn("loop", d - hookLen)
        : pointOn("who", d - loopEnd);

  // Без помощи путь гаснет до серого; с появлением наставника загорается снова.
  const dimRange = [b(8), b(8.75), b(w0), b(w0 + 0.5)];
  const hookColor = interpolateColors(frame, dimRange, [COLORS.accent, SHADES.dimLine, SHADES.dimLine, COLORS.accent]);
  const cursorColor = interpolateColors(frame, dimRange, [COLORS.accent, SHADES.dimCursor, SHADES.dimCursor, COLORS.accent]);
  const loopOpacity = interpolate(frame, [b(w0), b(w0 + 0.75)], [1, 0], clamp);
  const relight = frame >= b(w0) && frame <= b(w0 + 0.5);

  return (
    <g opacity={interpolate(frame, [b(w1 - 0.5), b(w1 + 0.25)], [1, 0], clamp)}>
      <Stroke path="hook" len={Math.min(d, hookLen)} color={hookColor} />
      <Stroke path="loop" len={d - hookLen} color={SHADES.dimLine} opacity={loopOpacity} />
      <Stroke path="who" len={d - loopEnd} />
      <Cursor x={head.x} y={head.y} color={cursorColor} on={relight || cursorOn(frame, keys, 0)} />
    </g>
  );
};

/** Формат: линия входит слева, как перенос строки в терминале, и встаёт под заголовком; под ней — стек. */
const FormatLine: React.FC<{ frame: number }> = ({ frame }) => {
  const [start, end] = BEATS.format;
  const stop = fromLeft(SAFE.right);
  const keys: Key[] = [
    { at: b(start), v: 0 },
    { at: b(start + 0.75), v: stop, ease: EASE.out },
    { at: b(end - 0.5), v: stop },
    { at: b(end), v: LEN.steps, ease: EASE.in },
  ];
  const d = track(frame, keys);
  const head = pointOn("steps", d);
  return (
    <g opacity={interpolate(frame, [b(end - 0.4), b(end + 0.25)], [1, 0], clamp)}>
      <Stroke path="steps" len={d} />
      <Cursor x={head.x} y={head.y} on={cursorOn(frame, keys, b(start))} />
    </g>
  );
};

/** Два маршрута: ствол входит слева, у развилки курсор раздваивается, маршруты рисуются по очереди. */
const Routes: React.FC<{ frame: number }> = ({ frame }) => {
  const up = BEATS.upper;
  const low = BEATS.lower;
  const [n1, n2, n3] = ROUTES.nodes;
  const fork = b(up + 0.5);

  const trunkKeys: Key[] = [
    { at: b(up), v: 0 },
    { at: fork, v: LEN.trunk, ease: EASE.out },
  ];
  const routeKeys = (start: number): Key[] => [
    { at: b(start + 0.5), v: 0 },
    { at: b(start + 3.75), v: routeAt(ROUTES.bendX), ease: EASE.inOut },
    { at: b(start + 4), v: routeAt(ROUTES.bendX) },
    { at: b(start + 4.5), v: routeAt(n1) },
    { at: b(start + 5), v: routeAt(n2) },
    { at: b(start + 5.5), v: routeAt(n3) },
  ];
  // Нижний курсор ждёт у развилки, пока рисуется верхний маршрут.
  const upperKeys = routeKeys(up);
  const lowerKeys = [{ at: fork, v: 0 }, ...routeKeys(low)];
  const mergeKeys: Key[] = [
    { at: b(up + 2 * BEATS.route - 0.5), v: 0 },
    { at: b(up + 2 * BEATS.route), v: LEN.mergeUp, ease: EASE.in },
  ];

  const trunk = track(frame, trunkKeys);
  const upper = track(frame, upperKeys);
  const lower = track(frame, lowerKeys);
  const merge = track(frame, mergeKeys);

  const upperArrive = b(up + 5.5);
  const lowerArrive = b(low + 5.5);
  const mergeStart = mergeKeys[0].at;
  const mergeEnd = mergeKeys[1].at;

  const upperOpacity = interpolate(
    frame,
    [b(low - 0.5), b(low + 0.25), b(up + 2 * BEATS.route - 0.75), b(up + 2 * BEATS.route - 0.25)],
    [1, 0.3, 0.3, 1],
    clamp,
  );
  const lowerColor = interpolateColors(frame, [b(low), b(low + 0.25)], [SHADES.dimCursor, COLORS.accent]);
  const fadeAfter = (at: number) => interpolate(frame, [at, at + CURSOR_FADE], [1, 0], clamp);

  const upperHead = pointOn("upper", upper);
  const lowerHead = pointOn("lower", lower);
  const trunkHead = pointOn("trunk", trunk);
  const mergeUpHead = pointOn("mergeUp", merge);
  const mergeDownHead = pointOn("mergeDown", merge);
  const inMerge = frame >= mergeStart && frame <= mergeEnd;

  return (
    <g opacity={interpolate(frame, [b(up + 2 * BEATS.route - 0.25), b(up + 2 * BEATS.route + 0.25)], [1, 0], clamp)}>
      <Stroke path="trunk" len={trunk} />
      <g opacity={upperOpacity}>
        <Stroke path="upper" len={upper} />
        <Stroke path="mergeUp" len={merge} />
        <Node x={n1} y={ROUTES.upperY} at={b(up + 4.5)} />
        <Node x={n2} y={ROUTES.upperY} at={b(up + 5)} />
        <Node x={n3} y={ROUTES.upperY} at={upperArrive} />
      </g>
      <Stroke path="lower" len={lower} />
      <Stroke path="mergeDown" len={merge} />
      <Node x={ROUTES.forkX} y={LINE.y} at={fork} />
      <Node x={n1} y={ROUTES.lowerY} at={b(low + 4.5)} />
      <Node x={n2} y={ROUTES.lowerY} at={b(low + 5)} />
      <Node x={n3} y={ROUTES.lowerY} at={lowerArrive} />

      {frame < fork && <Cursor x={trunkHead.x} y={trunkHead.y} on />}
      {frame >= fork && (
        <Cursor
          x={upperHead.x}
          y={upperHead.y}
          on={cursorOn(frame, upperKeys, fork)}
          opacity={upperOpacity * fadeAfter(upperArrive)}
        />
      )}
      {frame >= fork && (
        <Cursor
          x={lowerHead.x}
          y={lowerHead.y}
          color={lowerColor}
          on={(frame >= b(low) && frame <= b(low + 0.5)) || cursorOn(frame, lowerKeys, fork)}
          opacity={fadeAfter(lowerArrive)}
        />
      )}
      {inMerge && <Cursor x={mergeUpHead.x} y={mergeUpHead.y} on />}
      {inMerge && <Cursor x={mergeDownHead.x} y={mergeDownHead.y} on />}
    </g>
  );
};

/** «Как проходит работа»: маршруты сошлись в одну линию, курсор шагает по трём узлам. */
const StepsLine: React.FC<{ frame: number }> = ({ frame }) => {
  const [s1, s2, s3, end] = BEATS.steps;
  const [x1, x2, x3] = ROUTES.steps;
  const keys: Key[] = [
    { at: b(s1), v: 0 },
    { at: b(s1 + 0.5), v: fromLeft(x1), ease: EASE.out },
    { at: b(s2), v: fromLeft(x1) },
    { at: b(s2 + 1), v: fromLeft(x2), ease: EASE.inOut },
    { at: b(s3), v: fromLeft(x2) },
    { at: b(s3 + 1), v: fromLeft(x3), ease: EASE.inOut },
    { at: b(end - 0.5), v: fromLeft(x3) },
    { at: b(end), v: LEN.steps, ease: EASE.in },
  ];
  const d = track(frame, keys);
  const head = pointOn("steps", d);
  return (
    <g opacity={interpolate(frame, [b(end - 0.4), b(end + 0.25)], [1, 0], clamp)}>
      <Stroke path="steps" len={d} />
      <Node x={x1} y={LINE.y} at={b(s1 + 0.5)} />
      <Node x={x2} y={LINE.y} at={b(s2 + 1)} />
      <Node x={x3} y={LINE.y} at={b(s3 + 1)} />
      <Cursor x={head.x} y={head.y} on={cursorOn(frame, keys, b(s1))} />
    </g>
  );
};

export const Journey: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", inset: 0 }}>
      {frame < b(BEATS.who[1] + 0.5) && <OpeningLine frame={frame} />}
      {frame >= b(BEATS.format[0]) && frame < b(BEATS.upper + 0.5) && <FormatLine frame={frame} />}
      {frame >= b(BEATS.upper) && frame < b(BEATS.steps[0] + 0.5) && <Routes frame={frame} />}
      {frame >= b(BEATS.steps[0]) && frame < b(BEATS.cta + 0.5) && <StepsLine frame={frame} />}
    </svg>
  );
};
