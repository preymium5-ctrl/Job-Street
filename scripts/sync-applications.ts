import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

async function main() {
  const { closeDatabase } = await import("../lib/db");
  const { drainSheetsQueue, enqueueExistingApplications, retryPendingSheetsDeliveries, sheetsQueueStatus } = await import("../lib/sheets-queue");
  try {
    if (process.argv.includes("--include-existing")) {
      const count = await enqueueExistingApplications();
      console.log(`Queued ${count} existing application(s).`);
    }
    if (process.argv.includes("--retry")) await retryPendingSheetsDeliveries();
    else await drainSheetsQueue({ limit: 20 });
    console.log(JSON.stringify(await sheetsQueueStatus(), null, 2));
  } finally { await closeDatabase(); }
}
main().catch(() => { console.error("Google Sheets sync could not complete. Check the integration configuration and private storage."); process.exitCode = 1; });
