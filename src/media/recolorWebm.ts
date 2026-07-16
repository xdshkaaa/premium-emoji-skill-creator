import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../config.js";
import type { Hsl } from "./color.js";
import { tintRgbaInPlace } from "./color.js";

export class WebmTooLargeError extends Error {
  constructor(size: number) {
    super(`Recolored .webm exceeds 256KB limit (${size} bytes)`);
  }
}

const WEBM_MAX_BYTES = 256 * 1024;

function run(cmd: string, args: string[]): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    const stdoutChunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => stdoutChunks.push(c));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`${cmd} exited with code ${code}: ${stderr}`));
        return;
      }
      resolve({ stdout: Buffer.concat(stdoutChunks), stderr });
    });
  });
}

async function probeDimensions(path: string): Promise<{ width: number; height: number; fps: string }> {
  const { stdout } = await run(config.FFPROBE_PATH, [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,r_frame_rate",
    "-of",
    "csv=p=0",
    path,
  ]);
  const [w, h, fps] = stdout.toString("utf8").trim().split(",");
  return { width: Number(w), height: Number(h), fps: fps ?? "30/1" };
}

async function decodeToRgba(path: string): Promise<Buffer> {
  const { stdout } = await run(config.FFMPEG_PATH, [
    "-c:v",
    "libvpx-vp9",
    "-i",
    path,
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "pipe:1",
  ]);
  return stdout;
}

async function encodeFromRgba(
  rawPath: string,
  outPath: string,
  dims: { width: number; height: number; fps: string },
  crf: number,
): Promise<void> {
  await run(config.FFMPEG_PATH, [
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "-s",
    `${dims.width}x${dims.height}`,
    "-r",
    dims.fps,
    "-i",
    rawPath,
    "-c:v",
    "libvpx-vp9",
    "-pix_fmt",
    "yuva420p",
    "-crf",
    String(crf),
    "-b:v",
    "0",
    "-y",
    outPath,
  ]);
}

export async function recolorWebmSticker(buf: Buffer, hsl: Hsl): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), "recolor-webm-"));
  const inPath = join(dir, "in.webm");
  const rawPath = join(dir, "raw.rgba");
  const outPath = join(dir, "out.webm");

  try {
    writeFileSync(inPath, buf);
    const dims = await probeDimensions(inPath);

    const raw = await decodeToRgba(inPath);
    tintRgbaInPlace(raw, hsl, 4);
    writeFileSync(rawPath, raw);

    await encodeFromRgba(rawPath, outPath, dims, 42);
    let out = readFileSync(outPath);
    if (out.byteLength > WEBM_MAX_BYTES) {
      await encodeFromRgba(rawPath, outPath, dims, 50);
      out = readFileSync(outPath);
      if (out.byteLength > WEBM_MAX_BYTES) {
        throw new WebmTooLargeError(out.byteLength);
      }
    }
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
