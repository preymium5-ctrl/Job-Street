import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { TARGET_SPREADSHEET_ID } from "../lib/sheets-transport";

async function main() {
  if (!/^[a-zA-Z0-9_-]{20,}$/.test(TARGET_SPREADSHEET_ID))
    throw new Error("Set this site's GOOGLE_SHEETS_SPREADSHEET_ID before preparing a new connection.");
  const directory = path.join(process.cwd(), ".data", "google-sheets");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const connectionPath = path.join(directory, "connection.json");
  let secret: string;
  try {
    const saved = JSON.parse(await readFile(connectionPath, "utf8"));
    if (saved.spreadsheetId !== TARGET_SPREADSHEET_ID || typeof saved.secret !== "string" || !/^[a-f0-9]{64}$/.test(saved.secret))
      throw new Error("The saved Google connection settings are invalid.");
    secret = saved.secret;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    secret = randomBytes(32).toString("hex");
    await writeFile(connectionPath, JSON.stringify({ spreadsheetId: TARGET_SPREADSHEET_ID, secret }), { flag: "wx", mode: 0o600 });
  }
  const template = await readFile(path.join(process.cwd(), "integrations", "google-sheets", "Code.gs"), "utf8");
  const installer = `\n/** Run this owner-only setup function once, then deploy the web app. */\nfunction configureChapterConnection() {\n  PropertiesService.getScriptProperties().setProperties({\n    CHAPTER_SHEET_ID: ${JSON.stringify(TARGET_SPREADSHEET_ID)},\n    CHAPTER_SHEET_NAME: 'Applications',\n    CHAPTER_WEBHOOK_SECRET: ${JSON.stringify(secret)}\n  });\n  return setupChapterSync();\n}\n`;
  await writeFile(path.join(directory, "Code.gs"), template + installer, { mode: 0o600 });
  await writeFile(path.join(directory, "appsscript.json"), await readFile(path.join(process.cwd(), "integrations", "google-sheets", "appsscript.json")), { mode: 0o600 });
  await writeFile(path.join(directory, "SETUP.md"), `# Activate Chapter → Google Sheets\n\nThe Applications tab is prepared in your existing spreadsheet. The website form and automatic retry queue are ready. Google authorization is still required.\n\n1. Open your spreadsheet as its owner, then **Extensions → Apps Script**.\n2. Paste the prepared private **Code.gs** into the script editor. In **Project Settings**, show the appsscript.json manifest, then replace it with the prepared **appsscript.json**.\n3. Select **configureChapterConnection** and click **Run**. Review and authorize Google access to the spreadsheet, files created by this script, and Google API requests. This creates a private CV folder.\n4. Choose **Deploy → New deployment → Web app**. Use **Execute as: Me**, **Who has access: Anyone**. The endpoint requires a signed server request; the spreadsheet and CVs stay private.\n5. Copy the deployment URL ending in **/exec** and send only that URL back in this chat. I can then activate the connection and test a complete submission.\n\nThe private Code.gs contains the connection secret. Do not post that file or secret in chat or commit it. The matching server secret is already saved privately in this workspace.\n\nFiles: Code.gs and appsscript.json in this same directory. Full technical guide: docs/GOOGLE_SHEETS_SETUP.md.\n`, { mode: 0o600 });
  console.log(`Prepared private connection files in ${directory}. No credentials were printed. Google authorization is still required.`);
}
main().catch(() => { console.error("Google connection files could not be prepared. Existing private settings were preserved."); process.exitCode = 1; });
