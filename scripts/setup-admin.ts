import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { eq } from "drizzle-orm";
import { hashPassword } from "../lib/auth";
import { closeDatabase, getDatabase } from "../lib/db";
import { administrators, audits, sessions } from "../lib/schema";

loadEnvConfig(process.cwd());
async function ask(prompt: string, secret = false) {
  if (!process.stdin.isTTY)
    throw new Error(
      "Set ADMIN_SETUP_EMAIL and ADMIN_SETUP_PASSWORD for a non-interactive setup.",
    );
  const output = secret
    ? new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      })
    : process.stdout;
  const readline = createInterface({
    input: process.stdin,
    output,
    terminal: true,
  });
  if (secret) process.stdout.write(prompt);
  try {
    const answer = await readline.question(secret ? "" : prompt);
    if (secret) process.stdout.write("\n");
    return answer.trim();
  } finally {
    readline.close();
  }
}
async function main() {
  const emailFlag = process.argv.indexOf("--email");
  const email = (
    process.env.ADMIN_SETUP_EMAIL ||
    (emailFlag > -1 ? process.argv[emailFlag + 1] : "") ||
    (await ask("Administrator email: "))
  )
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    throw new Error("Enter a valid administrator email.");
  const password =
    process.env.ADMIN_SETUP_PASSWORD ||
    (await ask("New password (at least 12 characters, hidden): ", true));
  if (
    !process.env.ADMIN_SETUP_PASSWORD &&
    password !== (await ask("Confirm password (hidden): ", true))
  )
    throw new Error("Passwords do not match.");
  const passwordHash = await hashPassword(password);
  const db = await getDatabase();
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(administrators)
      .where(eq(administrators.email, email));
    if (existing && !process.argv.includes("--reset"))
      throw new Error(
        "This administrator already exists. Use --reset to replace the password and revoke their sessions.",
      );
    const id = existing?.id || randomUUID();
    if (existing) {
      await tx
        .update(administrators)
        .set({ passwordHash })
        .where(eq(administrators.id, id));
      await tx.delete(sessions).where(eq(sessions.adminId, id));
    } else await tx.insert(administrators).values({ id, email, passwordHash });
    await tx
      .insert(audits)
      .values({
        id: randomUUID(),
        actorId: id,
        action: existing ? "admin.password_reset" : "admin.provisioned",
        targetId: id,
        details: { email },
      });
  });
  console.log(`Administrator ${email} is ready. Sign in at /admin.`);
}
main()
  .catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Administrator setup failed.",
    );
    process.exitCode = 1;
  })
  .finally(closeDatabase);
