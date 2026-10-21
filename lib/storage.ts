import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import sharp from "sharp";
import { dataDirectory, localModeAllowed } from "./db";
import { MAX_SUPPORTING_DOCUMENT_BYTES } from "./document-uploads";

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export class UploadError extends Error {}
export type ValidatedResume = {
  bytes: Buffer;
  extension: "pdf" | "doc" | "docx";
  mime: string;
  name: string;
};
const crcTable = Array.from({ length: 256 }, (_, value) => {
  let result = value;
  for (let bit = 0; bit < 8; bit++)
    result = (result >>> 1) ^ (result & 1 ? 0xedb88320 : 0);
  return result >>> 0;
});
function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function validateDocx(bytes: Buffer) {
  // Inspect the central directory, rather than trusting the extension or client MIME.
  // Reject encrypted, macro-bearing, path-traversing, or excessive ZIP content.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (
      bytes.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + bytes.readUInt16LE(i + 20) === bytes.length
    ) {
      end = i;
      break;
    }
  }
  if (
    end < 0 ||
    bytes.readUInt16LE(end + 4) !== 0 ||
    bytes.readUInt16LE(end + 6) !== 0
  )
    throw new UploadError("The DOCX archive is incomplete.");
  const expectedEntries = bytes.readUInt16LE(end + 10);
  const directorySize = bytes.readUInt32LE(end + 12);
  const directoryStart = bytes.readUInt32LE(end + 16);
  if (
    !expectedEntries ||
    expectedEntries > 1000 ||
    bytes.readUInt16LE(end + 8) !== expectedEntries ||
    directoryStart + directorySize !== end
  )
    throw new UploadError("The DOCX archive is incomplete.");
  let foundContentTypes = false;
  let foundDocument = false;
  let totalUncompressed = 0;
  let entries = 0;
  for (let offset = directoryStart; offset < end;) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50)
      throw new UploadError("The DOCX archive is incomplete.");
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const compressed = bytes.readUInt32LE(offset + 20);
    const uncompressed = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    if (
      offset + 46 + nameLength + extraLength + commentLength > end ||
      localOffset + 30 > directoryStart ||
      bytes.readUInt32LE(localOffset) !== 0x04034b50 ||
      ![0, 8].includes(method)
    )
      throw new UploadError("The DOCX archive is incomplete.");
    const name = bytes
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString("utf8");
    if (
      flags & 1 ||
      name.includes("..") ||
      name.startsWith("/") ||
      name.includes("\\") ||
      /vbaproject|word\/embeddings\/|\.exe$|\.js$/i.test(name)
    )
      throw new UploadError(
        "Encrypted documents and active archive content are not accepted.",
      );
    totalUncompressed += uncompressed;
    entries++;
    if (
      totalUncompressed > 30 * 1024 * 1024 ||
      entries > 1000 ||
      uncompressed > 100 * Math.max(compressed, 1)
    )
      throw new UploadError("The DOCX archive is too large when expanded.");
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const bodyOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (
      bodyOffset + compressed > directoryStart ||
      bytes
        .subarray(localOffset + 30, localOffset + 30 + localNameLength)
        .toString("utf8") !== name
    )
      throw new UploadError("The DOCX archive is incomplete.");
    if (name === "[Content_Types].xml" || name === "word/document.xml") {
      let xml: string;
      try {
        const compressedBody = bytes.subarray(
          bodyOffset,
          bodyOffset + compressed,
        );
        const body =
          method === 0
            ? compressedBody
            : inflateRawSync(compressedBody, {
                maxOutputLength: 10 * 1024 * 1024,
              });
        if (
          body.length !== uncompressed ||
          crc32(body) !== bytes.readUInt32LE(offset + 16)
        )
          throw new Error("Invalid size or checksum");
        xml = body.toString("utf8");
      } catch {
        throw new UploadError("The DOCX archive contains an invalid document.");
      }
      if (/macroEnabled|<!ENTITY|<!DOCTYPE/i.test(xml))
        throw new UploadError("Active document content is not accepted.");
      if (name === "[Content_Types].xml")
        foundContentTypes = xml.includes(
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
        );
      if (name === "word/document.xml")
        foundDocument = /<(?:\w+:)?document(?:\s|>)/.test(xml);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (entries !== expectedEntries || !foundContentTypes || !foundDocument)
    throw new UploadError("Upload a valid Word DOCX document.");
}
export function validateResumeBytes(
  bytes: Buffer,
  filename: string,
): ValidatedResume {
  if (!bytes.length || bytes.length > MAX_RESUME_BYTES)
    throw new UploadError("The resume must be no larger than 5 MB.");
  const extension = path.extname(filename).toLowerCase().slice(1);
  let mime: string;
  if (extension === "pdf") {
    if (
      !bytes.subarray(0, 5).equals(Buffer.from("%PDF-")) ||
      !bytes
        .subarray(Math.max(0, bytes.length - 4096))
        .includes(Buffer.from("%%EOF"))
    )
      throw new UploadError("The file does not contain a valid PDF signature.");
    mime = "application/pdf";
  } else if (extension === "doc") {
    if (
      bytes.length < 512 ||
      !bytes
        .subarray(0, 8)
        .equals(
          Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
        ) ||
      bytes.readUInt16LE(28) !== 0xfffe ||
      ![9, 12].includes(bytes.readUInt16LE(30)) ||
      !bytes.includes(Buffer.from("WordDocument\0", "utf16le"))
    )
      throw new UploadError(
        "The file does not contain a valid Word DOC signature.",
      );
    if (
      ["VBA\0", "_VBA_PROJECT\0", "Macros\0"].some((marker) =>
        bytes.includes(Buffer.from(marker, "utf16le")),
      )
    )
      throw new UploadError(
        "Macro-bearing documents are not accepted. Export your resume as PDF.",
      );
    mime = "application/msword";
  } else if (extension === "docx") {
    if (bytes.length < 22 || bytes.readUInt32LE(0) !== 0x04034b50)
      throw new UploadError(
        "The file does not contain a valid DOCX signature.",
      );
    validateDocx(bytes);
    mime =
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  } else throw new UploadError("Upload a PDF, DOC, or DOCX resume.");
  const name =
    path
      .basename(filename.replace(/\\/g, "/"))
      .replace(/[^a-zA-Z0-9._ ()-]/g, "_")
      .replace(new RegExp(`\\.${extension}$`, "i"), "").slice(0, 140) + `.${extension}`;
  return { bytes, extension, mime, name } as ValidatedResume;
}
export async function validateResume(file: File) {
  if (file.size > MAX_RESUME_BYTES)
    throw new UploadError("The resume must be no larger than 5 MB.");
  return validateResumeBytes(Buffer.from(await file.arrayBuffer()), file.name);
}
let client: S3Client | undefined;
export function requireStorageConfiguration() {
  if (localModeAllowed() && !process.env.S3_BUCKET) return;
  if (
    !process.env.S3_BUCKET ||
    !process.env.S3_REGION ||
    !process.env.S3_ACCESS_KEY_ID ||
    !process.env.S3_SECRET_ACCESS_KEY
  )
    throw new Error("Production private storage is not configured.");
}
function s3Client() {
  requireStorageConfiguration();
  return (client ??= new S3Client({
    region: process.env.S3_REGION!,
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  }));
}
function safeStoragePath(key: string) {
  if (
    !/^(resumes\/[a-f0-9-]{36}\.(pdf|doc|docx)|documents\/[a-f0-9-]{36}\.(pdf|doc|docx|jpg)|images\/[a-f0-9-]{36}\.jpg)$/.test(
      key,
    )
  )
    throw new Error("Invalid storage key.");
  return path.join(dataDirectory(), "uploads", key);
}
async function writeObject(key: string, bytes: Buffer, contentType: string) {
  requireStorageConfiguration();
  if (process.env.S3_BUCKET)
    await s3Client().send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Body: bytes,
        ContentType: contentType,
      }),
    );
  else {
    const destination = safeStoragePath(key);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
  }
}
export async function storeResume(resume: ValidatedResume) {
  const key = `resumes/${randomUUID()}.${resume.extension}`;
  await writeObject(key, resume.bytes, resume.mime);
  return key;
}
export async function validateSupportingDocument(file: File) {
  if (!file.size || file.size > MAX_SUPPORTING_DOCUMENT_BYTES)
    throw new UploadError("Each supporting document must be 5 MB or smaller.");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (/\.(pdf|doc|docx)$/i.test(file.name)) return validateResumeBytes(bytes, file.name);
  if (!/\.(jpe?g|png)$/i.test(file.name))
    throw new UploadError("Supporting documents must be PDF, DOC, DOCX, JPG, or PNG files.");
  try {
    const image = sharp(bytes, { limitInputPixels: 36_000_000, failOn: "warning" });
    const metadata = await image.metadata();
    const expected = /\.png$/i.test(file.name) ? "png" : "jpeg";
    if (metadata.format !== expected || !metadata.width || !metadata.height || (metadata.pages || 1) !== 1)
      throw new Error("Invalid scan");
    const sanitized = await image.rotate().flatten({ background: "#ffffff" }).jpeg({ quality: 90 }).toBuffer();
    if (sanitized.length > MAX_SUPPORTING_DOCUMENT_BYTES) throw new Error("Scan too large");
    return { bytes: sanitized, extension: "jpg" as const, mime: "image/jpeg",
      name: path.basename(file.name.replace(/\\/g, "/")).replace(/[^a-zA-Z0-9._ ()-]/g, "_").replace(/\.(png|jpe?g)$/i, "").slice(0, 140) + ".jpg" };
  } catch { throw new UploadError("Upload a valid JPG or PNG scan no larger than 5 MB."); }
}
export async function storeSupportingDocument(document: Awaited<ReturnType<typeof validateSupportingDocument>>) {
  const key = `documents/${randomUUID()}.${document.extension}`;
  await writeObject(key, document.bytes, document.mime);
  return key;
}
export async function deleteObject(key: string) {
  safeStoragePath(key);
  if (process.env.S3_BUCKET)
    await s3Client().send(
      new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
    );
  else
    await unlink(safeStoragePath(key)).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
}
export async function readObject(key: string) {
  safeStoragePath(key);
  requireStorageConfiguration();
  if (!process.env.S3_BUCKET) return readFile(safeStoragePath(key));
  const result = await s3Client().send(
    new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
  );
  if (!result.Body) throw new Error("File could not be read.");
  return Buffer.from(await result.Body.transformToByteArray());
}
export async function storeImage(file: File) {
  if (
    !file.size ||
    file.size > MAX_IMAGE_BYTES ||
    !["image/jpeg", "image/png", "image/webp"].includes(file.type)
  )
    throw new UploadError(
      "Upload a JPEG, PNG, or WebP image no larger than 8 MB.",
    );
  const source = Buffer.from(await file.arrayBuffer());
  let bytes: Buffer;
  try {
    const image = sharp(source, {
      limitInputPixels: 36_000_000,
      failOn: "warning",
    });
    const metadata = await image.metadata();
    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width < 300 ||
      metadata.height < 200 ||
      !["jpeg", "png", "webp"].includes(metadata.format ?? "")
    )
      throw new UploadError("Use an image at least 300 × 200 pixels.");
    bytes = await image
      .rotate()
      .resize({
        width: 2000,
        height: 2000,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
  } catch (error) {
    if (error instanceof UploadError) throw error;
    throw new UploadError(
      "The image could not be decoded. Use a valid JPEG, PNG, or WebP.",
    );
  }
  const filename = `${randomUUID()}.jpg`;
  await writeObject(`images/${filename}`, bytes, "image/jpeg");
  return `/api/images/${filename}`;
}
