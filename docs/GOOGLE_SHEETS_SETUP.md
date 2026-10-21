# Google Sheets application delivery

## Current production connection (21 October 2026)

The production site uses `APPLICATION_STORAGE=google-sheets`. Set these values in
the Vercel project's **Production** environment, then deploy the website:

- `APP_ORIGIN` and `NEXT_PUBLIC_SITE_URL`: the published HTTPS website origin.
- `APPLICATION_STORAGE`: `google-sheets`.
- `GOOGLE_SHEETS_SPREADSHEET_ID`: the existing Job Fair 2026 tracker ID.
- `GOOGLE_SHEETS_WEBHOOK_URL` and `GOOGLE_SHEETS_WEBHOOK_SECRET`: the existing
  private receiver connection. Store both as secrets; do not include them in Git.

This explicit mode saves applications in Google Sheets and uploads in private
Google Drive. It needs no temporary filesystem, PostgreSQL database or S3 bucket.
The database-backed website staff workspace remains a separate configuration.

The application payload uses protocol version 3. Receiver schema 7 adds
**Where did you find us?** at **AJ (36)**, after the existing 35 columns in the
**Applications** tab. Columns A:AI retain their values and coordinates. The
receiver also accepts the previous 35-column compact tracker and the earlier
54-column layout. Both websites sharing this tracker may send `discoverySource`
or the older `referralSource` alias. Conflicting nonempty aliases are rejected.

The new column stores the selected Facebook, TikTok, Instagram, Reddit, Threads,
X (Twitter), YouTube, LinkedIn, Google search, Friend or family, or Other answer
as literal text. Applications with no collected answer retain blank cells; no
answer is inferred. Private document links, Google sharing, connection secrets,
and existing source attribution in the application ID notes remain unchanged.
The checked-in receiver matches the shared live Version 14 deployment. Its
SHA-256 is `AB5E9DCBF752AF42665F02D4079035851D4011C0711F584A7B82C73957AE810E`.

Deploy the website transport compatibility change before changing the shared
receiver or tracker: it accepts health responses with 35, 36, or 54 columns for
complete profile delivery. Publish the updated existing receiver deployment,
then run owner-only `setupChapterSync`. For the existing 35-column tracker, it
first creates and verifies a hidden backup, then appends AJ without moving A:AI.
It fills AJ only from discovery answers already retained in receiver metadata,
adds the dropdown, and extends filtering while preserving existing criteria.
Existing applicant cells and notes, Script Properties, and private Drive folders
are preserved. Unexpected headers stop the upgrade. Enable the website question
only after verifying the receiver and visible AJ column.

During this staged upgrade the receiver accepts submissions against the
35-column tracker and durably retains discovery answers in the application ID
cell's technical metadata. The owner setup restores those exact retained answers
into AJ. The 36-column tracker writes and reads the visible answer at AJ, and an
exact retry preserves the original answer, row, and private files. A conflicting
nonempty answer is rejected. The previous 54-column layout continues writing the
answer to its established AD column. A retry may fill a blank discovery cell
from the same signed application; it does not replace a nonempty answer.

The current form's personal details, Telegram, structured address, birth details,
parents' names, destination, work country, additional role, English answer and
acknowledgements are mapped to the existing columns. All collected uploads,
including passport, residence ID and employment certificates, are delivered to
private Drive with links in the tracker. The combined upload limit is 4 MB.

The website returns success only after an acknowledgement matching its signed
application ID, reference and row. Retrying an identical submission reuses its
record and private files. Changed contents with a reused submission key return
a conflict. Google storage uses the receiver's existing `Jobs in Croatia` quota
namespace, with `jobstreet-croatia-v2` as the separate form identifier.

Verification must include a clearly labeled test application through the live
website endpoint with a discovery answer, readback of the complete tracker row
including AJ, and an exact retry that returns the same receipt without another
row or file. Public health should advertise schema 7 and 36 columns, with
supported layouts 36, 35, and 54. Local unit tests alone do not confirm a
production connection. A 403 from `/api/applications` means the
configured origin does not match the website. Receiver failures return an error
instead of an unconfirmed successful submission.

## Historical integration notes (receiver schemas 3 and 4)

The following notes describe the earlier partial export. They do not describe
the production schema 6 connection above.

## Expanded application profile and versioned uploads

The reference-style application form stores its additional personal and English
proficiency answers in `applicantDetails`. Version 2 (`applicationFormVersion: 2`)
requires a CV, valid passport, and updated residence ID (front and back combined in
one file). Diploma, NC2, NBI/apostille, Form 18a, employment certificate, and driver’s
license uploads are optional. The generic `other` upload is not collected by this
version. Each file, including the CV, must be no larger than 3 MB; all uploads
together must stay within 4 MB. Existing unversioned submissions retain their
5 MB CV, 3 MB per supporting file, and 15 MB combined limits, with only the CV
required. Passport, residence ID, and employment certificate files use the
`passport`, `residence-id`, and `employment-certificate` categories.
These answers and files are retained in the website's application database and
private storage, available through authenticated staff review and download.

Receiver schemas 3 and 4 accept only their established application fields and six
document categories. The export builder explicitly selects the supported fields
and excludes `applicantDetails`, `applicationFormVersion`, `destinationCountry`,
`termsAccepted`, and future unknown fields. It also excludes the
three new upload categories from Google Sheets and Google Drive delivery. Existing
CV and supported-document exports continue unchanged; an application with only
the identity documents exports as version 1 (CV only), without unsupported
document entries. Discovery answers retain the capability check described below.

Version 2 does not ask for a recent job title, skills text, or experience years.
The website stores empty strings and zero for those legacy fields. Its outbound
copy supplies the explicit system text **Not collected by this form** for blank
recent-title and skills fields because the existing receiver requires nonempty
strings. This does not fabricate applicant answers in the website record.

Exporting the additional questions or new document types requires a separately
reviewed receiver schema and owner deployment. No live receiver, tracker columns,
or access permissions are changed by the form update. A delivery acknowledged by
the current receiver is considered synced for its supported fields; future
receiver upgrades do not automatically backfill the omitted answers or files.

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
