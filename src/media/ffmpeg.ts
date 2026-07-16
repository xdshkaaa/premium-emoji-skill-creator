import { spawn } from "node:child_process";
import { config } from "../config.js";

let cached: boolean | undefined;

function probe(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(cmd, ["-version"]);
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

export async function detectFfmpeg(): Promise<boolean> {
  if (cached !== undefined) return cached;
  const [ffmpegOk, ffprobeOk] = await Promise.all([
    probe(config.FFMPEG_PATH),
    probe(config.FFPROBE_PATH),
  ]);
  cached = ffmpegOk && ffprobeOk;
  return cached;
}

export function ffmpegAvailable(): boolean {
  return cached ?? false;
}
