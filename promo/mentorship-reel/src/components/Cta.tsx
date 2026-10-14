import React from "react";
import { useCurrentFrame } from "remotion";
import { COPY } from "../content";
import { cursorOn, EASE, Key, reveal, track } from "../lib/motion";
import { COLORS, FONTS, H, LAYOUT, LINE, SAFE, SIZE, TEXT_WIDTH } from "../theme";
import { b, BEATS } from "../timeline";
import { Text } from "./Text";

/** Линия входит слева из-за кадра: столько пикселей до левого края текста. */
const LEAD = SAFE.left + 40;
const GAP = 24;

/**
 * Финал: путь приходит к призыву «жми „Написать“» и подчёркивает его, курсор остаётся мигать после него,
 * как терминал в ожидании ввода. Строка свёрстана в HTML, чтобы курсор встал ровно за текстом.
 */
const ActionRow: React.FC<{ frame: number }> = ({ frame }) => {
  const start = b(BEATS.cta);
  // Прогресс в тысячных: порог «курсор движется» в cursorOn рассчитан на пиксели.
  const keys: Key[] = [
    { at: start, v: 0 },
    { at: b(BEATS.cta + 1.25), v: 1000, ease: EASE.out },
  ];
  const p = track(frame, keys) / 1000;
  const action = reveal(frame, b(BEATS.cta + 0.5));
  const span = `(100% + ${LEAD - LINE.cursorW / 2}px) * ${p}`;
  return (
    <div
      style={{
        position: "absolute",
        left: SAFE.left,
        bottom: H - LINE.y,
        display: "flex",
        alignItems: "flex-end",
      }}
    >
      <span
        style={{
          fontFamily: FONTS.body,
          fontWeight: 700,
          fontSize: SIZE.action,
          lineHeight: 1,
          color: COLORS.accent,
          paddingBottom: 18,
          whiteSpace: "nowrap",
          opacity: action?.opacity ?? 0,
          transform: `translateY(${action?.y ?? 0}px)`,
        }}
      >
        {COPY.cta.action}
      </span>
      <span style={{ width: GAP + LINE.cursorW, flex: "none" }} />
      <div
        style={{
          position: "absolute",
          left: -LEAD,
          bottom: -LINE.stroke / 2,
          height: LINE.stroke,
          width: `calc(${span})`,
          borderRadius: LINE.stroke / 2,
          background: COLORS.accent,
        }}
      />
      {cursorOn(frame, keys, start) && (
        <div
          style={{
            position: "absolute",
            left: `calc(${span} - ${LEAD + LINE.cursorW / 2}px)`,
            bottom: -LINE.stroke / 2,
            width: LINE.cursorW,
            height: LINE.cursorH,
            borderRadius: 4,
            background: COLORS.accent,
          }}
        />
      )}
    </div>
  );
};

export const Cta: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < b(BEATS.cta)) return null;
  return (
    <>
      <Text
        text={COPY.cta.headline}
        from={b(BEATS.cta)}
        box={{ left: SAFE.left, bottom: H - LAYOUT.cta.headlineBottom, width: TEXT_WIDTH }}
      />
      <ActionRow frame={frame} />
    </>
  );
};
