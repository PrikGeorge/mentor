import React from "react";
import { Composition } from "remotion";
import { AVATAR, TelegramAvatar } from "./avatar/TelegramAvatar";
import { MentorshipReel, ReelProps } from "./MentorshipReel";
import { H, W } from "./theme";
import { DURATION, FPS } from "./timeline";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="MentorshipReel"
      component={MentorshipReel}
      durationInFrames={DURATION}
      fps={FPS}
      width={W}
      height={H}
      defaultProps={{ showSafeZones: false } satisfies ReelProps}
    />
    {/* Аватарка Telegram: синемаграф 800×800, 5 с, бесшовный цикл. */}
    <Composition
      id="TelegramAvatar"
      component={TelegramAvatar}
      durationInFrames={AVATAR.frames}
      fps={AVATAR.fps}
      width={AVATAR.size}
      height={AVATAR.size}
    />
  </>
);
