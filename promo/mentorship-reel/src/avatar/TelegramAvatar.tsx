import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AbsoluteFill, Img, cancelRender, continueRender, delayRender, random, staticFile, useCurrentFrame } from "remotion";
import { COLORS, FONTS } from "../theme";

/**
 * Аватарка Telegram — «как в Матрице»: реальность → код → реальность.
 * Фото — неподвижный нижний слой, лицо не перерисовывается: код рисуется поверх по яркости фото.
 * Колонки цифрового дождя «съедают» кадр сверху вниз, и лицо оказывается собранным из символов;
 * вторая волна колонок возвращает фото. Первый и последний кадры — фото с обычным дождём.
 */
export const AVATAR = { size: 800, fps: 30, frames: 180 } as const;

const S = AVATAR.size;
const LOOP = AVATAR.frames;

/** Цвет кода. Мятный — как в ролике; для классической «Матрицы» поставьте "#00FF41". */
const CODE_COLOR = COLORS.accent;
/** Голова колонки — почти белая, как в фильме. */
const HEAD_COLOR = "#E6FFF5";

/** Сетка символов: 12 px — лицо узнаётся даже в маленьком кружке. */
const CELL = 12;
const COLS = Math.ceil(S / CELL);
const ROWS = Math.ceil(S / CELL);
const GLYPHS = "01{}[]()<>/;=+*#$&|:ABCDEFabcdef".split("");

/** Сценарий, кадры (30 fps). */
const T = {
  inStart: 24, // 0,8 с — первые колонки входят сверху
  inSpread: 16, // разброс старта колонок
  outStart: 104, // 3,5 с — волна, возвращающая фото
  outSpread: 14,
  streamsFrom: 56, // потоки по «лицу из кода»
  streamsTo: 118,
} as const;
/** Длина перехода за головой колонки, px. */
const TRAIL = 70;

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/** Параметры колонок: скорость и задержка у каждой своя — кадр «съедается» неровно, как в фильме. */
const COLUMNS = Array.from({ length: COLS }, (_, c) => ({
  inAt: T.inStart + random(`m-in-${c}`) * T.inSpread,
  inSpeed: 30 + random(`m-is-${c}`) * 18,
  outAt: T.outStart + random(`m-out-${c}`) * T.outSpread,
  outSpeed: 32 + random(`m-os-${c}`) * 18,
  streamSpeed: 14 + random(`m-ss-${c}`) * 16,
  streamOffset: random(`m-so-${c}`) * 1100,
  hasStream: random(`m-hs-${c}`) < 0.45,
}));

/** Голова колонки: y на кадре f (может быть выше кадра — колонка ещё не вошла). */
const headY = (f: number, at: number, speed: number) => (f - at) * speed - 40;

/**
 * Дождь сам превращается в код: к 1,1 с каждая струя становится светящейся цепочкой символов,
 * а в конце цепочки снова вытягиваются в обычные струи. Пока дождь — код, он падает медленнее.
 */
const rainToCode = (f: number) => smooth((f - 16) / 18) * (1 - smooth((f - 140) / 22));
const rainVelocity = (f: number) => 1 - 0.55 * rainToCode(f);
/** Пройденный путь к началу кадра f — скорость меняется, а цикл всё равно без стыка. */
const RAIN_DIST: number[] = [0];
for (let f = 0; f < LOOP; f++) RAIN_DIST.push(RAIN_DIST[f] + rainVelocity(f));
const RAIN_TOTAL = RAIN_DIST[LOOP];

/** Обычный дождь, как на фото: бледные струи; за цикл каждая проходит целое число кругов. */
const SPAN = S + 200;
const TILT = 0.07;
const wrap = (v: number) => (((v % SPAN) + SPAN) % SPAN) - 100;
const RAIN = Array.from({ length: 90 }, (_, i) => {
  const x = random(`r-x-${i}`) * (S + 60) - 30;
  const overFace = x > 160 && x < 640;
  return {
    x,
    phase: random(`r-p-${i}`),
    speed: ((5 + Math.floor(random(`r-k-${i}`) * 3)) * SPAN) / RAIN_TOTAL,
    len: 24 + random(`r-l-${i}`) * 46,
    width: 1.2 + random(`r-w-${i}`) * 0.8,
    alpha: (0.04 + random(`r-a-${i}`) * 0.09) * (overFace ? 0.55 : 1),
    /** Длина цепочки символов, в которую превращается струя. */
    chain: 4 + Math.floor(random(`r-c-${i}`) * 5),
  };
});
const rainTop = (d: (typeof RAIN)[number], f: number) => wrap(d.phase * SPAN + d.speed * RAIN_DIST[f]);

/**
 * Пасхалка для Java-разработчиков: пока лицо собрано из кода, по колонкам сверху вниз
 * «пишутся» настоящие слова из стека — ярче соседних символов, и снова растворяются.
 */
const WORDS = [
  { text: "@Autowired", col: 8, row: 14, at: 62 },
  { text: "Spring", col: 58, row: 10, at: 68 },
  { text: "Java", col: 14, row: 40, at: 76 },
  { text: "Kafka", col: 53, row: 37, at: 82 },
  { text: "Angular", col: 33, row: 3, at: 72 },
] as const;
/** Сколько кадров слово держится целиком после того, как написано. */
const WORD_HOLD = 22;
const WORD_FADE = 8;
/** Скорость «пишущей» головы: кадров на одну букву. */
const WORD_PACE = 1.6;

/** Яркость буквы k слова на кадре f: вспышка при написании, удержание, затухание. */
const letterStrength = (w: (typeof WORDS)[number], k: number, f: number) => {
  const born = w.at + k * WORD_PACE;
  if (f < born) return 0;
  const end = w.at + w.text.length * WORD_PACE + WORD_HOLD;
  return smooth((f - born) / 2) * (1 - smooth((f - end) / WORD_FADE));
};

/** Символ в клетке меняется со своим ритмом — код «живой». */
const glyphAt = (c: number, r: number, f: number) => {
  const period = 3 + Math.floor(random(`m-p-${c}-${r}`) * 10);
  return GLYPHS[Math.floor(random(`m-g-${c}-${r}-${Math.floor((f + c * 7) / period)}`) * GLYPHS.length)];
};

const hexToRgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const [CR, CG, CB] = hexToRgb(CODE_COLOR);

/** Яркость фото по клеткам сетки (0…1), с поднятым контрастом — чтобы лицо читалось в символах. */
const useLuminance = () => {
  const [lum, setLum] = useState<Float32Array | null>(null);
  const [handle] = useState(() => delayRender("Читаю яркость фото для кода"));
  useEffect(() => {
    const img = new Image();
    img.src = staticFile("mentor-800.png");
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = COLS;
      canvas.height = ROWS;
      const ctx = canvas.getContext("2d");
      if (!ctx) return cancelRender(new Error("Нет 2D-контекста"));
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, COLS, ROWS);
      const data = ctx.getImageData(0, 0, COLS, ROWS).data;
      const out = new Float32Array(COLS * ROWS);
      for (let i = 0; i < out.length; i++) {
        const l = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) / 255;
        out[i] = smooth((l - 0.06) / 0.62);
      }
      setLum(out);
      continueRender(handle);
    };
    img.onerror = () => cancelRender(new Error("Не загрузилось фото mentor-800.png"));
  }, [handle]);
  return lum;
};

const MatrixLayer: React.FC = () => {
  const frame = useCurrentFrame();
  const ref = useRef<HTMLCanvasElement>(null);
  const lum = useLuminance();

  useLayoutEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx || !lum) return;
    ctx.clearRect(0, 0, S, S);
    // Клетки, где сейчас пишется слово: обычный символ там не рисуем — его место занимает буква.
    const wordCells = new Map<number, { ch: string; s: number }>();
    for (const w of WORDS) {
      for (let k = 0; k < w.text.length; k++) {
        const st = letterStrength(w, k, frame);
        if (st > 0) wordCells.set((w.row + k) * COLS + w.col, { ch: w.text[k], s: st });
      }
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = `500 15px "${FONTS.body}"`;
    const streamsOn = smooth((frame - T.streamsFrom) / 10) * (1 - smooth((frame - (T.streamsTo - 10)) / 10));

    for (let c = 0; c < COLS; c++) {
      const col = COLUMNS[c];
      const h1 = headY(frame, col.inAt, col.inSpeed);
      const h2 = headY(frame, col.outAt, col.outSpeed);
      if (h1 < -TRAIL) continue; // колонка ещё не вошла
      const x = c * CELL + CELL / 2;

      // Тёмная подложка: прячет фото там, где сейчас код (сверху — край волны возврата, снизу — голова).
      const top = Math.max(0, h2 - TRAIL);
      const bottom = Math.min(S, h1);
      if (bottom > top) {
        // Мягкие края только там, где волна сейчас внутри кадра; у краёв кадра подложка сплошная.
        const span = Math.max(1, bottom - top);
        const fadeTop = h2 - TRAIL > 0;
        const fadeBottom = h1 < S;
        const g = ctx.createLinearGradient(0, top, 0, bottom);
        g.addColorStop(0, fadeTop ? "rgba(0,0,0,0)" : "rgba(0,0,0,0.93)");
        g.addColorStop(fadeTop ? Math.min(0.5, TRAIL / span) : 0, "rgba(0,0,0,0.93)");
        g.addColorStop(fadeBottom ? Math.max(0.5, 1 - TRAIL / span) : 1, "rgba(0,0,0,0.93)");
        g.addColorStop(1, fadeBottom ? "rgba(0,0,0,0)" : "rgba(0,0,0,0.93)");
        ctx.fillStyle = g;
        ctx.fillRect(c * CELL, top, CELL, bottom - top);
      }

      const streamHead = col.hasStream ? ((frame * col.streamSpeed + col.streamOffset) % 1100) - 150 : -9999;

      for (let r = 0; r < ROWS; r++) {
        const y = r * CELL + CELL;
        const amount = smooth((h1 - y) / TRAIL) * (1 - smooth((h2 - y) / TRAIL));
        if (amount < 0.01) continue;
        const L = lum[r * COLS + c];
        // Хвост за головой — ярче: классический «шлейф» колонки.
        const trail1 = h1 - y >= 0 && h1 - y < 10 * CELL ? 1 - (h1 - y) / (10 * CELL) : 0;
        const trail2 = h2 - y >= 0 && h2 - y < 8 * CELL ? 1 - (h2 - y) / (8 * CELL) : 0;
        const ds = streamHead - y;
        const trailS = streamsOn > 0 && ds >= 0 && ds < 12 * CELL ? (1 - ds / (12 * CELL)) * streamsOn : 0;
        const boost = Math.max(trail1, trail2 * 0.8, trailS * 0.7);
        // Под символами — лёгкий мятный отлив по яркости фото: лицо из кода читается целиком, а не только по буквам.
        if (L > 0.05) {
          ctx.fillStyle = `rgba(${CR},${CG},${CB},${(amount * L * 0.16).toFixed(3)})`;
          ctx.fillRect(c * CELL, y - CELL, CELL, CELL);
        }
        const alpha = amount * Math.min(1, 0.06 + 1.25 * L + boost * 0.55);
        if (alpha < 0.02 || wordCells.has(r * COLS + c)) continue;
        ctx.fillStyle = `rgba(${CR},${CG},${CB},${alpha.toFixed(3)})`;
        ctx.fillText(glyphAt(c, r, frame), x, y - 1);
      }

      // Головы колонок — почти белые и светятся.
      ctx.save();
      ctx.shadowColor = CODE_COLOR;
      ctx.shadowBlur = 12;
      ctx.font = `700 15px "${FONTS.body}"`;
      ctx.fillStyle = HEAD_COLOR;
      for (const h of [h1, h2, streamsOn > 0.05 ? streamHead : -9999]) {
        if (h < 0 || h > S + CELL) continue;
        const r = Math.floor(h / CELL);
        ctx.globalAlpha = h === streamHead ? streamsOn * 0.85 : 1;
        ctx.fillText(glyphAt(c, r, frame + 1), x, r * CELL + CELL - 1);
      }
      ctx.restore();
    }

    // Слова из стека — поверх сетки, со свечением; видны только там, где кадр уже стал кодом.
    ctx.save();
    ctx.shadowColor = CODE_COLOR;
    ctx.shadowBlur = 10;
    ctx.font = `700 15px "${FONTS.body}"`;
    for (const [cell, { ch, s }] of wordCells) {
      const c = cell % COLS;
      const r = Math.floor(cell / COLS);
      const col = COLUMNS[c];
      const y = r * CELL + CELL;
      const amount =
        smooth((headY(frame, col.inAt, col.inSpeed) - y) / TRAIL) *
        (1 - smooth((headY(frame, col.outAt, col.outSpeed) - y) / TRAIL));
      ctx.globalAlpha = s * amount;
      ctx.fillStyle = s > 0.98 ? CODE_COLOR : HEAD_COLOR;
      ctx.fillText(ch, c * CELL + CELL / 2, y - 1);
    }
    ctx.restore();

    // Дождь, ставший кодом: каждая струя — цепочка символов со светящейся головой.
    const m = rainToCode(frame);
    if (m > 0.01) {
      ctx.save();
      ctx.font = `500 15px "${FONTS.body}"`;
      RAIN.forEach((d, i) => {
        const head = rainTop(d, frame) + d.len;
        if (head < -CELL || head - d.chain * CELL > S) return;
        const x = d.x;
        for (let j = d.chain; j >= 0; j--) {
          const y = head - j * CELL;
          if (y < 0 || y > S + CELL) continue;
          const ch = GLYPHS[Math.floor(random(`r-g-${i}-${j}-${Math.floor((frame + i * 3) / 4)}`) * GLYPHS.length)];
          if (j === 0) {
            ctx.shadowColor = CODE_COLOR;
            ctx.shadowBlur = 12;
            ctx.globalAlpha = m;
            ctx.fillStyle = HEAD_COLOR;
          } else {
            ctx.shadowBlur = 0;
            ctx.globalAlpha = m * 0.75 * (1 - j / (d.chain + 1));
            ctx.fillStyle = CODE_COLOR;
          }
          ctx.fillText(ch, x, y);
        }
      });
      ctx.restore();
    }
  }, [frame, lum]);

  return <canvas ref={ref} width={S} height={S} style={{ position: "absolute", inset: 0 }} />;
};

export const TelegramAvatar: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* Исходник 640×640 увеличен до 800×800 заранее, классической интерполяцией Lanczos (без нейросетей). */}
      <Img src={staticFile("mentor-800.png")} style={{ width: S, height: S }} />
      <svg width={S} height={S} style={{ position: "absolute", inset: 0 }}>
        {RAIN.map((d, i) => {
          const top = rainTop(d, frame);
          const opacity = d.alpha * (1 - rainToCode(frame));
          if (opacity < 0.002) return null;
          return (
            <line
              key={i}
              x1={d.x + d.len * TILT}
              y1={top}
              x2={d.x}
              y2={top + d.len}
              stroke={COLORS.text}
              strokeWidth={d.width}
              strokeLinecap="round"
              opacity={opacity}
            />
          );
        })}
      </svg>
      <MatrixLayer />
    </AbsoluteFill>
  );
};
