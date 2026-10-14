import React from "react";
import { Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { clamp01 } from "../lib/motion";
import { COPY } from "../content";
import { COLORS, FONTS, LAYOUT, SHADES } from "../theme";
import { b, BEATS } from "../timeline";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const PHOTO = staticFile("mentor.png");


/**
 * «Кто я»: лицо проявляется из темноты, пока путь снова загорается.
 * Края растворяются в фоне, лицо не меняется — только медленный наезд камеры.
 */
export const WhoPhoto: React.FC = () => {
  const frame = useCurrentFrame();
  const [from, to] = BEATS.who.map(b);
  if (frame < from || frame >= to) return null;
  const appear = clamp01((frame - from) / 16);
  const exit = clamp01((frame - (to - 8)) / 8);
  const scale = interpolate(frame, [from, to], [1, 1.06], clamp);
  const mask = "radial-gradient(ellipse 50% 50% at 50% 44%, #000 52%, transparent 100%)";
  // Исходник 640×640: показываем почти без увеличения, чтобы не потерять резкость.
  const { left, top, size } = LAYOUT.who.photo;
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width: size,
        height: size,
        opacity: appear * (1 - exit),
        transform: `scale(${scale})`,
        WebkitMaskImage: mask,
        maskImage: mask,
      }}
    >
      <Img
        src={PHOTO}
        style={{ width: "100%", height: "100%", filter: `brightness(${0.3 + 0.7 * appear}) contrast(1.05)` }}
      />
    </div>
  );
};

/** Финал: круглый аватар — понятно, кому писать. В квадрате рядом имя и стек, как карточка исполнителя. */
export const CtaAvatar: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const at = b(BEATS.cta);
  if (frame < at) return null;
  const s = spring({ frame: frame - at, fps, config: { damping: 14, stiffness: 170 } });
  const { left, top, size } = LAYOUT.cta.avatar;
  // Медленное «дыхание» свечения — финальный кадр держится несколько секунд и не должен застывать.
  const breathe = 0.5 + 0.5 * Math.sin((frame - at) / 14);
  const cardIn = clamp01((frame - at - 8) / 10);
  return (
    <>
      {LAYOUT.cta.card && (
        <div
          style={{
            position: "absolute",
            left: left + size + 36,
            top: top + size / 2,
            transform: `translate(${(1 - cardIn) * 30}px, -50%)`,
            opacity: cardIn,
          }}
        >
          <div style={{ fontFamily: FONTS.head, fontWeight: 700, fontSize: 56, color: COLORS.text, lineHeight: 1.1 }}>
            {COPY.cta.card.name}
          </div>
          <div style={{ fontFamily: FONTS.body, fontWeight: 500, fontSize: 34, color: SHADES.muted, marginTop: 12 }}>
            {COPY.cta.card.stack}
          </div>
        </div>
      )}
      <div
        style={{
          position: "absolute",
          left,
          top,
          width: size,
          height: size,
          transform: `scale(${s})`,
          transformOrigin: "50% 100%",
          opacity: clamp01((frame - at) / 6),
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            overflow: "hidden",
            border: `5px solid ${COLORS.accent}`,
            boxShadow: `0 0 ${30 + 30 * breathe}px ${SHADES.accentGlow}`,
          }}
        >
          <Img src={PHOTO} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>
        <div
          style={{
            position: "absolute",
            right: 6,
            bottom: 6,
            width: 38,
            height: 38,
            borderRadius: "50%",
            background: COLORS.accent,
            border: `6px solid ${COLORS.bg}`,
          }}
        />
      </div>
    </>
  );
};
