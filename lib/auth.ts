import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, gt, sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { dataDirectory, getDatabase, localModeAllowed } from "./db";
import { administrators, audits, rateLimits, sessions } from "./schema";

export const SESSION_COOKIE = "jobs_street_staff";
const SESSION_SECONDS = 8 * 60 * 60;
let secretPromise: Promise<string> | undefined;
function scryptKey(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}
export async function hashPassword(password: string) {
  if (password.length < 12 || password.length > 256)
    throw new Error("Use a password between 12 and 256 characters.");
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${(await scryptKey(password, salt)).toString("hex")}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [method, salt, hash] = encoded.split("$");
  if (
    method !== "scrypt" ||
    !/^[a-f0-9]{32}$/.test(salt || "") ||
    !/^[a-f0-9]{128}$/.test(hash || "") ||
    password.length > 256
  )
    return false;
  const expected = Buffer.from(hash, "hex");
  const actual = await scryptKey(password, salt);
  return timingSafeEqual(actual, expected);
}
async function sessionSecret() {
  // Recheck the required production configuration before using a cached local secret.
  if (!localModeAllowed() && !process.env.SESSION_SECRET)
    throw new Error("Production requires a SESSION_SECRET.");
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length < 32)
    throw new Error(
      "SESSION_SECRET must contain at least 32 random characters.",
    );
  if (!secretPromise)
    secretPromise = (async () => {
      if (process.env.SESSION_SECRET) {
        if (process.env.SESSION_SECRET.length < 32)
          throw new Error(
            "SESSION_SECRET must contain at least 32 random characters.",
          );
        return process.env.SESSION_SECRET;
      }
      if (!localModeAllowed())
        throw new Error("Production requires a SESSION_SECRET.");
      const secretPath = path.join(dataDirectory(), "session-secret");
      await mkdir(dataDirectory(), { recursive: true, mode: 0o700 });
      try {
        return (await readFile(secretPath, "utf8")).trim();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const secret = randomBytes(48).toString("hex");
        try {
          await writeFile(secretPath, secret, { flag: "wx", mode: 0o600 });
          return secret;
        } catch (writeError) {
          if ((writeError as NodeJS.ErrnoException).code === "EEXIST")
            return (await readFile(secretPath, "utf8")).trim();
          throw writeError;
        }
      }
    })().catch((error) => {
      secretPromise = undefined;
      throw error;
    });
  return secretPromise;
}
export async function signSession(id: string, expires: number) {
  const body = Buffer.from(JSON.stringify({ id, expires })).toString(
    "base64url",
  );
  const signature = createHmac("sha256", await sessionSecret())
    .update(body)
    .digest("base64url");
  return `${body}.${signature}`;
}
export async function decodeSession(value: string) {
  if (value.length > 1024) return undefined;
  const [body, signature, extra] = value.split(".");
  if (!body || !signature || extra) return undefined;
  const expected = createHmac("sha256", await sessionSecret())
    .update(body)
    .digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(expected, actual))
    return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (
      typeof decoded.id !== "string" ||
      !/^[a-f0-9-]{36}$/.test(decoded.id) ||
      typeof decoded.expires !== "number" ||
      decoded.expires <= Date.now()
    )
      return undefined;
    return decoded as { id: string; expires: number };
  } catch {
    return undefined;
  }
}
export async function currentAdmin(request: NextRequest) {
  const cookie = request.cookies.get(SESSION_COOKIE)?.value;
  if (!cookie) return undefined;
  const decoded = await decodeSession(cookie);
  if (!decoded) return undefined;
  const db = await getDatabase();
  const [row] = await db
    .select({
      id: administrators.id,
      email: administrators.email,
      sessionId: sessions.id,
    })
    .from(sessions)
    .innerJoin(administrators, eq(sessions.adminId, administrators.id))
    .where(and(eq(sessions.id, decoded.id), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return row;
}
export async function login(email: string, password: string) {
  await sessionSecret();
  const db = await getDatabase();
  const [admin] = await db
    .select()
    .from(administrators)
    .where(eq(administrators.email, email.toLowerCase().trim()))
    .limit(1);
  // Unknown email follows the same expensive password derivation path.
  const dummyHash = `scrypt$${"0".repeat(32)}$${"0".repeat(128)}`;
  const valid = await verifyPassword(
    password,
    admin?.passwordHash ?? dummyHash,
  );
  if (!admin || !valid) return undefined;
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000);
  await db.transaction(async (tx) => {
    await tx.insert(sessions).values({ id, adminId: admin.id, expiresAt });
    await tx
      .insert(audits)
      .values({
        id: randomUUID(),
        actorId: admin.id,
        action: "session.login",
        targetId: id,
        details: {},
      });
  });
  return {
    email: admin.email,
    cookie: await signSession(id, expiresAt.getTime()),
  };
}
export async function requireApplicationConfiguration() {
  if (localModeAllowed()) return;
  await sessionSecret();
  const [admin] = await (
    await getDatabase()
  )
    .select({ id: administrators.id })
    .from(administrators)
    .limit(1);
  if (!admin)
    throw new Error(
      "Provision an administrator before accepting production applications.",
    );
}
export async function logout(request: NextRequest) {
  const admin = await currentAdmin(request);
  if (admin)
    await (
      await getDatabase()
    )
      .delete(sessions)
      .where(eq(sessions.id, admin.sessionId));
}
export function sessionCookieOptions(request: NextRequest) {
  return {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:" || !localModeAllowed(),
    sameSite: "strict" as const,
    path: "/",
    maxAge: SESSION_SECONDS,
  };
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  if (!process.env.APP_ORIGIN && !localModeAllowed()) return false;
  const expected = process.env.APP_ORIGIN || new URL(request.url).origin;
  try {
    const configured = new URL(expected);
    if (!localModeAllowed() && configured.protocol !== "https:") return false;
    return new URL(origin).origin === configured.origin;
  } catch {
    return false;
  }
}
export async function rateLimit(
  request: Request,
  purpose: string,
  max: number,
  windowSeconds: number,
  discriminator = "",
) {
  const forwarded =
    process.env.TRUST_PROXY === "true"
      ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      : undefined;
  const identity =
    forwarded && /^[a-fA-F0-9:.]{3,64}$/.test(forwarded) ? forwarded : "shared";
  const key = `${purpose}:${createHash("sha256").update(`${identity}|${discriminator}`).digest("hex")}`;
  const db = await getDatabase();
  const now = new Date();
  const expiresAt = new Date(Date.now() + windowSeconds * 1000);
  const [result] = await db
    .insert(rateLimits)
    .values({ key, count: 1, expiresAt })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`CASE WHEN ${rateLimits.expiresAt} <= ${now} THEN 1 ELSE ${rateLimits.count} + 1 END`,
        expiresAt: sql`CASE WHEN ${rateLimits.expiresAt} <= ${now} THEN ${expiresAt} ELSE ${rateLimits.expiresAt} END`,
      },
    })
    .returning({ count: rateLimits.count });
  return result.count <= max;
}
