import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COPY } from "../content";
import { clamp01, EASE } from "../lib/motion";
import { COLORS, FONTS, LAYOUT, SAFE, SHADES, SIZE } from "../theme";
import { b, BEATS, EXIT } from "../timeline";

/** Иллюстрации к сценам «боли» — под линией, в нижней половине кадра, которая раньше пустовала. */
const TOP = LAYOUT.props.top;
const { tabW, tabH, tabStride, tabsBottom, termW, chatW } = LAYOUT.props;
/** Высота пузыря чата (две строки, время, отступы) — под ним индикатор «печатает» и статус. */
const CHAT_BELOW = Math.round(SIZE.prop * 6);
/** Непрозрачные панели: карточки ложатся друг на друга, и нижние не должны просвечивать. */
const PANEL = "#161C26";
const BORDER = "rgba(238, 242, 247, 0.2)";

const exitOf = (frame: number, to: number) => clamp01((frame - (to - EXIT)) / EXIT);

/** «Тонешь в курсах»: вкладки брошенных курсов падают в кучу. */
const TabsPile: React.FC<{ from: number; to: number }> = ({ from, to }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const lefts = [90, 160, 110, 175, 100, 145];
  // Наклон небольшой: при сильном соседние карточки закрывают подписи друг друга.
  const rots = [-1.4, 1, -0.8, 1.3, -1, 0.6];
  const exit = exitOf(frame, to);
  return (
    <div style={{ position: "absolute", inset: 0, opacity: 1 - exit }}>
      {COPY.props.tabs.map(([label, pct], i) => {
        const at = from + 4 + i * 4;
        if (frame < at) return null;
        const s = spring({ frame: frame - at, fps, config: { damping: 13, stiffness: 150, mass: 0.8 } });
        // Новая вкладка ложится выше и закрывает верх предыдущей, поэтому подпись прижата к низу карточки.
        const top = tabsBottom - i * tabStride;
        return (
          <div
            key={label}
            style={{
              position: "absolute",
              left: lefts[i],
              top: top - 380 * (1 - s),
              width: tabW,
              height: tabH,
              transform: `rotate(${rots[i] * (5 - 4 * s)}deg)`,
              opacity: clamp01((frame - at) / 4),
              background: PANEL,
              border: `2px solid ${BORDER}`,
              borderRadius: 18,
              boxShadow: "0 18px 40px rgba(0, 0, 0, 0.45)",
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              padding: "0 30px 12px",
              fontFamily: FONTS.body,
              fontWeight: 500,
              fontSize: SIZE.prop,
              color: "rgba(238, 242, 247, 0.82)",
              overflow: "hidden",
            }}
          >
            <span>{label}</span>
            <span style={{ color: SHADES.muted }}>{pct}</span>
            <div
              style={{
                position: "absolute",
                left: 0,
                bottom: 0,
                height: 6,
                width: `${Math.max(parseInt(pct, 10), 1.5)}%`,
                background: "rgba(238, 242, 247, 0.45)",
              }}
            />
          </div>
        );
      })}
    </div>
  );
};

/** «Задача горит»: сборка падает с ошибкой, окно вздрагивает. */
const Terminal: React.FC<{ from: number; to: number }> = ({ from, to }) => {
  const frame = useCurrentFrame();
  const t = frame - from;
  const lines = COPY.props.terminal;
  const lineAt = (i: number) => 4 + i * 7;
  const errorAt = lineAt(1);
  const shake = t >= errorAt ? Math.sin((t - errorAt) * 2.4) * 14 * Math.exp(-(t - errorAt) / 5) : 0;
  const appear = EASE.out(clamp01(t / 10));
  const exit = exitOf(frame, to);
  const visible = lines.filter((_, i) => t >= lineAt(i)).length;
  const typed = Math.floor(clamp01((t - lineAt(0)) / 6) * lines[0].length);
  return (
    <div
      style={{
        position: "absolute",
        left: SAFE.left,
        top: TOP,
        width: termW,
        opacity: appear * (1 - exit),
        transform: `translate(${shake}px, ${(1 - appear) * 30}px)`,
        background: PANEL,
        border: `2px solid ${BORDER}`,
        borderRadius: 24,
        boxShadow: "0 24px 60px rgba(0, 0, 0, 0.5)",
        overflow: "hidden",
        fontFamily: FONTS.body,
        fontSize: SIZE.prop - 2,
        lineHeight: 1.55,
      }}
    >
      <div style={{ height: 52, display: "flex", alignItems: "center", gap: 14, padding: "0 24px", borderBottom: `2px solid ${BORDER}` }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ width: 18, height: 18, borderRadius: 9, background: "rgba(238, 242, 247, 0.25)" }} />
        ))}
      </div>
      <div style={{ padding: "22px 30px 26px", minHeight: 4 * (SIZE.prop - 2) * 1.55 }}>
        {lines.slice(0, visible).map((line, i) => {
          const isError = i === 1;
          const text = i === 0 ? line.slice(0, typed) : line;
          const last = i === visible - 1;
          return (
            <div
              key={line}
              style={{
                color: isError ? COLORS.text : SHADES.muted,
                fontWeight: isError ? 700 : 500,
                whiteSpace: "nowrap",
              }}
            >
              {isError ? <span style={{ background: SHADES.mark, padding: "0 6px", borderRadius: 6 }}>{text}</span> : text}
              {last && Math.floor(t / 8) % 2 === 0 && <span style={{ color: COLORS.text }}>▌</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** «Не у кого спросить»: вопрос в чате, кто-то начал печатать — и ушёл. */
const Chat: React.FC<{ from: number; to: number }> = ({ from, to }) => {
  const frame = useCurrentFrame();
  const t = frame - from;
  const { message, time, status } = COPY.props.chat;
  const appear = EASE.out(clamp01((t - 2) / 12));
  const exit = exitOf(frame, to);
  const typingOn = t >= 12 && t < 30;
  const statusIn = clamp01((t - 33) / 6);
  return (
    <div style={{ position: "absolute", inset: 0, opacity: 1 - exit, fontFamily: FONTS.body }}>
      <div
        style={{
          position: "absolute",
          left: SAFE.left,
          top: TOP,
          maxWidth: chatW,
          opacity: appear,
          transform: `translateY(${(1 - appear) * 40}px)`,
          background: "#1A212C",
          borderRadius: "34px 34px 34px 8px",
          padding: "24px 32px 18px",
          boxShadow: "0 20px 50px rgba(0, 0, 0, 0.45)",
        }}
      >
        <div style={{ fontSize: SIZE.prop, lineHeight: 1.35, color: COLORS.text, fontWeight: 500 }}>{message}</div>
        <div style={{ fontSize: 28, color: SHADES.muted, textAlign: "right", marginTop: 6 }}>{time}</div>
      </div>
      {typingOn && (
        <div
          style={{
            position: "absolute",
            left: SAFE.left,
            top: TOP + CHAT_BELOW,
            height: 64,
            padding: "0 26px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            background: "#1A212C",
            borderRadius: 32,
          }}
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                width: 14,
                height: 14,
                borderRadius: 7,
                background: COLORS.text,
                opacity: 0.35 + 0.5 * Math.max(0, Math.sin((t - i * 4) / 4)),
              }}
            />
          ))}
        </div>
      )}
      {statusIn > 0 && (
        <div style={{ position: "absolute", left: SAFE.left + 6, top: TOP + CHAT_BELOW + 10, fontSize: Math.round(SIZE.prop * 0.9), color: SHADES.muted, opacity: statusIn }}>
          {status}
        </div>
      )}
    </div>
  );
};

export const PainProps: React.FC = () => {
  const frame = useCurrentFrame();
  const [p1, p2, p3, end] = BEATS.pain;
  if (frame < b(p1) || frame >= b(end)) return null;
  return (
    <>
      {frame < b(p2) && <TabsPile from={b(p1)} to={b(p2)} />}
      {frame >= b(p2) && frame < b(p3) && <Terminal from={b(p2)} to={b(p3)} />}
      {frame >= b(p3) && <Chat from={b(p3)} to={b(end)} />}
    </>
  );
};
