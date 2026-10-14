import { loadFont as loadUnbounded } from "@remotion/google-fonts/Unbounded";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import { getInputProps } from "remotion";

// Палитра: два основных цвета и один акцент.
export const COLORS = {
  /** Основной 1 — «Графит», фон. */
  bg: "#0E131B",
  /** Основной 2 — «Молочный», текст. */
  text: "#EEF2F7",
  /** Акцент — «Терминальная мята»: линия, курсор, узлы, ник. Он же — цвет аватарки Telegram. */
  accent: "#36E4A6",
} as const;

/** Производные оттенки — не новые цвета, а основной 2 с прозрачностью. */
export const SHADES = {
  muted: "rgba(238, 242, 247, 0.58)",
  dimLine: "rgba(238, 242, 247, 0.24)",
  dimCursor: "rgba(238, 242, 247, 0.42)",
  grid: "rgba(238, 242, 247, 0.055)",
  /** Выделение слова в сценах «боли» — как выделенный текст в редакторе. */
  mark: "rgba(238, 242, 247, 0.16)",
  panel: "rgba(238, 242, 247, 0.05)",
  accentGlow: "rgba(54, 228, 166, 0.45)",
} as const;

// Одна выразительная гарнитура с сильной кириллицей + моноширинная для «терминальных» подписей.
// Два похожих гротеска рядом (как было: Manrope + IBM Plex Sans) выглядят как ошибка, а не как контраст.
const unbounded = loadUnbounded("normal", { weights: ["700"], subsets: ["cyrillic", "latin"] });
const mono = loadMono("normal", { weights: ["500", "700"], subsets: ["cyrillic", "latin"] });

export const FONTS = {
  /** Заголовки — Unbounded Bold. */
  head: unbounded.fontFamily,
  /** Подписи, ник, этапы, иллюстрации — JetBrains Mono. */
  body: mono.fontFamily,
} as const;

/**
 * Формат кадра. По умолчанию — квадрат 1:1 для объявления на Авито (галерея карточки — рамка около 4:3,
 * вертикальное видео в ней получает широкие чёрные поля). Вертикаль 9:16 для Reels/Shorts — props {"format":"vertical"}.
 */
export const FORMAT: "square" | "vertical" = getInputProps().format === "vertical" ? "vertical" : "square";
const SQUARE = FORMAT === "square";

export const W = 1080;
export const H = SQUARE ? 1080 : 1920;

export const SIZE = SQUARE
  ? {
      hook: 100,
      headline: 80,
      name: 84,
      routeTitle: 58,
      caption: 44,
      stage: 46,
      stack: 46,
      action: 56,
      prop: 30,
    }
  : {
      /** Хук — первые секунды, крупнее остальных заголовков. */
      hook: 108,
      headline: 84,
      name: 104,
      /** «к собеседованиям» — неразрывный блок, должен уложиться в ширину безопасной зоны. */
      routeTitle: 58,
      caption: 56,
      stage: 52,
      stack: 52,
      action: 64,
      /** Текст внутри иллюстраций (вкладки, терминал, чат). */
      prop: 38,
    };

/** Поля для ключевого текста. В вертикали — безопасная зона интерфейса Reels/Shorts, в квадрате — поля плеера. */
export const SAFE = SQUARE
  ? { top: 70, bottom: H - 70, left: 80, right: W - 80 }
  : { top: 250, bottom: H - 400, left: 90, right: W - 150 };
export const TEXT_WIDTH = SAFE.right - SAFE.left;

/** Сквозная линия-путь. */
export const LINE = {
  y: SQUARE ? 560 : 980,
  stroke: 8,
  cursorW: 30,
  cursorH: 64,
  /** Нижний край заголовков над линией. */
  textBottom: SQUARE ? 485 : 905,
  /** Верхний край подписей под линией. */
  captionTop: SQUARE ? 606 : 1028,
};

export const ROUTES = {
  forkX: SAFE.left,
  upperY: SQUARE ? 300 : 680,
  lowerY: SQUARE ? 820 : 1280,
  /** Где кривая развилки выходит на горизонталь. */
  bendX: 240,
  /** Узлы этапов на маршрутах. */
  nodes: [300, 600, 900] as const,
  /** Этапы шага «Как проходит работа». */
  steps: [200, 520, 840] as const,
};

/** Раскладка сцен, которая в двух форматах устроена по-разному. */
export const LAYOUT = SQUARE
  ? {
      /** Иллюстрации боли: верх блока (ниже петли под линией) и вкладки курсов. */
      props: { top: 730, tabW: 640, tabH: 62, tabStride: 54, tabsBottom: 990, termW: TEXT_WIDTH, chatW: 760 },
      /** «Кто я»: фото справа, имя слева в две строки. */
      who: {
        photo: { left: 470, top: 30, size: 560 },
        name: { left: SAFE.left, bottom: H - LINE.textBottom, width: 470 } as const,
      },
      /** Финал: заголовок над призывом, под линией — карточка «аватар + имя + стек». */
      cta: { headlineBottom: 410, avatar: { left: SAFE.left, top: 650, size: 170 }, card: true },
      /** Свет: [x, y] центра мятного свечения по сценам. */
      light: { hook: [330, 560], pain: [330, 760], who: [780, 320], mid: [540, 560], cta: [420, 480] } as const,
    }
  : {
      props: { top: 1170, tabW: 720, tabH: 84, tabStride: 62, tabsBottom: 1436, termW: 900, chatW: 780 },
      who: {
        photo: { left: (W - 660) / 2, top: 110, size: 660 },
        name: { left: SAFE.left, bottom: H - LINE.textBottom, width: undefined } as const,
      },
      cta: { headlineBottom: 830, avatar: { left: SAFE.left, top: 300, size: 180 }, card: false },
      light: { hook: [330, 980], pain: [330, 1100], who: [540, 470], mid: [540, 980], cta: [420, 760] } as const,
    };
