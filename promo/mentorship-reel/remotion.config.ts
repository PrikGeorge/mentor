import { Config } from "@remotion/cli/config";

// H.264 + yuv420p + BT.709 — формат, который Reels/Shorts/TikTok принимают без перекодирования цвета.
Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(95);
Config.setCodec("h264");
Config.setPixelFormat("yuv420p");
Config.setColorSpace("bt709");
Config.setCrf(16);
Config.setOverwriteOutput(true);
