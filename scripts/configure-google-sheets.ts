import { readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { sheetsConfiguration, TARGET_SPREADSHEET_ID } from "../lib/sheets-transport";

async function main() {
  const url = process.argv[2]?.trim();
  if (!url) throw new Error("Pass the deployed Google Apps Script /exec URL.");
  const saved = JSON.parse(await readFile(path.join(process.cwd(), ".data", "google-sheets", "connection.json"), "utf8"));
  if (saved.spreadsheetId !== TARGET_SPREADSHEET_ID || typeof saved.secret !== "string" || !/^[a-f0-9]{64}$/.test(saved.secret)) throw new Error("Prepare the private connection files first.");
  if (!sheetsConfiguration({ GOOGLE_SHEETS_WEBHOOK_URL: url, GOOGLE_SHEETS_WEBHOOK_SECRET: saved.secret }).valid)
    throw new Error("Use the Google Apps Script deployment URL ending in /exec.");
  const environmentPath = path.join(process.cwd(), ".env.local");
  let previous = "";
  try { previous = await readFile(environmentPath, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const retained = previous.split(/\r?\n/).filter((line) => !/^\s*GOOGLE_SHEETS_WEBHOOK_(?:URL|SECRET)\s*=/.test(line));
  while (retained.at(-1) === "") retained.pop();
  const contents = `${retained.join("\n")}\nGOOGLE_SHEETS_WEBHOOK_URL=${url}\nGOOGLE_SHEETS_WEBHOOK_SECRET=${saved.secret}\n`;
  const staging = `${environmentPath}.sheets-staging`;
  await writeFile(staging, contents, { mode: 0o600 });
  await rename(staging, environmentPath);
  console.log("Google Sheets server settings saved privately. Restart the website, then verify one end-to-end application before claiming delivery is active.");
}
main().catch(() => { console.error("Google settings could not be saved. Prepare the private connection files and pass a valid Google Apps Script /exec URL. No credentials were printed."); process.exitCode = 1; });
