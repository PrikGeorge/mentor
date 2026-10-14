import React from "react";
import { useCurrentFrame } from "remotion";
import { Token, tokenize } from "../content";
import { clamp01, EASE } from "../lib/motion";
import { COLORS, FONTS, SHADES, SIZE } from "../theme";
import { EXIT } from "../timeline";

/** Стрелка рисуется линией акцентного цвета: в шрифтовом подмножестве глифа «→» может не быть. */
const Arrow: React.FC = () => (
  <svg
    viewBox="0 0 40 24"
    style={{ display: "inline-block", width: "0.78em", height: "0.5em", margin: "0 0 0 0.25em", verticalAlign: "0.06em" }}
  >
    <path
      d="M3 12 H35 M25 3 L36 12 L25 21"
      fill="none"
      stroke={COLORS.accent}
      strokeWidth={4.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** Задержка между словами, кадров. */
const STAGGER = 2.5;

/** Одно слово: поднимается и проявляется со своей задержкой — фраза «набирается» слева направо. */
const Word: React.FC<{ token: Token; t: number; isHead: boolean }> = ({ token, t, isHead }) => {
  const opacity = clamp01(t / 6);
  const y = (1 - EASE.out(clamp01(t / 16))) * (isHead ? 0.55 : 0.4);
  const scale = 0.94 + 0.06 * EASE.out(clamp01(t / 14));
  return (
    <span
      style={{
        display: "inline-block",
        opacity,
        transform: `translateY(${y}em) scale(${scale})`,
        transformOrigin: "0 100%",
      }}
    >
      {token.parts.map((p, i) => (
        <span
          key={i}
          style={
            p.tone === "accent"
              ? { color: COLORS.accent, textShadow: `0 0 0.35em ${SHADES.accentGlow}` }
              : p.tone === "mark"
                ? {
                    background: SHADES.mark,
                    borderRadius: "0.12em",
                    padding: "0 0.1em",
                    margin: "0 -0.1em",
                    boxDecorationBreak: "clone",
                  }
                : undefined
          }
        >
          {p.text}
        </span>
      ))}
      {token.arrow && <Arrow />}
    </span>
  );
};

type Anchor = "left" | "center" | "right";

export type TextProps = {
  text: string;
  from: number;
  to?: number;
  /** Абсолютное положение блока в кадре. */
  box: React.CSSProperties;
  anchor?: Anchor;
  font?: "head" | "body";
  size?: number;
  weight?: number;
  color?: string;
  lineHeight?: number;
};

/** Текстовый блок с пословным появлением. Всё, что сказано голосом, обязательно есть в кадре. */
export const Text: React.FC<TextProps> = ({
  text,
  from,
  to,
  box,
  anchor = "left",
  font = "head",
  size = SIZE.headline,
  weight,
  color = COLORS.text,
  lineHeight,
}) => {
  const frame = useCurrentFrame();
  if (frame < from || (to !== undefined && frame >= to)) return null;
  // Появление — по словам, уход — всей фразой сразу: короткий подъём с затуханием.
  const exit = to === undefined ? 0 : clamp01((frame - (to - EXIT)) / EXIT);
  const shiftX = anchor === "center" ? "-50%" : anchor === "right" ? "-100%" : "0";
  const isHead = font === "head";
  const tokens = tokenize(text);
  return (
    <div
      style={{
        position: "absolute",
        ...box,
        opacity: 1 - exit,
        transform: `translate(${shiftX}, ${-EASE.in(exit) * 18}px)`,
        fontFamily: isHead ? FONTS.head : FONTS.body,
        fontWeight: weight ?? (isHead ? 700 : 500),
        fontSize: size,
        lineHeight: lineHeight ?? (isHead ? 1.12 : 1.2),
        letterSpacing: isHead ? "-0.015em" : "0",
        color,
        textAlign: anchor,
        textWrap: "balance",
        whiteSpace: box.width === undefined ? "nowrap" : "normal",
      }}
    >
      {tokens.map((token, i) => (
        <React.Fragment key={i}>
          {i > 0 && " "}
          <Word token={token} t={frame - from - i * STAGGER} isHead={isHead} />
        </React.Fragment>
      ))}
    </div>
  );
};
