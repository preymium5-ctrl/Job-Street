import { PGlite } from "@electric-sql/pglite";
import { drizzle as pgliteDrizzle } from "drizzle-orm/pglite";
import { drizzle as postgresDrizzle } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import * as schema from "./schema";
import { initialMigration } from "./migrations";

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
type State = { promise?: Promise<Database>; close?: () => Promise<void> };
const globalState = globalThis as typeof globalThis & { chapterDb?: State };
const state = (globalState.chapterDb ??= {});
export function localModeAllowed() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.CHAPTER_LOCAL_MODE === "true"
  );
}
export function dataDirectory() {
  return path.resolve(
    process.env.DATA_DIR || path.join(process.cwd(), ".data"),
  );
}

async function initialize(): Promise<Database> {
  let database: Database;
  if (process.env.DATABASE_URL) {
    const client = postgres(process.env.DATABASE_URL, {
      max: 8,
      prepare: false,
    });
    database = postgresDrizzle(client, { schema });
    state.close = () => client.end();
  } else {
    if (!localModeAllowed())
      throw new Error(
        "Production requires DATABASE_URL. Local preview requires explicit CHAPTER_LOCAL_MODE=true.",
      );
    await mkdir(dataDirectory(), { recursive: true, mode: 0o700 });
    const client = new PGlite(path.join(dataDirectory(), "db"));
    database = pgliteDrizzle(client, { schema });
    state.close = () => client.close();
  }
  // Transactions serialize schema initialization across processes on PostgreSQL.
  await database.transaction(async (tx) => {
    if (process.env.DATABASE_URL)
      await tx.execute(sql`SELECT pg_advisory_xact_lock(621349132)`);
    for (const statement of initialMigration
      .split(";")
      .map((line) => line.trim())
      .filter(Boolean)) {
      await tx.execute(sql.raw(statement));
    }
  });
  return database;
}
export function getDatabase() {
  if (!state.promise)
    state.promise = initialize().catch(async (error) => {
      await state.close?.().catch(() => undefined);
      state.close = undefined;
      state.promise = undefined;
      throw error;
    });
  return state.promise;
}
export async function closeDatabase() {
  if (state.promise) await state.promise;
  await state.close?.();
  state.promise = undefined;
  state.close = undefined;
}
