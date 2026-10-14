import React from "react";
import { COPY } from "../content";
import { COLORS, H, LAYOUT, LINE, ROUTES, SAFE, SIZE, TEXT_WIDTH } from "../theme";
import { b, BEATS } from "../timeline";
import { Text } from "./Text";

/** Заголовок над сквозной линией: нижний край прижат к линии, длинные фразы растут вверх. */
const aboveLine: React.CSSProperties = { left: SAFE.left, bottom: H - LINE.textBottom, width: TEXT_WIDTH };

/** Фразы, которые сменяют друг друга: каждая держится от своей доли до доли следующей. */
const Sequence: React.FC<{ lines: readonly string[]; beats: readonly number[]; size?: number }> = ({
  lines,
  beats,
  size,
}) => (
  <>
    {lines.map((line, i) => (
      <Text key={line} text={line} from={b(beats[i])} to={b(beats[i + 1])} box={aboveLine} size={size} />
    ))}
  </>
);

type Stage = { text: string; x: number; side: "above" | "below"; anchor: "center" | "right"; at: number };

/** Подписи этапов: по очереди над и под линией маршрута, чтобы длинные слова не сталкивались. */
const Stages: React.FC<{ y: number; stages: readonly Stage[]; to: number }> = ({ y, stages, to }) => (
  <>
    {stages.map((s) => (
      <Text
        key={s.text}
        text={s.text}
        from={s.at}
        to={to}
        font="body"
        size={SIZE.stage}
        anchor={s.anchor}
        box={
          s.side === "above"
            ? { left: s.anchor === "right" ? SAFE.right : s.x, bottom: H - (y - 34) }
            : { left: s.anchor === "right" ? SAFE.right : s.x, top: y + 28 }
        }
      />
    ))}
  </>
);

const routeStages = (
  start: number,
  labels: readonly string[],
  sides: readonly ("above" | "below")[],
): Stage[] =>
  labels.map((text, i) => ({
    text,
    x: ROUTES.nodes[i],
    side: sides[i],
    anchor: i === labels.length - 1 ? "right" : "center",
    at: b(start + 4.5 + i * 0.5),
  }));

export const Captions: React.FC = () => {
  const up = BEATS.upper;
  const low = BEATS.lower;
  const [who, whoEnd] = BEATS.who;
  return (
    <>
      {/* 1. Hook */}
      {/* Первая фраза уже набрана на кадре 0: он служит превью ролика в объявлении. */}
      <Sequence lines={COPY.hook} beats={[-1.25, ...BEATS.hook.slice(1)]} size={SIZE.hook} />

      {/* 2. Боль */}
      <Sequence lines={COPY.pain} beats={BEATS.pain} />

      {/* 3. Кто я: имя над линией, роль под ней */}
      <Text text={COPY.name} from={b(who)} to={b(whoEnd)} size={SIZE.name} box={LAYOUT.who.name} />
      <Text
        text={COPY.role}
        from={b(who + 0.25)}
        to={b(whoEnd)}
        font="body"
        size={SIZE.caption}
        color={COLORS.accent}
        box={{ left: SAFE.left, top: LINE.captionTop }}
      />

      {/* Формат: заголовок над линией, стек — чипами под ней (StackChips) */}
      <Text text={COPY.format.title} from={b(BEATS.format[0])} to={b(BEATS.format[1])} box={aboveLine} />

      {/* 4. Два маршрута: сначала название, затем этапы по мере прохода курсора */}
      <Text
        text={COPY.upper.title}
        from={b(up)}
        to={b(up + 4)}
        size={SIZE.routeTitle}
        box={{ left: SAFE.left, bottom: H - (ROUTES.upperY - 90), width: TEXT_WIDTH }}
      />
      <Stages
        y={ROUTES.upperY}
        to={b(up + BEATS.route - 0.5)}
        stages={routeStages(up, COPY.upper.stages, ["above", "below", "above"])}
      />
      <Text
        text={COPY.lower.title}
        from={b(low)}
        to={b(low + 4)}
        size={SIZE.routeTitle}
        lineHeight={1.05}
        box={{ left: SAFE.left, top: ROUTES.lowerY + 42, width: TEXT_WIDTH }}
      />
      <Stages
        y={ROUTES.lowerY}
        to={b(low + BEATS.route - 0.5)}
        stages={routeStages(low, COPY.lower.stages, ["below", "above", "below"])}
      />

      {/* 5. Как проходит работа: номер шага встаёт под узлом, когда курсор до него доходит */}
      <Sequence lines={COPY.steps} beats={BEATS.steps} />
      {COPY.stepNumbers.map((n, i) => (
        <Text
          key={n}
          text={n}
          from={b(BEATS.steps[i] + (i === 0 ? 0.5 : 1))}
          to={b(BEATS.cta)}
          font="body"
          weight={700}
          size={SIZE.caption}
          color={COLORS.accent}
          anchor="center"
          box={{ left: ROUTES.steps[i], top: LINE.captionTop }}
        />
      ))}
    </>
  );
};
