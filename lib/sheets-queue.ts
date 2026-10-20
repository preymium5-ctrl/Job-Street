import { and, asc, count, eq, isNull, lte, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDatabase, type Database } from "./db";
import { applications, jobs, sheetDeliveries } from "./schema";
import { MAX_RESUME_BYTES, readObject } from "./storage";
import { buildSheetsPayload, sendApplicationToSheets, sheetsConfiguration, SheetsDeliveryError, type SheetsTransport, type SheetsDocument } from "./sheets-transport";
import { MAX_APPLICATION_UPLOAD_BYTES, MAX_SUPPORTING_DOCUMENT_BYTES, supportingDocumentTypes } from "./document-uploads";

export interface DrainResult { delivered: number; deferred: number; configured: boolean; }
interface DrainDependencies {
  database?: Database;
  transport?: SheetsTransport;
  readResume?: typeof readObject;
  now?: () => Date;
}
const LEASE_MS = 150_000;

export function retryDelayMs(attempt: number) {
  return Math.min(6 * 60 * 60_000, 30_000 * 2 ** Math.min(Math.max(attempt - 1, 0), 10));
}

/** Transactional leases prevent two server processes from delivering the same intent concurrently. */
export async function drainSheetsQueue(options: { limit?: number; applicationId?: string; timeoutMs?: number } = {}, dependencies: DrainDependencies = {}): Promise<DrainResult> {
  const configuration = sheetsConfiguration();
  if (!dependencies.transport && !configuration.valid)
    return { delivered: 0, deferred: 0, configured: false };
  const db = dependencies.database || await getDatabase();
  const clock = dependencies.now || (() => new Date());
  const transport = dependencies.transport || sendApplicationToSheets;
  const readResume = dependencies.readResume || readObject;
  const result = { delivered: 0, deferred: 0, configured: true };
  const limit = Math.min(20, Math.max(1, options.limit || 5));
  for (let index = 0; index < limit; index++) {
    const now = clock();
    const claimed = await db.transaction(async (tx) => {
      const [delivery] = await tx.select().from(sheetDeliveries)
        .where(and(
          options.applicationId ? eq(sheetDeliveries.applicationId, options.applicationId) : undefined,
          or(
            and(eq(sheetDeliveries.state, "pending"), lte(sheetDeliveries.nextAttemptAt, now)),
            and(eq(sheetDeliveries.state, "processing"), or(isNull(sheetDeliveries.leaseUntil), lte(sheetDeliveries.leaseUntil, now))),
          ),
        ))
        .orderBy(asc(sheetDeliveries.nextAttemptAt)).limit(1).for("update", { skipLocked: true });
      if (!delivery) return undefined;
      const token = randomUUID();
      await tx.update(sheetDeliveries).set({ state: "processing", leaseToken: token, leaseUntil: new Date(now.getTime() + LEASE_MS), attempts: delivery.attempts + 1 }).where(eq(sheetDeliveries.applicationId, delivery.applicationId));
      return { ...delivery, token, attempts: delivery.attempts + 1 };
    });
    if (!claimed) break;
    try {
      const [application] = await db.select({ data: applications.data }).from(applications).where(eq(applications.id, claimed.applicationId)).limit(1);
      if (!application) throw new SheetsDeliveryError("RESUME_UNAVAILABLE");
      let bytes: Buffer;
      try {
        bytes = await readResume(application.data.resumeKey);
        if (!bytes.length || bytes.length > MAX_RESUME_BYTES) throw new Error("Invalid resume size");
      } catch { throw new SheetsDeliveryError("RESUME_UNAVAILABLE"); }
      const [job] = await db.select({ data: jobs.data }).from(jobs).where(eq(jobs.id, application.data.jobId)).limit(1);
      const documents: SheetsDocument[] = [];
      let totalBytes = bytes.length;
      for (const document of application.data.documents || []) {
        if (documents.length >= supportingDocumentTypes.length || documents.some((item) => item.category === document.category) || !supportingDocumentTypes.some((item) => item.id === document.category))
          throw new SheetsDeliveryError("RESUME_UNAVAILABLE");
        let content: Buffer;
        try { content = await readResume(document.key); }
        catch { throw new SheetsDeliveryError("RESUME_UNAVAILABLE"); }
        totalBytes += content.length;
        if (!content.length || content.length > MAX_SUPPORTING_DOCUMENT_BYTES || totalBytes > MAX_APPLICATION_UPLOAD_BYTES)
          throw new SheetsDeliveryError("RESUME_UNAVAILABLE");
        documents.push({ id: document.id, category: document.category, name: document.name, mime: document.mime, base64: content.toString("base64") });
      }
      const acknowledgement = await transport(buildSheetsPayload(application.data, bytes, job?.data, documents), { timeoutMs: options.timeoutMs });
      // Also validate injected transports at the durable boundary: HTTP success alone is insufficient.
      if (acknowledgement.ok !== true || acknowledgement.applicationId !== application.data.id || acknowledgement.reference !== application.data.reference || !Number.isSafeInteger(acknowledgement.row) || acknowledgement.row < 2 || typeof acknowledgement.duplicate !== "boolean")
        throw new SheetsDeliveryError("INVALID_ACKNOWLEDGEMENT");
      await db.update(sheetDeliveries).set({ state: "synced", syncedAt: clock(), sheetRow: acknowledgement.row, leaseToken: null, leaseUntil: null, lastError: null })
        .where(and(eq(sheetDeliveries.applicationId, claimed.applicationId), eq(sheetDeliveries.leaseToken, claimed.token)));
      result.delivered++;
    } catch (error) {
      const code = error instanceof SheetsDeliveryError ? error.code : "WEBHOOK_UNAVAILABLE";
      // Only a bounded code is retained. Remote errors and applicant data never enter logs.
      await db.update(sheetDeliveries).set({ state: "pending", nextAttemptAt: new Date(clock().getTime() + retryDelayMs(claimed.attempts)), lastError: code, leaseToken: null, leaseUntil: null })
        .where(and(eq(sheetDeliveries.applicationId, claimed.applicationId), eq(sheetDeliveries.leaseToken, claimed.token)));
      result.deferred++;
    }
  }
  return result;
}

export async function sheetsQueueStatus(database?: Database) {
  const db = database || await getDatabase();
  const rows = await db.select({ state: sheetDeliveries.state, total: count(), failed: sql<number>`sum(case when ${sheetDeliveries.lastError} is not null then 1 else 0 end)::integer` }).from(sheetDeliveries).groupBy(sheetDeliveries.state);
  const configuration = sheetsConfiguration();
  return {
    configured: configuration.valid,
    configuration: configuration.valid ? "configured" : configuration.code === "NOT_CONFIGURED" ? "not-configured" : "invalid",
    pending: rows.find((row) => row.state === "pending")?.total || 0,
    processing: rows.find((row) => row.state === "processing")?.total || 0,
    synced: rows.find((row) => row.state === "synced")?.total || 0,
    failed: rows.reduce((sum, row) => sum + (Number(row.failed) || 0), 0),
  };
}

export async function retryPendingSheetsDeliveries(database?: Database) {
  const db = database || await getDatabase();
  await db.update(sheetDeliveries).set({ state: "pending", nextAttemptAt: new Date(), leaseToken: null, leaseUntil: null })
    .where(or(eq(sheetDeliveries.state, "pending"), and(eq(sheetDeliveries.state, "processing"), lte(sheetDeliveries.leaseUntil, new Date()))));
  return drainSheetsQueue({ limit: 5 }, { database: db });
}

// Explicit opt-in for owners migrating earlier records; normal startup never exports old records.
export async function enqueueExistingApplications(database?: Database) {
  const db = database || await getDatabase();
  const rows = await db.select({ id: applications.id }).from(applications);
  if (!rows.length) return 0;
  const inserted = await db.insert(sheetDeliveries).values(rows.map((row) => ({ applicationId: row.id }))).onConflictDoNothing().returning({ id: sheetDeliveries.applicationId });
  return inserted.length;
}

export async function getApplicationSheetsState(applicationId: string) {
  const [row] = await (await getDatabase()).select({ state: sheetDeliveries.state }).from(sheetDeliveries).where(eq(sheetDeliveries.applicationId, applicationId)).limit(1);
  return row?.state === "synced" ? "synced" : "queued";
}

type WorkerState = { timer?: ReturnType<typeof setInterval>; running?: Promise<unknown> };
const globalWorker = globalThis as typeof globalThis & { chapterSheetsWorker?: WorkerState };
export function startSheetsWorker() {
  if (process.env.APPLICATION_STORAGE === "google-sheets") return;
  const state = (globalWorker.chapterSheetsWorker ??= {});
  if (state.timer) return;
  const run = () => {
    if (state.running || !sheetsConfiguration().valid) return;
    state.running = drainSheetsQueue({ limit: 5 }).catch(() => {
      console.error("Chapter Google Sheets queue could not be checked.");
    }).finally(() => { state.running = undefined; });
  };
  state.timer = setInterval(run, 60_000);
  state.timer.unref();
  run();
}
