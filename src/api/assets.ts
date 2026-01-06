import { existsSync, mkdirSync } from "fs";
import { randomBytes } from "crypto";
import path from "path";

import type { ApiConfig } from "../config";

export function ensureAssetsDir(cfg: ApiConfig) {
  if (!existsSync(cfg.assetsRoot)) {
    mkdirSync(cfg.assetsRoot, { recursive: true });
  }
}

export function mediaTypeToExt(mediaType: string) {
  const parts = mediaType.split("/");
  if (parts.length !== 2) {
    return ".bin";
  }

  return "." + parts[1];
}

export function getAssetPath(mediaType: string) {
  const ext = mediaTypeToExt(mediaType);
  const id = randomBytes(32).toString("base64url");
  return id + ext;
}

export function getAssetDiskPath(cfg: ApiConfig, assetPath: string) {
  return path.join(cfg.assetsRoot, assetPath);
}

export function getAssetURL(cfg: ApiConfig, assetPath: string) {
  return `http://localhost:${cfg.port}/assets/${assetPath}`;
}
