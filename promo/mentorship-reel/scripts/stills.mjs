// Рендерит контрольные кадры (по одному на смысловой момент) в out/stills/.
// Запуск: node scripts/stills.mjs [--safe] [кадр ...]
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { mkdirSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const showSafeZones = args.includes("--safe");
const vertical = args.includes("--vertical");
const custom = args.filter((a) => /^\d+$/.test(a)).map(Number);
const frames = custom.length ? custom : [0, 98, 180, 245, 282, 319, 409, 540, 614, 704, 745, 835, 900, 1031, 1112];

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, "out", "stills");
mkdirSync(outDir, { recursive: true });

const serveUrl = await bundle({ entryPoint: path.join(root, "src", "index.ts") });
const inputProps = { showSafeZones, ...(vertical ? { format: "vertical" } : {}) };
const composition = await selectComposition({ serveUrl, id: "MentorshipReel", inputProps });

for (const frame of frames) {
  const output = path.join(outDir, `f${String(frame).padStart(4, "0")}${vertical ? "-9x16" : ""}${showSafeZones ? "-safe" : ""}.png`);
  await renderStill({ composition, serveUrl, output, frame, inputProps });
  console.log(output);
}
