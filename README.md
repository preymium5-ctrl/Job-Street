# Jobs Street Croatia

A separate local recruitment website for skilled Filipino workers applying for jobs in Croatia. The design combines full-width photography, editorial headings and rounded controls inspired by the supplied J4RVIS reference with the Jobs in Croatia emblem and the supplied red and blue brand palette.

## Run locally

```powershell
cd 'E:\Jobs Street Croatia'
npm run dev
```

Open **http://127.0.0.1:3001**. The original website can continue to run on port 3000.

If dependencies need reinstalling, run `npm ci`. To create a production build, run `npm run build`, then `npm start` for a local production preview.

## Included

- 115 listed roles, including all 97 additional positions from the application form, with salary ranges and dated PHP estimates. New listings show €850–€2,000 per month and 250–1,200 slots across the form's six destination countries.
- The original qualifications, role-specific driver’s licence guidance, and document requirements.
- Prominent no-placement-fee messaging, free transportation and accommodation, and the supplied overtime/holiday benefits.
- Job search and filters, detailed role pages, a separate application form with CV/supporting-file uploads, and a private staff workspace.
- A direct general application at `/apply` reuses the existing form fields, document uploads, and application delivery. Applicants select their primary position inside the form without browsing job listings.
- Responsive layouts, reduced-motion support and three selectable hero messages.
- The original logo emblem and matching favicons, with a new Jobs Street Croatia wordmark.

## Local data and integrations

Applications and uploaded files are saved under **this project's `.data/` directory**. The original website's applicant database and existing uploads remain separate. No public default staff account is provided; run `npm run admin:setup` to create one if needed.

Google Sheets delivery is connected to the existing **Job Fair 2026** spreadsheet, using the same authorized Apps Script receiver as the original website. New applications are saved locally and queued for automatic delivery to its **Applications** tab. CVs and supporting documents are stored privately in Google Drive, with their links included in the application row. The queue retries interrupted deliveries and uses application IDs to prevent duplicate rows.

The connection is stored only in private `.env.local` settings: `GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_SHEETS_WEBHOOK_URL`, and `GOOGLE_SHEETS_WEBHOOK_SECRET`. Reuse these private server settings when deploying this site; never use `NEXT_PUBLIC_` variables for them. The matching connection record is under `.data/google-sheets/`. Both locations are excluded from version control. The original website's configuration and hosting were not changed. Local preview is excluded from search engines.

Verified on 17 October 2026 with an isolated application through the real submission handler: CV, diploma, other document and driver-license upload reached the shared sheet; a repeated submission did not duplicate the record. The synthetic test row and files were removed afterward. The spreadsheet's general access is Restricted, preserving its named owner and editor. Anonymous access is blocked, and a second complete submission verified that automatic delivery still works after restriction; its test row and private dummy files were also removed.

## Vercel deployment

Import this repository using the **Next.js** framework preset, with the root directory set to the repository root and the default `npm run build` command. Set `NEXT_PUBLIC_SITE_URL` and `APP_ORIGIN` to the final HTTPS website URL. The local `.env.local` file is intentionally excluded from Git.

For this site's production deployment, set `APPLICATION_STORAGE=google-sheets`. The existing signed Google Apps Script receiver is the durable application store: it writes the complete form answers to the recruiting team's **Applications** tab and saves every uploaded document privately in Google Drive. The website returns a successful application reference only after Google acknowledges the saved row. Exact retries recover the original reference and files; changed contents with a reused submission ID are rejected. The receiver also enforces submission limits. This mode requires the current version 3 receiver protocol (schema 6), the existing private `GOOGLE_SHEETS_WEBHOOK_URL` and `GOOGLE_SHEETS_WEBHOOK_SECRET`, and `GOOGLE_SHEETS_SPREADSHEET_ID`. Keep these values in Vercel's Production environment settings. Never commit them or expose the secret through a `NEXT_PUBLIC_` variable.

Google Sheets mode uses the current application form, with a 4 MB combined upload limit. Application answers including Telegram, address, birth details, destination, work country, other roles, English proficiency and consent are mapped to their existing tracker columns. CV, passport, residence ID, employment certificate, education, trade, clearance, Form 18a and driver's license uploads are sent as private Drive files with corresponding links. Staff use their authorized Google accounts to review these records; the database-backed website staff workspace is a separate configuration.

The default database mode remains available. It requires a production `DATABASE_URL`, a private S3-compatible upload bucket (`S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and provider-specific endpoint settings when needed), a random `SESSION_SECRET` of at least 32 characters, and a provisioned administrator. In that mode, submissions are saved to the database with a durable Sheets delivery queue and support the website's staff workspace.

Keep `CHAPTER_LOCAL_MODE=false` in production; never point `DATA_DIR` at a Vercel temporary filesystem for permanent applicant storage. Set `APP_ORIGIN` and `NEXT_PUBLIC_SITE_URL` to the published HTTPS origin. Set `INDEX_SITE=true` only for the final public production site. Keep previews excluded from indexing.

## Source and assets

Recruitment content is copied from the current Jobs in Croatia project on 17 October 2026. Canonical data is in `data/jobs.ts`, `data/hiring-allocations.ts`, `data/job-fair.ts`, and `data/employment.ts`. On 21 October 2026, the owner requested public listings for all additional application positions; these are in `data/application-jobs.ts` and `data/application-job-profiles.ts`. The public catalog combines these with `proposedJobs`; older exports are retained only for safe catalog migrations. Male-only illustrative category images and their generation prompts are recorded in `public/images/opportunities/SOURCES.md`.

Public recruitment photographs are the existing AI-generated illustrations. Font and icon licences remain alongside their assets in `public/`. The J4RVIS website is a visual reference; its text, images, code and logos are not copied.

Brand colors: primary red `#D91F32`, primary blue `#164B83`, light background `#F3F6FA`, dark text `#222B39`, secondary gray `#6B7280`, light blue `#E6F0FA` and light red `#FDE8EA`. Primary actions and no-placement-fee badges use red with white labels; headings and navigation use blue.

The two design layers are `styles/street.css` (homepage and shared shell) and `styles/street-interior.css` (job pages, forms and information pages).
