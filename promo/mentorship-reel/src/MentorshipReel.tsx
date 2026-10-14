import React from "react";
import { AbsoluteFill } from "remotion";
import { Background, Finish } from "./components/Background";
import { Captions } from "./components/Captions";
import { Cta } from "./components/Cta";
import { StackChips } from "./components/Format";
import { Journey } from "./components/Journey";
import { PainProps } from "./components/PainProps";
import { CtaAvatar, WhoPhoto } from "./components/Portrait";
import { COLORS, H, SAFE, SHADES, W } from "./theme";

export type ReelProps = { showSafeZones: boolean };

/** Неподвижная точечная сетка — фактура «рабочего стола», не анимируется. */
const Grid: React.FC = () => (
  <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
    <defs>
      <pattern id="dots" width={60} height={60} patternUnits="userSpaceOnUse" x={30} y={20}>
        <circle cx={0} cy={0} r={2} fill={SHADES.grid} />
      </pattern>
    </defs>
    <rect width={W} height={H} fill="url(#dots)" />
  </svg>
);

/** Проверочная разметка безопасных зон Reels/Shorts; в финальный рендер не попадает. */
const SafeZones: React.FC = () => {
  const shade = "rgba(255, 70, 70, 0.22)";
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: SAFE.top, background: shade }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: SAFE.bottom, bottom: 0, background: shade }} />
      <div style={{ position: "absolute", top: SAFE.top, bottom: H - SAFE.bottom, left: SAFE.right, right: 0, background: shade }} />
      <div style={{ position: "absolute", top: 0, bottom: 0, left: SAFE.left, borderLeft: "2px dashed rgba(255,70,70,0.6)" }} />
    </AbsoluteFill>
  );
};

export const MentorshipReel: React.FC<ReelProps> = ({ showSafeZones }) => (
  <AbsoluteFill style={{ backgroundColor: COLORS.bg }}>
    <Background />
    <Grid />
    <WhoPhoto />
    <Journey />
    <PainProps />
    <Captions />
    <StackChips />
    <CtaAvatar />
    <Cta />
    <Finish />
    {showSafeZones && <SafeZones />}
  </AbsoluteFill>
);
