# Google Sheets receiver and discovery source

The website stores applications and their optional `discoverySource` answer before
exporting them. The signed Apps Script receiver writes recruiter rows and private
CV/document links; its HMAC secret does not authorize editing or deploying the
Apps Script project.

## Current compatibility behavior

- Existing schema 3 receivers use 29 columns, A:AC, and reject unknown application
  keys. They continue receiving the original payload shape.
- When an application has a discovery answer, the website first reads the public
  receiver health endpoint, with a three-second limit inside the delivery timeout.
  Only the expected `chapter-applications` service advertising schema 4 or newer
  and at least 30 columns receives `discoverySource`. Redirects remain restricted
  to Google's ContentService response host, and health requests contain no
  application data, signature, or secret.
- Older, unavailable, malformed, oversized, or untrusted health responses cause
  only `discoverySource` to be omitted from that outbound copy. The original answer
  remains in the application's database record and admin view. Missing or blank
  answers do not require a health request.
- The updated receiver appends **How did you hear about us?** at column **AD (30)**.
  Columns A:AC retain their existing positions. Older applications have a blank AD
  cell; no discovery answer is inferred for them.

An application successfully delivered to a legacy receiver is marked synced even
though its discovery answer was omitted. Upgrading the receiver does not
automatically backfill those answers or rewrite already delivered rows. Any
historical AD backfill is a separate, owner-authorized operation using the stored
application IDs and answers.

## Owner upgrade of an existing schema 3 deployment

The checked-in files are ready for review; editing them locally does not change
the live receiver. Use the owner account that controls the existing spreadsheet
and Apps Script project.

1. Schedule a short Sheets sync pause while preserving the site's durable delivery
   queue. Application storage remains available; avoid processing exports between
   the header change and publishing the matching receiver version. Keep the
   current deployment URL, script properties, private CV folder, and secret.
2. Open the existing project's Apps Script editor and replace its receiver code
   with `integrations/google-sheets/Code.gs`. Preserve its configured target
   spreadsheet ID and existing `CHAPTER_*` script properties. Do not run an
   installer that generates a new secret or private folder.
3. Run `setupChapterSync` as the owner. For the current 29-column layout, setup
   verifies the existing headers and adds AD without deleting or shifting A:AC or
   changing existing applicant cells. Unexpected headers stop the operation.
4. Publish a new version through **Deploy → Manage deployments → Edit**, updating
   the existing web-app deployment. Keep **Execute as: Me** and the existing access
   settings. Updating the existing deployment preserves the configured `/exec`
   URL.
5. Read the public `/exec` health response and confirm `service` is
   `chapter-applications`, `schemaVersion` is `4`, and `columns` is `30`.
6. Resume sync and let queued deliveries retry. For a live acceptance check, use a
   clearly identified test application to confirm the selected answer appears in
   AD, previous columns remain aligned, and retries do not duplicate rows or
   private files.

The schema 3 receiver rejects a sheet with the new AD header, while schema 4
expects that header. Keep the sync pause through both setup and deployment.
Delivery failures during this interval remain queued for retry.

`scripts/prepare-google-sheets.ts` prepares local private files for an owner-led
connection setup. It does not authorize Google access or deploy the receiver.
`scripts/configure-google-sheets.ts` saves the website's existing webhook URL and
matching secret privately; it also does not deploy anything. Never commit or
paste generated private `Code.gs`, `.env.local`, or connection secrets into chat.

Automated updates require the Apps Script project identity and Google OAuth
credentials with the relevant project/deployment scopes. A configured webhook
and HMAC secret alone are insufficient. See Google's
[deployment update API](https://developers.google.com/apps-script/api/reference/rest/v1/projects.deployments/update)
and [deployment management guide](https://developers.google.com/apps-script/concepts/deployments).
