import { VIDEO_CHUNK_BYTES } from "./video-application";

export class VideoUploadError extends Error {
  constructor(message: string, readonly expired = false) { super(message); }
}

/** Resolves the playable length, or null when this browser cannot read the format. */
export function readVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    const done = (value: number | null) => {
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => done(null), 15_000);
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => done(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null);
    video.onerror = () => done(null);
    video.src = url;
  });
}

type PartResult = { status: number; range: string | null };

function send(url: string, body: Blob | null, contentRange: string, onProgress?: (loaded: number) => void): Promise<PartResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.timeout = 180_000;
    xhr.setRequestHeader("Content-Range", contentRange);
    if (onProgress) xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onload = () => resolve({ status: xhr.status, range: xhr.getResponseHeader("Range") });
    xhr.onerror = () => reject(new Error("network"));
    xhr.ontimeout = () => reject(new Error("timeout"));
    xhr.send(body);
  });
}

/** "bytes=0-1234" means bytes 0..1234 are stored, so the next byte is 1235. */
function nextOffset(range: string | null, fallback: number) {
  const match = /^bytes=0-(\d+)$/.exec(range || "");
  return match ? Number(match[1]) + 1 : fallback;
}

const finished = (status: number) => status === 200 || status === 201;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Uploads with the Google Drive resumable protocol: 8 MB parts, each confirmed
 * with 308 + Range, and automatic recovery from dropped mobile connections.
 */
export async function uploadVideo(uploadUrl: string, file: File, onProgress: (percent: number) => void) {
  const size = file.size;
  let offset = 0;
  let failures = 0;
  while (offset < size) {
    const end = Math.min(offset + VIDEO_CHUNK_BYTES, size);
    let result: PartResult;
    try {
      const start = offset;
      result = await send(uploadUrl, file.slice(start, end), `bytes ${start}-${end - 1}/${size}`,
        (loaded) => onProgress(Math.min(99, Math.floor(((start + loaded) / size) * 100))));
    } catch {
      result = { status: 0, range: null };
    }
    if (finished(result.status)) { onProgress(100); return; }
    if (result.status === 308) { offset = nextOffset(result.range, end); failures = 0; continue; }
    if (result.status === 404 || result.status === 410)
      throw new VideoUploadError("Your upload session expired. Select Submit to upload your video again.", true);
    if (result.status >= 400 && result.status < 500 && result.status !== 408 && result.status !== 429)
      throw new VideoUploadError("We couldn’t upload your video. Select Submit to try again.", true);
    // Network drop, timeout or temporary server error: ask where to resume.
    if (++failures > 5) throw new VideoUploadError("Your connection was interrupted. Check your internet and select Submit to resume the upload.");
    await wait(Math.min(16_000, 1000 * 2 ** failures));
    try {
      const status = await send(uploadUrl, null, `bytes */${size}`);
      if (finished(status.status)) { onProgress(100); return; }
      if (status.status === 308) offset = nextOffset(status.range, 0);
      else if (status.status === 404 || status.status === 410)
        throw new VideoUploadError("Your upload session expired. Select Submit to upload your video again.", true);
    } catch (error) {
      if (error instanceof VideoUploadError) throw error;
    }
  }
  // Every byte was acknowledged, but the final confirmation was lost.
  const status = await send(uploadUrl, null, `bytes */${size}`).catch(() => ({ status: 0, range: null }));
  if (!finished(status.status)) throw new VideoUploadError("We couldn’t confirm your video upload. Select Submit to try again.");
  onProgress(100);
}
