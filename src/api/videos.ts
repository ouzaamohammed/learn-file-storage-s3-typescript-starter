import type { BunRequest } from "bun";
import path from "path";

import { type ApiConfig } from "../config";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { respondWithJSON } from "./json";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";
import { getAssetPath } from "./assets";
import { uploadVideoToS3 } from "../s3";
import { rm } from "fs/promises";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const MAX_UPLOAD_SIZE = 1 << 30; // 1GB

  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading video for video", videoId, "by user", userID);

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Video not found");
  }
  if (video.userID !== userID) {
    throw new UserForbiddenError("Not authorized to update this video");
  }

  const formData = await req.formData();
  const file = formData.get("video");
  if (!(file instanceof File)) {
    throw new BadRequestError("video file missing");
  }
  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("Video exceeds the maximum allowed size of 1GB");
  }
  if (file.type !== "video/mp4") {
    throw new BadRequestError("Invalid file type. Only MP4 allowed");
  }

  const tempFilePath = path.join("/tmp", `${videoId}.mp4`);
  await Bun.write(tempFilePath, file);

  const filename = getAssetPath(file.type);
  const aspectRatio = await getVideoAspectRatio(tempFilePath);
  const key = `${aspectRatio}/${filename}`;
  await uploadVideoToS3(cfg, key, tempFilePath, file.type);

  video.videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${key}`;
  updateVideo(cfg.db, video);

  await Promise.all([rm(tempFilePath, { force: true })]);

  return respondWithJSON(200, video);
}

export async function getVideoAspectRatio(filePath: string) {
  const process = Bun.spawn(
    [
      "ffprobe",
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "json",
      filePath,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const exitCode = await process.exited;

  const outputText = await new Response(process.stdout).text();
  const errorText = await new Response(process.stderr).text();

  if (exitCode !== 0) {
    throw new Error(`ffprobe error: ${errorText}`);
  }

  const output = JSON.parse(outputText);
  if (!output.streams || output.streams.length === 0) {
    throw new Error("No video streams found");
  }

  const { width, height } = output.streams[0];

  return width === Math.floor(16 * (height / 9))
    ? "landscape"
    : height === Math.floor(16 * (width / 9))
      ? "portrait"
      : "other";
}
