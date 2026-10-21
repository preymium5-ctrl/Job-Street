/* Job Fair 2026 application receiver. See docs/GOOGLE_SHEETS_SETUP.md before deployment. */
const CHAPTER_HEADERS = Object.freeze([
  'Application ID', 'Reference', 'Full name', 'Email', 'Contact number',
  'Job position', 'Preferred employer', 'Submitted at (UTC)', 'CV link',
  'CV file', 'Application status', 'Country', 'Experience (years)',
  'Recent role', 'Skills', 'NC2 certificate', 'Expected NC2', 'Education',
  'Professional summary', 'Cover letter', 'Employer allocations', 'Consent',
  'Diploma / education document', 'NC2 document', 'NBI / apostille document', 'Form 18a document', 'Other document',
  'Driver license details', 'Driver license document', 'Where did you hear about us?',
  'First name', 'Last name', 'Gender', 'Nationality', 'Current address / location',
  'Street', 'City', 'Province / State', 'Postal code', 'Date of birth', 'Place of birth',
  'Father’s full name', 'Mother’s full name', 'Destination country', 'Current work country',
  'Additional experienced role', 'Other job choice', 'English proficiency', 'Telegram number',
  'Terms accepted', 'Passport document', 'Residence ID document', 'Employment certificate document',
  'Application source'
]);
const CHAPTER_REMOVED_COLUMNS = Object.freeze([6, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 26, 27, 29, 33, 34, 53]);
const CHAPTER_V6_FORM_COLUMNS = Object.freeze(CHAPTER_HEADERS.map(function (_, index) { return index; }).filter(function (index) {
  return CHAPTER_REMOVED_COLUMNS.indexOf(index) === -1;
}));
// Append the restored question; keep every existing A:AI tracker position stable.
const CHAPTER_FORM_COLUMNS = Object.freeze(CHAPTER_V6_FORM_COLUMNS.concat([29]));
const CHAPTER_FORM_HEADERS = Object.freeze(CHAPTER_FORM_COLUMNS.map(function (index) {
  return index === 4 ? 'WhatsApp number' : index === 8 ? 'CV document' : index === 21 ? 'Privacy consent' : index === 29 ? 'Where did you find us?' : CHAPTER_HEADERS[index];
}));
const CHAPTER_NOTE_MARKER = '\n\nCHAPTER_RECEIVER_METADATA_V1\n';
const CHAPTER_REFERRAL_SOURCES = Object.freeze([
  'Facebook', 'TikTok', 'Instagram', 'Reddit', 'Threads', 'X (Twitter)', 'YouTube',
  'LinkedIn', 'Google Search', 'Google search', 'Friend or family', 'Other'
]);
const CHAPTER_SHEET_ID = '1v9-lAvpJPUCxCqr03EkVwKKAfedEDtckHir4ro6cyeU';
const CHAPTER_MAX_CV_BYTES = 5 * 1024 * 1024;
const CHAPTER_MAX_BODY_CHARS = 23000000;
const CHAPTER_DOCUMENT_CATEGORIES = ['diploma', 'nc2', 'nbi', 'form18a', 'other', 'driver-license', 'passport', 'residence-id', 'employment-certificate'];
const CHAPTER_FILE_FIELDS = 'id,name,mimeType,size,trashed,parents,appProperties,driveId';

/** Public health response intentionally exposes no configuration or applicant data. */
function doGet() {
  return chapterJson_({ ok: true, service: 'chapter-applications', version: 1, schemaVersion: 7,
    columns: CHAPTER_FORM_HEADERS.length, supportedColumns: [CHAPTER_FORM_HEADERS.length, CHAPTER_V6_FORM_COLUMNS.length, CHAPTER_HEADERS.length] });
}

function doPost(event) {
  let lock;
  let locked = false;
  try {
    const config = chapterConfig_();
    const raw = event && event.postData && event.postData.contents;
    chapterAssert_(typeof raw === 'string' && raw.length <= CHAPTER_MAX_BODY_CHARS, 'INVALID_REQUEST');
    const envelope = chapterParse_(raw);
    chapterKeys_(envelope, ['timestamp', 'payload', 'signature']);
    chapterAssert_(Number.isSafeInteger(envelope.timestamp) &&
      Math.abs(Date.now() - envelope.timestamp) <= 5 * 60 * 1000, 'EXPIRED_REQUEST');
    chapterAssert_(typeof envelope.payload === 'string' &&
      envelope.payload.length <= CHAPTER_MAX_BODY_CHARS, 'INVALID_REQUEST');
    chapterAssert_(typeof envelope.signature === 'string' && /^[a-f0-9]{64}$/.test(envelope.signature), 'INVALID_SIGNATURE');
    const expected = Utilities.computeHmacSha256Signature(
      String(envelope.timestamp) + '.' + envelope.payload,
      config.secret, Utilities.Charset.UTF_8
    ).map(function (byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join('');
    let difference = 0;
    for (let index = 0; index < 64; index++) {
      difference |= expected.charCodeAt(index) ^ envelope.signature.charCodeAt(index);
    }
    chapterAssert_(difference === 0, 'INVALID_SIGNATURE');
    const payload = chapterValidatePayload_(chapterParse_(envelope.payload));

    lock = LockService.getScriptLock();
    locked = lock.tryLock(25000);
    chapterAssert_(locked, 'BUSY_RETRY');
    const sheet = chapterGetSheet_(config, false);
    const layout = chapterVerifyHeaders_(sheet);
    chapterPrivateFolder_(config.folderId);
    const application = payload.application;
    const existing = chapterFindRow_(sheet, application.id, application.reference);
    if (existing) {
      const stored = chapterReadLogicalRow_(sheet, existing, layout);
      const referral = application.referralSource || application.discoverySource || '';
      let recoverReferral = false;
      if (referral) {
        chapterAssert_(!stored[29] || stored[29] === referral, 'EXISTING_PROFILE_MISMATCH');
        if (!stored[29]) { stored[29] = referral; recoverReferral = true; }
      }
      const cvLink = String(stored[8]);
      chapterExistingPrivateFile_(config, application, payload.resume, cvLink);
      const extended = stored.slice(30);
      const storedDocumentLinks = stored.slice(22, 27).concat([stored[28]], extended.slice(20, 23));
      chapterAssert_(stored[27] === (application.driverLicenseDetails || ''), 'EXISTING_DOCUMENT_MISMATCH');
      // The original six document columns must match the stored submission.
      // Only the appended identity columns permit recovery from an older row.
      storedDocumentLinks.slice(0, 6).forEach(function (link, index) {
        const document = payload.documents.find(function (item) { return item.category === CHAPTER_DOCUMENT_CATEGORIES[index]; });
        chapterAssert_(document ? link !== '' : link === '', 'EXISTING_DOCUMENT_MISMATCH');
      });
      const documentColumns = CHAPTER_DOCUMENT_CATEGORIES.map(function (category, index) {
        const document = payload.documents.find(function (item) { return item.category === category; });
        if (!document) return '';
        // Read committed file IDs directly. Drive search can lag immediately
        // after an upload; searching here could create a second copy on retry.
        const file = storedDocumentLinks[index] !== ''
          ? chapterExistingPrivateFile_(config, application, document, storedDocumentLinks[index], document.id)
          : chapterGetOrCreateCv_(config, application, document, document.bytes, document.id);
        return 'https://drive.google.com/file/d/' + file.id + '/view';
      });
      // A delivery may already have been written by an earlier receiver before
      // its acknowledgement was lost. Fill only previously blank extended cells;
      // retain historical answers and refuse conflicting nonempty retry values.
      if (payload.version === 3 || payload.documents.some(function (document) {
        return CHAPTER_DOCUMENT_CATEGORIES.indexOf(document.category) >= 6;
      })) {
        const expectedExtended = chapterExtendedRow_(application, documentColumns);
        let fill = false;
        const recovered = extended.map(function (value, index) {
          const expectedValue = expectedExtended[index];
          if (layout.compact && CHAPTER_FORM_COLUMNS.indexOf(index + 30) === -1 && index !== 23) return value;
          // Empty/absent answers are not requests to remove historical data.
          if (expectedValue === '') return value;
          chapterAssert_(value === '' || value === expectedValue,
            index >= 20 && index <= 22 ? 'EXISTING_DOCUMENT_MISMATCH' : 'EXISTING_PROFILE_MISMATCH');
          if (value === '') { fill = true; return expectedValue; }
          return value;
        });
        if (fill) {
          if (layout.compact) {
            const logical = stored.slice(0, 30).concat(recovered);
            chapterWriteCompactValues_(config, sheet, existing, logical, true, layout);
            recoverReferral = false;
          } else chapterWriteValues_(config, existing, 'AE', 'BB', recovered);
        }
      }
      if (recoverReferral) {
        if (layout.compact) chapterWriteCompactValues_(config, sheet, existing, stored, true, layout);
        else chapterWriteValues_(config, existing, 'AD', 'AD', [referral]);
      }
      return chapterJson_({ ok: true, applicationId: application.id,
        reference: application.reference, row: existing, duplicate: true, cvUrl: cvLink });
    }

    chapterEnforceSubmissionRate_(sheet, application, layout);
    const documentFiles = payload.documents.map(function (document) {
      return { category: document.category, file: chapterGetOrCreateCv_(config, application, document, document.bytes, document.id) };
    });
    const documentColumns = CHAPTER_DOCUMENT_CATEGORIES.map(function (category) {
      const item = documentFiles.find(function (item) { return item.category === category; });
      return item ? 'https://drive.google.com/file/d/' + item.file.id + '/view' : '';
    });
    const file = chapterGetOrCreateCv_(config, application, payload.resume, payload.bytes);
    const row = chapterRow_(application, file).concat(documentColumns.slice(0, 5), [
      application.driverLicenseDetails || '', documentColumns[5], application.referralSource || application.discoverySource || ''
    ], chapterExtendedRow_(application, documentColumns));
    // Use an explicit range: append's table detection can skip a hidden first column.
    // The script lock serializes writers and the ID/reference check makes retries safe.
    const rowNumber = sheet.getLastRow() + 1;
    if (rowNumber > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 100);
    if (layout.compact) chapterWriteCompactValues_(config, sheet, rowNumber, row, false, layout);
    else chapterWriteValues_(config, rowNumber, 'A', 'BB', row);
    return chapterJson_({ ok: true, applicationId: application.id,
      reference: application.reference, row: rowNumber, duplicate: false,
      cvUrl: 'https://drive.google.com/file/d/' + file.id + '/view' });
  } catch (error) {
    // Never echo Google responses, exception messages, submitted data or credentials.
    return chapterJson_({ ok: false, code: error && error.chapterCode || 'RECEIVER_ERROR' });
  } finally {
    if (locked) lock.releaseLock();
  }
}

/** Run once as the sheet owner after setting Script Properties. Never erases a tab. */
function setupChapterSync() {
  const config = chapterConfig_(true);
  const lock = LockService.getScriptLock();
  chapterAssert_(lock.tryLock(25000), 'BUSY_RETRY');
  try {
    const sheet = chapterGetSheet_(config, true);
    let backupName = '';
    if (sheet.getLastRow() === 0) {
      if (sheet.getMaxColumns() < CHAPTER_FORM_HEADERS.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), CHAPTER_FORM_HEADERS.length - sheet.getMaxColumns());
      sheet.getRange(1, 1, 1, CHAPTER_FORM_HEADERS.length).setValues([CHAPTER_FORM_HEADERS.slice()]);
      if (sheet.getMaxColumns() > CHAPTER_FORM_HEADERS.length) sheet.deleteColumns(CHAPTER_FORM_HEADERS.length + 1, sheet.getMaxColumns() - CHAPTER_FORM_HEADERS.length);
    } else if (!chapterHasCompactHeaders_(sheet)) {
      // Check every nonempty header before copying, extending or deleting data.
      chapterValidateLegacyUpgrade_(sheet);
      backupName = chapterBackupSheet_(sheet);
      chapterEnsureLegacyLayout_(sheet, true);
      const count = sheet.getLastRow() - 1;
      if (count > 0) {
        const values = sheet.getRange(2, 1, count, CHAPTER_HEADERS.length).getValues();
        const notes = sheet.getRange(2, 1, count, 1).getNotes();
        sheet.getRange(2, 1, count, 1).setNotes(values.map(function (row, index) {
          return [chapterMetadataNote_(notes[index][0], chapterLogicalMetadata_(row))];
        }));
      }
      // Deleting native columns preserves retained values, notes, formats and
      // validation; only the six known groups are removed, from right to left.
      const filter = sheet.getFilter();
      const criteria = [];
      if (filter) {
        const range = filter.getRange();
        CHAPTER_V6_FORM_COLUMNS.forEach(function (index) {
          criteria.push(index + 1 >= range.getColumn() && index + 1 < range.getColumn() + range.getNumColumns()
            ? filter.getColumnFilterCriteria(index + 1) : null);
        });
        filter.remove();
      }
      [[54, 1], [34, 2], [30, 1], [27, 2], [10, 12], [7, 1]].forEach(function (group) {
        sheet.deleteColumns(group[0], group[1]);
      });
      [4, 8, 21].forEach(function (index) {
        const column = CHAPTER_V6_FORM_COLUMNS.indexOf(index) + 1;
        sheet.getRange(1, column).setValue(CHAPTER_FORM_HEADERS[column - 1]);
      });
      const compactFilter = sheet.getRange(1, 1, sheet.getMaxRows(), CHAPTER_V6_FORM_COLUMNS.length).createFilter();
      criteria.forEach(function (criterion, index) {
        if (criterion) compactFilter.setColumnFilterCriteria(index + 1, criterion);
      });
    }
    if (chapterCompactLayout_(sheet) && chapterCompactLayout_(sheet).columns === CHAPTER_V6_FORM_COLUMNS.length) {
      // Preserve the original compact sheet before adding its first new question.
      if (!backupName) backupName = chapterBackupSheet_(sheet);
      chapterAppendReferralColumn_(config, sheet);
    }
    const layout = chapterVerifyHeaders_(sheet);
    chapterAssert_(layout.compact, 'HEADER_MISMATCH');
    sheet.setFrozenRows(1);
    sheet.setFrozenColumns(3);
    if (!sheet.getFilter()) sheet.getRange(1, 1, sheet.getMaxRows(), CHAPTER_FORM_HEADERS.length).createFilter();
    if (sheet.getMaxRows() > 1) sheet.getRange(2, CHAPTER_FORM_HEADERS.length, sheet.getMaxRows() - 1, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(CHAPTER_REFERRAL_SOURCES.slice(), true).setAllowInvalid(false).build()
    );
    if (!config.folderId) {
      const folder = chapterGoogleJson_(
        'https://www.googleapis.com/drive/v3/files?fields=id',
        { method: 'post', contentType: 'application/json', payload: JSON.stringify({
          name: 'Chapter — Applicant CVs (private)', mimeType: 'application/vnd.google-apps.folder',
          appProperties: { chapterPurpose: 'applicant-cvs-v1' }
        }) }, 'FOLDER_CREATE_FAILED'
      );
      chapterAssert_(typeof folder.id === 'string' && /^[A-Za-z0-9_-]+$/.test(folder.id), 'FOLDER_CREATE_FAILED');
      PropertiesService.getScriptProperties().setProperty('CHAPTER_CV_FOLDER_ID', folder.id);
      config.folderId = folder.id;
    }
    chapterPrivateFolder_(config.folderId);
    return { ok: true, sheetName: config.sheetName, columns: CHAPTER_FORM_HEADERS.length,
      backupSheetName: backupName || undefined,
      cvFolderUrl: 'https://drive.google.com/drive/folders/' + config.folderId };
  } finally {
    lock.releaseLock();
  }
}

/** Add AJ with literal values, including referrals retained during the rollout. */
function chapterAppendReferralColumn_(config, sheet) {
  if (sheet.getMaxColumns() < CHAPTER_FORM_HEADERS.length)
    sheet.insertColumnsAfter(sheet.getMaxColumns(), CHAPTER_FORM_HEADERS.length - sheet.getMaxColumns());
  const count = sheet.getLastRow() - 1;
  const notes = count > 0 ? sheet.getRange(2, 1, count, 1).getNotes() : [];
  const values = [CHAPTER_FORM_HEADERS[35]].concat(notes.map(function (row) {
    return chapterParseMetadata_(row[0]).referralSource || '';
  })).map(function (value) { return { values: [{ userEnteredValue: { stringValue: value } }] }; });
  const result = chapterGoogleJson_(
    'https://sheets.googleapis.com/v4/spreadsheets/' + config.sheetId + ':batchUpdate',
    { method: 'post', contentType: 'application/json', payload: JSON.stringify({ requests: [
      { updateCells: { start: { sheetId: sheet.getSheetId(), rowIndex: 0, columnIndex: CHAPTER_FORM_HEADERS.length - 1 },
        rows: values, fields: 'userEnteredValue' } }
    ] }) }, 'SHEET_WRITE_FAILED'
  );
  chapterAssert_(result.spreadsheetId === config.sheetId && Array.isArray(result.replies) && result.replies.length === 1, 'SHEET_WRITE_UNCONFIRMED');
  const filter = sheet.getFilter();
  const criteria = [];
  if (filter) {
    const range = filter.getRange();
    for (let column = 1; column <= CHAPTER_V6_FORM_COLUMNS.length; column++)
      criteria.push(column >= range.getColumn() && column < range.getColumn() + range.getNumColumns() ? filter.getColumnFilterCriteria(column) : null);
    filter.remove();
  }
  const expandedFilter = sheet.getRange(1, 1, sheet.getMaxRows(), CHAPTER_FORM_HEADERS.length).createFilter();
  criteria.forEach(function (criterion, index) { if (criterion) expandedFilter.setColumnFilterCriteria(index + 1, criterion); });
}

/** Expand only recognized older schemas before the native-column migration. */
function chapterEnsureLegacyLayout_(sheet, preserveValidations) {
    chapterRemoveLegacyStatusColumns_(sheet);
    const previousColumns = sheet.getMaxColumns();
    if (sheet.getMaxColumns() < CHAPTER_HEADERS.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), CHAPTER_HEADERS.length - sheet.getMaxColumns());
    if (sheet.getLastRow() > 0) {
      const current = sheet.getRange(1, 1, 1, CHAPTER_HEADERS.length).getValues()[0];
      chapterAssert_(current.every(function (value, index) { return chapterHeaderMatches_(value, index) || index >= 22 && !value; }) &&
        sheet.getLastColumn() <= CHAPTER_HEADERS.length, 'HEADER_MISMATCH');
      // Retain the shared Jobstreet Croatia header alias at AD and every existing
      // answer. Only the header row is extended; applicant rows are untouched.
      sheet.getRange(1, 23, 1, CHAPTER_HEADERS.length - 22).setValues([current.slice(22).map(function (value, index) {
        return value || CHAPTER_HEADERS[index + 22];
      })]);
    }
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, CHAPTER_HEADERS.length).setValues([CHAPTER_HEADERS.slice()]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, CHAPTER_HEADERS.length).setFontWeight('bold');
      if (!sheet.getFilter()) sheet.getRange(1, 1, sheet.getMaxRows(), CHAPTER_HEADERS.length).createFilter();
    }
    chapterAssert_(!chapterVerifyHeaders_(sheet).compact, 'HEADER_MISMATCH');
    // Inserted columns can inherit AD's referral dropdown. Profile answers and
    // document links are free text; remove only that unintended validation.
    if (sheet.getMaxRows() > 1) {
      const firstNewColumn = preserveValidations ? Math.max(31, previousColumns + 1) : 31;
      if (firstNewColumn <= CHAPTER_HEADERS.length) sheet.getRange(2, firstNewColumn, sheet.getMaxRows() - 1, CHAPTER_HEADERS.length - firstNewColumn + 1).clearDataValidations();
      if (!preserveValidations) sheet.getRange(2, 30, sheet.getMaxRows() - 1, 1).setDataValidation(
        SpreadsheetApp.newDataValidation().requireValueInList(CHAPTER_REFERRAL_SOURCES.slice(), true)
          .setAllowInvalid(false).build()
      );
    }
}

function chapterValidateLegacyUpgrade_(sheet) {
  chapterAssert_(sheet.getLastColumn() <= CHAPTER_HEADERS.length, 'HEADER_MISMATCH');
  let headers = sheet.getRange(1, 1, 1, Math.min(sheet.getMaxColumns(), CHAPTER_HEADERS.length)).getValues()[0];
  const retired = CHAPTER_HEADERS.slice(0, 17).concat([
    'NC2 status', 'Diploma status', 'NBI/apostille status', 'Form 18a status'
  ], CHAPTER_HEADERS.slice(17, 22));
  if (retired.every(function (header, index) { return headers[index] === header; })) {
    chapterAssert_(sheet.getLastColumn() <= 31, 'HEADER_MISMATCH');
    headers = headers.slice(); headers.splice(17, 4);
  }
  while (headers.length < CHAPTER_HEADERS.length) headers.push('');
  chapterAssert_(headers.every(function (header, index) {
    return chapterHeaderMatches_(header, index) || index >= 22 && header === '';
  }), 'HEADER_MISMATCH');
}

function chapterBackupSheet_(sheet) {
  const spreadsheet = sheet.getParent();
  const base = sheet.getName() + ' backup ' + new Date().toISOString().slice(0, 10);
  let name = base;
  let suffix = 2;
  while (spreadsheet.getSheetByName(name)) name = base + ' (' + suffix++ + ')';
  const backup = sheet.copyTo(spreadsheet).setName(name);
  backup.hideSheet();
  chapterAssert_(backup.isSheetHidden() && backup.getLastRow() === sheet.getLastRow() &&
    backup.getLastColumn() === sheet.getLastColumn(), 'BACKUP_FAILED');
  const original = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn());
  const copied = backup.getRange(1, 1, backup.getLastRow(), backup.getLastColumn());
  chapterAssert_(JSON.stringify(original.getValues()) === JSON.stringify(copied.getValues()) &&
    JSON.stringify(original.getNotes()) === JSON.stringify(copied.getNotes()), 'BACKUP_FAILED');
  return name;
}

/** Owner-only setup migration: remove exactly the four retired status columns. */
function chapterRemoveLegacyStatusColumns_(sheet) {
  if (sheet.getLastRow() === 0 || sheet.getMaxColumns() < 26) return;
  const legacyBase = CHAPTER_HEADERS.slice(0, 17).concat([
    'NC2 status', 'Diploma status', 'NBI/apostille status', 'Form 18a status'
  ], CHAPTER_HEADERS.slice(17, 22));
  const current = sheet.getRange(1, 1, 1, 26).getValues()[0];
  if (!current.every(function (value, index) { return value === legacyBase[index]; })) return;
  chapterAssert_(sheet.getLastColumn() <= 31, 'HEADER_MISMATCH');
  if (sheet.getLastColumn() > 26) {
    const documents = sheet.getRange(1, 27, 1, 5).getValues()[0];
    chapterAssert_(documents.every(function (value, index) {
      return !value || value === CHAPTER_HEADERS[index + 22];
    }), 'HEADER_MISMATCH');
  }
  sheet.deleteColumns(18, 4);
}

function chapterConfig_(allowMissingFolder) {
  const properties = PropertiesService.getScriptProperties();
  const config = {
    sheetId: properties.getProperty('CHAPTER_SHEET_ID') || CHAPTER_SHEET_ID,
    sheetName: properties.getProperty('CHAPTER_SHEET_NAME') || 'Applications',
    secret: properties.getProperty('CHAPTER_WEBHOOK_SECRET') || '',
    folderId: properties.getProperty('CHAPTER_CV_FOLDER_ID') || ''
  };
  chapterAssert_(config.sheetId === CHAPTER_SHEET_ID, 'WRONG_SPREADSHEET');
  chapterAssert_(config.sheetName.length <= 100 && !/[\[\]*?:/\\]/.test(config.sheetName), 'INVALID_CONFIGURATION');
  chapterAssert_(config.secret.length >= 32 && config.secret.length <= 512, 'NOT_CONFIGURED');
  chapterAssert_(allowMissingFolder && !config.folderId || /^[A-Za-z0-9_-]{10,200}$/.test(config.folderId), 'NOT_CONFIGURED');
  return config;
}

function chapterGetSheet_(config, create) {
  const spreadsheet = SpreadsheetApp.openById(config.sheetId);
  const sheet = spreadsheet.getSheetByName(config.sheetName);
  if (sheet) return sheet;
  chapterAssert_(create, 'SHEET_NOT_FOUND');
  return spreadsheet.insertSheet(config.sheetName);
}

function chapterVerifyHeaders_(sheet) {
  const compact = chapterCompactLayout_(sheet);
  if (compact) return compact;
  chapterAssert_(sheet.getMaxColumns() >= CHAPTER_HEADERS.length, 'HEADER_MISMATCH');
  const headers = sheet.getRange(1, 1, 1, CHAPTER_HEADERS.length).getValues()[0];
  chapterAssert_(headers.every(function (header, index) { return chapterHeaderMatches_(header, index); }), 'HEADER_MISMATCH');
  chapterAssert_(sheet.getLastColumn() <= CHAPTER_HEADERS.length, 'HEADER_MISMATCH');
  return { compact: false, columns: CHAPTER_HEADERS.length };
}

function chapterHasCompactHeaders_(sheet) {
  return Boolean(chapterCompactLayout_(sheet));
}

function chapterCompactLayout_(sheet) {
  const sizes = [CHAPTER_FORM_HEADERS.length, CHAPTER_V6_FORM_COLUMNS.length];
  for (let index = 0; index < sizes.length; index++) {
    const columns = sizes[index];
    if (sheet.getMaxColumns() >= columns && sheet.getLastColumn() <= columns &&
      sheet.getRange(1, 1, 1, columns).getValues()[0].every(function (header, column) { return header === CHAPTER_FORM_HEADERS[column]; }))
      return { compact: true, columns: columns };
  }
  return null;
}

function chapterHeaderMatches_(header, index) {
  return header === CHAPTER_HEADERS[index] || index === 29 && header === 'How did you hear about us?';
}

function chapterReadLogicalRow_(sheet, rowNumber, layout) {
  const values = sheet.getRange(rowNumber, 1, 1, layout.columns).getValues()[0];
  if (!layout.compact) return values;
  const row = CHAPTER_HEADERS.map(function () { return ''; });
  CHAPTER_FORM_COLUMNS.slice(0, layout.columns).forEach(function (index, column) { row[index] = values[column]; });
  const metadata = chapterParseMetadata_(sheet.getRange(rowNumber, 1).getNote());
  row[26] = metadata.otherDocumentUrl || '';
  row[27] = metadata.driverLicenseDetails || '';
  row[53] = metadata.source || (String(row[0]).indexOf('gs-') === 0 ? 'Jobs in Croatia' : '');
  if (layout.columns === CHAPTER_V6_FORM_COLUMNS.length) row[29] = metadata.referralSource || '';
  return row;
}

function chapterLogicalMetadata_(row) {
  return { source: row[53] || '', otherDocumentUrl: row[26] || '', driverLicenseDetails: row[27] || '', referralSource: row[29] || '' };
}

function chapterParseMetadata_(note) {
  const marker = String(note || '').lastIndexOf(CHAPTER_NOTE_MARKER);
  if (marker < 0) return {};
  let metadata;
  try { metadata = JSON.parse(note.slice(marker + CHAPTER_NOTE_MARKER.length)); }
  catch (_) { chapterAssert_(false, 'INVALID_ROW_METADATA'); }
  chapterAssert_(metadata && typeof metadata === 'object' && !Array.isArray(metadata) &&
    Object.keys(metadata).every(function (key) { return ['source', 'otherDocumentUrl', 'driverLicenseDetails', 'referralSource'].indexOf(key) !== -1; }) &&
    ['source', 'otherDocumentUrl', 'driverLicenseDetails', 'referralSource'].every(function (key) {
      return !Object.prototype.hasOwnProperty.call(metadata, key) || typeof metadata[key] === 'string';
    }), 'INVALID_ROW_METADATA');
  return metadata;
}

function chapterMetadataNote_(note, metadata) {
  const current = String(note || '');
  const marker = current.lastIndexOf(CHAPTER_NOTE_MARKER);
  return (marker < 0 ? current : current.slice(0, marker)) + CHAPTER_NOTE_MARKER + JSON.stringify(metadata);
}

function chapterFindRow_(sheet, id, reference) {
  const rows = sheet.getLastRow();
  if (rows < 2) return 0;
  const identifiers = sheet.getRange(2, 1, rows - 1, 2).getValues();
  let found = 0;
  identifiers.forEach(function (values, index) {
    if (values[0] === id || values[1] === reference) {
      chapterAssert_(!found && values[0] === id && values[1] === reference, 'DUPLICATE_CONFLICT');
      found = index + 2;
    }
  });
  return found;
}

/** The script lock makes these persisted limits shared by every website instance. */
function chapterEnforceSubmissionRate_(sheet, application, layout) {
  // Legacy Jobstreet Croatia deliveries retain their existing contract. An
  // acknowledged delivery can always be retried, even after the limit is met.
  if (application.applicationSource !== 'Jobs in Croatia') return;
  const count = sheet.getLastRow() - 1;
  if (count < 1) return;
  const contacts = sheet.getRange(2, 1, count, layout.columns).getValues();
  const notes = layout.compact ? sheet.getRange(2, 1, count, 1).getNotes() : null;
  const now = Date.now();
  const cutoff = now - 60 * 60 * 1000;
  const email = application.email.trim().toLowerCase();
  let total = 0;
  let matchingEmail = 0;
  contacts.forEach(function (row, index) {
    const source = layout.compact ? chapterParseMetadata_(notes[index][0]).source ||
      (String(row[0]).indexOf('gs-') === 0 ? 'Jobs in Croatia' : '') : row[53];
    if (source !== 'Jobs in Croatia') return;
    const submittedAt = new Date(row[layout.compact ? CHAPTER_FORM_COLUMNS.indexOf(7) : 7]).getTime();
    if (!Number.isFinite(submittedAt) || submittedAt < cutoff || submittedAt > now) return;
    total++;
    if (String(row[3]).trim().toLowerCase() === email) matchingEmail++;
  });
  chapterAssert_(total < 20 && matchingEmail < 3, 'SUBMISSION_RATE_LIMIT');
}

function chapterValidatePayload_(payload) {
  chapterKeys_(payload, payload && (payload.version === 2 || payload.version === 3) ? ['version', 'application', 'resume', 'documents'] : ['version', 'application', 'resume']);
  chapterAssert_(payload.version === 1 || payload.version === 2 || payload.version === 3, 'INVALID_VERSION');
  const application = payload.application;
  const applicationKeys = [
    'id', 'reference', 'submittedAt', 'jobTitle', 'jobId', 'status', 'fullName', 'email',
    'phone', 'country', 'recentJobTitle', 'experienceYears', 'skills', 'education', 'summary',
    'coverLetter', 'consent', 'nc2Certificate', 'documentReadiness', 'preferredEmployer',
    'expectedNc2', 'employers'
  ];
  if (application && Object.prototype.hasOwnProperty.call(application, 'driverLicenseDetails')) applicationKeys.push('driverLicenseDetails');
  ['referralSource', 'discoverySource'].forEach(function (key) {
    if (application && Object.prototype.hasOwnProperty.call(application, key)) applicationKeys.push(key);
  });
  if (payload.version === 3) ['profile', 'applicationSource', 'applicationFormVersion'].forEach(function (key) {
    if (application && Object.prototype.hasOwnProperty.call(application, key)) applicationKeys.push(key);
  });
  chapterKeys_(application, applicationKeys);
  if (Object.prototype.hasOwnProperty.call(application, 'driverLicenseDetails')) chapterText_(application.driverLicenseDetails, 200, 0);
  ['referralSource', 'discoverySource'].forEach(function (key) {
    if (!Object.prototype.hasOwnProperty.call(application, key)) return;
    chapterText_(application[key], 80, 0);
    chapterAssert_(!application[key] || CHAPTER_REFERRAL_SOURCES.indexOf(application[key]) !== -1, 'INVALID_APPLICATION');
  });
  chapterAssert_(!application.referralSource || !application.discoverySource ||
    application.referralSource === application.discoverySource, 'INVALID_APPLICATION');
  ['applicationSource', 'applicationFormVersion'].forEach(function (key) {
    if (Object.prototype.hasOwnProperty.call(application, key)) chapterText_(application[key], 80, 0);
  });
  if (Object.prototype.hasOwnProperty.call(application, 'profile')) chapterValidateProfile_(application.profile);
  [ ['id', 100, 1], ['reference', 80, 1], ['jobId', 100, 1], ['jobTitle', 160, 2],
    ['fullName', 120, 2], ['email', 254, 3], ['phone', 30, 7], ['country', 80, 2],
    ['recentJobTitle', 160, 0], ['skills', 2000, 0], ['education', 2000, 0],
    ['summary', 4000, 0], ['coverLetter', 6000, 0], ['nc2Certificate', 200, 0],
    ['preferredEmployer', 160, 0], ['expectedNc2', 300, 0]
  ].forEach(function (rule) { chapterText_(application[rule[0]], rule[1], rule[2]); });
  chapterAssert_(/^[A-Za-z0-9_-]+$/.test(application.id) && /^[A-Za-z0-9_-]+$/.test(application.reference), 'INVALID_APPLICATION');
  chapterAssert_(typeof application.submittedAt === 'string' && application.submittedAt.length <= 35 &&
    /^\d{4}-\d{2}-\d{2}T/.test(application.submittedAt) && Number.isFinite(Date.parse(application.submittedAt)), 'INVALID_APPLICATION');
  chapterAssert_(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(application.email) && /^[+\d\s().-]+$/.test(application.phone) &&
    application.phone.replace(/\D/g, '').length >= 7, 'INVALID_APPLICATION');
  chapterAssert_(application.experienceYears === null || typeof application.experienceYears === 'number' && Number.isFinite(application.experienceYears) &&
    application.experienceYears >= 0 && application.experienceYears <= 60, 'INVALID_APPLICATION');
  chapterAssert_(['New', 'Under Review', 'Shortlisted', 'Interview', 'Selected', 'Rejected'].indexOf(application.status) !== -1 &&
    application.consent === true, 'INVALID_APPLICATION');
  chapterKeys_(application.documentReadiness, ['nc2', 'diploma', 'nbi', 'form18a']);
  Object.keys(application.documentReadiness).forEach(function (key) {
    chapterAssert_(['ready', 'in-progress', 'not-yet'].indexOf(application.documentReadiness[key]) !== -1, 'INVALID_APPLICATION');
  });
  chapterAssert_(application.documentReadiness.nc2 !== 'ready' || application.nc2Certificate.trim().length >= 2, 'INVALID_APPLICATION');
  chapterAssert_(Array.isArray(application.employers) && application.employers.length <= 20, 'INVALID_APPLICATION');
  application.employers.forEach(function (employer) {
    chapterKeys_(employer, ['name', 'workers']);
    chapterText_(employer.name, 160, 1);
    chapterAssert_(Number.isSafeInteger(employer.workers) && employer.workers > 0 && employer.workers <= 10000, 'INVALID_APPLICATION');
  });
  chapterAssert_(!application.preferredEmployer || application.employers.some(function (employer) {
    return employer.name === application.preferredEmployer;
  }), 'INVALID_APPLICATION');
  const resume = payload.resume;
  chapterKeys_(resume, ['name', 'mime', 'base64']);
  const bytes = chapterValidateFile_(resume, CHAPTER_MAX_CV_BYTES, false);
  const documents = payload.version === 2 || payload.version === 3 ? payload.documents : [];
  chapterAssert_(Array.isArray(documents) && documents.length <= CHAPTER_DOCUMENT_CATEGORIES.length, 'INVALID_DOCUMENT');
  const categories = {};
  const identifiers = {};
  let totalBytes = bytes.length;
  const validated = documents.map(function (document) {
    chapterKeys_(document, ['id', 'category', 'name', 'mime', 'base64']);
    chapterAssert_(typeof document.id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(document.id) &&
      !identifiers[document.id] && CHAPTER_DOCUMENT_CATEGORIES.indexOf(document.category) !== -1 && !categories[document.category], 'INVALID_DOCUMENT');
    categories[document.category] = true;
    identifiers[document.id] = true;
    const documentBytes = chapterValidateFile_(document, 3 * 1024 * 1024, true);
    totalBytes += documentBytes.length;
    chapterAssert_(totalBytes <= 15 * 1024 * 1024, 'INVALID_DOCUMENT');
    return Object.assign({}, document, { bytes: documentBytes });
  });
  return { version: payload.version, application: application, resume: resume, bytes: bytes, documents: validated };
}

function chapterValidateProfile_(profile) {
  const required = ['firstName', 'lastName', 'gender', 'address', 'dateOfBirth', 'placeOfBirth',
    'destinationCountry', 'currentWorkCountry', 'secondaryJobTitle', 'englishProficiency', 'termsAccepted'];
  const optional = ['nationality', 'street', 'city', 'province', 'postalCode', 'telegram', 'fatherName', 'motherName', 'otherJobTitle'];
  chapterKeys_(profile, required.concat(optional.filter(function (key) {
    return profile && Object.prototype.hasOwnProperty.call(profile, key);
  })));
  [['firstName', 60, 1], ['lastName', 60, 1], ['address', 300, 1], ['placeOfBirth', 120, 1],
    ['destinationCountry', 80, 2], ['currentWorkCountry', 80, 2], ['secondaryJobTitle', 160, 1]
  ].forEach(function (rule) { chapterText_(profile[rule[0]], rule[1], rule[2]); });
  [['nationality', 80], ['street', 140], ['city', 60], ['province', 60], ['postalCode', 20],
    ['telegram', 80], ['fatherName', 120], ['motherName', 120], ['otherJobTitle', 160]
  ].forEach(function (rule) {
    if (Object.prototype.hasOwnProperty.call(profile, rule[0])) chapterText_(profile[rule[0]], rule[1], 0);
  });
  const birth = typeof profile.dateOfBirth === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(profile.dateOfBirth) &&
    new Date(profile.dateOfBirth + 'T00:00:00.000Z');
  chapterAssert_(birth && Number.isFinite(birth.getTime()) && birth.toISOString().slice(0, 10) === profile.dateOfBirth &&
    profile.dateOfBirth < new Date().toISOString().slice(0, 10), 'INVALID_APPLICATION');
  chapterAssert_(['Male', 'Female'].indexOf(profile.gender) !== -1 &&
    ['Yes', 'No'].indexOf(profile.englishProficiency) !== -1 && profile.termsAccepted === true, 'INVALID_APPLICATION');
}

function chapterValidateFile_(resume, maximum, supporting) {
  chapterText_(resume.name, 200, 1);
  chapterAssert_(!/[\\/\x00-\x1f\x7f]/.test(resume.name), 'INVALID_CV');
  const extensions = { 'application/pdf': '.pdf', 'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx' };
  if (supporting) { extensions['image/jpeg'] = '.jpg'; extensions['image/png'] = '.png'; }
  chapterAssert_(Object.prototype.hasOwnProperty.call(extensions, resume.mime) &&
    resume.name.toLowerCase().endsWith(extensions[resume.mime]), 'INVALID_CV');
  chapterAssert_(typeof resume.base64 === 'string' && resume.base64.length > 0 &&
    resume.base64.length <= Math.ceil(maximum / 3) * 4 &&
    resume.base64.length % 4 === 0 &&
    !/[^A-Za-z0-9+/]/.test(resume.base64.replace(/={1,2}$/, '')), 'INVALID_CV');
  let bytes;
  try { bytes = Utilities.base64Decode(resume.base64); } catch (_) { chapterAssert_(false, 'INVALID_CV'); }
  chapterAssert_(bytes.length > 0 && bytes.length <= maximum, 'INVALID_CV');
  const signature = bytes.slice(0, 8).map(function (byte) { return (byte + 256) % 256; });
  chapterAssert_(resume.mime === 'application/pdf' ? signature.slice(0, 5).join(',') === '37,80,68,70,45' :
    resume.mime === 'application/msword' ? signature.join(',') === '208,207,17,224,161,177,26,225' :
    resume.mime === 'image/jpeg' ? signature.slice(0, 3).join(',') === '255,216,255' :
    resume.mime === 'image/png' ? signature.join(',') === '137,80,78,71,13,10,26,10' :
    signature.slice(0, 4).join(',') === '80,75,3,4', 'INVALID_CV');
  // The website also performs detailed DOCX container validation before signing this payload.
  return bytes;
}

function chapterGetOrCreateCv_(config, application, resume, bytes, documentId) {
  // Drive property searches require both key and value. Select the CV from the
  // bounded application files locally, including legacy CVs without a document ID.
  const query = "trashed = false and '" + config.folderId + "' in parents and appProperties has { key='chapterApplicationId' and value='" + application.id + "' }";
  const search = chapterGoogleJson_('https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(query) +
    '&pageSize=' + (CHAPTER_DOCUMENT_CATEGORIES.length + 2) + '&fields=' + encodeURIComponent('files(' + CHAPTER_FILE_FIELDS + '),nextPageToken'), {}, 'CV_LOOKUP_FAILED');
  chapterAssert_(Array.isArray(search.files) && search.files.length <= CHAPTER_DOCUMENT_CATEGORIES.length + 1 && !search.nextPageToken, 'DUPLICATE_CV_CONFLICT');
  const matches = search.files.filter(function (file) {
    const identifier = file.appProperties && file.appProperties.chapterDocumentId;
    return documentId ? identifier === documentId : !identifier;
  });
  chapterAssert_(matches.length <= 1, 'DUPLICATE_CV_CONFLICT');
  let file = matches[0];
  if (!file) {
    const response = chapterGoogleFetch_(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=' + encodeURIComponent(CHAPTER_FILE_FIELDS),
      { method: 'post', contentType: 'application/json; charset=UTF-8', headers: {
          'X-Upload-Content-Type': resume.mime, 'X-Upload-Content-Length': String(bytes.length)
        }, payload: JSON.stringify({ name: application.reference + ' — ' + resume.name,
          mimeType: resume.mime, parents: [config.folderId],
          appProperties: Object.assign({ chapterApplicationId: application.id, chapterReference: application.reference }, documentId ? { chapterDocumentId: documentId } : {}) }) },
      'CV_UPLOAD_FAILED'
    );
    const headers = response.getAllHeaders();
    const locationKey = Object.keys(headers).find(function (key) { return key.toLowerCase() === 'location'; });
    const uploadUrl = locationKey && headers[locationKey];
    chapterAssert_(typeof uploadUrl === 'string' && /^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\?/.test(uploadUrl), 'CV_UPLOAD_FAILED');
    file = chapterGoogleJson_(uploadUrl, { method: 'put', contentType: resume.mime,
      payload: Utilities.newBlob(bytes, resume.mime, resume.name) }, 'CV_UPLOAD_FAILED');
  }
  chapterVerifyCv_(file, config.folderId, application, resume, documentId);
  chapterPrivatePermissions_(file.id);
  return file;
}

function chapterExistingPrivateFile_(config, application, document, link, documentId) {
  const match = typeof link === 'string' && /^https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)\/view$/.exec(link);
  chapterAssert_(match, documentId ? 'EXISTING_DOCUMENT_MISMATCH' : 'EXISTING_CV_MISSING');
  const file = chapterDriveGet_(match[1]);
  chapterVerifyCv_(file, config.folderId, application, document, documentId);
  chapterPrivatePermissions_(file.id);
  return file;
}

function chapterVerifyCv_(file, folderId, application, resume, documentId) {
  chapterAssert_(file && /^[A-Za-z0-9_-]+$/.test(file.id) && !file.trashed && !file.driveId &&
    Array.isArray(file.parents) && file.parents.indexOf(folderId) !== -1 && file.mimeType === resume.mime &&
    Number(file.size) > 0 && Number(file.size) <= (documentId ? 3 * 1024 * 1024 : CHAPTER_MAX_CV_BYTES) && file.appProperties &&
    file.appProperties.chapterApplicationId === application.id && file.appProperties.chapterReference === application.reference &&
    (documentId ? file.appProperties.chapterDocumentId === documentId : !file.appProperties.chapterDocumentId), 'CV_METADATA_MISMATCH');
}

function chapterDriveGet_(id) {
  return chapterGoogleJson_('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) +
    '?fields=' + encodeURIComponent(CHAPTER_FILE_FIELDS), {}, 'CV_LOOKUP_FAILED');
}

function chapterPrivateFolder_(id) {
  const folder = chapterDriveGet_(id);
  chapterAssert_(folder.mimeType === 'application/vnd.google-apps.folder' && !folder.trashed && !folder.driveId, 'INVALID_CV_FOLDER');
  chapterPrivatePermissions_(id);
}

function chapterPrivatePermissions_(id) {
  const response = chapterGoogleJson_('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) +
    '/permissions?pageSize=100&fields=permissions(type,role),nextPageToken', {}, 'PERMISSION_CHECK_FAILED');
  chapterAssert_(Array.isArray(response.permissions) && !response.nextPageToken && response.permissions.length > 0 &&
    response.permissions.every(function (permission) { return permission.type === 'user' || permission.type === 'group'; }), 'CV_NOT_PRIVATE');
}

function chapterRow_(application, file) {
  return [application.id, application.reference, application.fullName, application.email, application.phone,
    application.jobTitle, application.preferredEmployer, new Date(application.submittedAt).toISOString(),
    'https://drive.google.com/file/d/' + file.id + '/view', file.name, application.status, application.country,
    application.experienceYears === null ? '' : application.experienceYears, application.recentJobTitle, application.skills, application.nc2Certificate,
    application.expectedNc2, application.education, application.summary, application.coverLetter,
    application.employers.map(function (employer) { return employer.name + ': ' + employer.workers; }).join('; '), 'Yes'];
}

function chapterExtendedRow_(application, documentColumns) {
  const profile = application.profile || {};
  return ['firstName', 'lastName', 'gender', 'nationality', 'address', 'street', 'city', 'province', 'postalCode',
    'dateOfBirth', 'placeOfBirth', 'fatherName', 'motherName', 'destinationCountry', 'currentWorkCountry',
    'secondaryJobTitle', 'otherJobTitle', 'englishProficiency', 'telegram'
  ].map(function (key) { return profile[key] || ''; }).concat([
    profile.termsAccepted === true ? 'Yes' : '', documentColumns[6], documentColumns[7], documentColumns[8], application.applicationSource || ''
  ]);
}

function chapterWriteValues_(config, rowNumber, startColumn, endColumn, values) {
  const cells = startColumn + rowNumber + ':' + endColumn + rowNumber;
  const result = chapterGoogleJson_(
    'https://sheets.googleapis.com/v4/spreadsheets/' + config.sheetId + '/values/' +
    encodeURIComponent(chapterSheetRange_(config.sheetName, cells)) + '?valueInputOption=RAW',
    { method: 'put', contentType: 'application/json',
      payload: JSON.stringify({ majorDimension: 'ROWS', values: [values] }) }, 'SHEET_WRITE_FAILED'
  );
  chapterAssert_(typeof result.updatedRange === 'string' && result.updatedRange.endsWith('!' + cells) &&
    result.updatedRows === 1 && result.updatedColumns === values.length, 'SHEET_WRITE_UNCONFIRMED');
}

/** Atomically commit literal cell values and only the ID cell's technical note. */
function chapterWriteCompactValues_(config, sheet, rowNumber, logical, profileOnly, layout) {
  const firstColumn = profileOnly ? CHAPTER_FORM_COLUMNS.indexOf(30) : 0;
  const values = CHAPTER_FORM_COLUMNS.slice(firstColumn, layout.columns).map(function (index) {
    const value = logical[index];
    // Explicit stringValue prevents applicant text from becoming a formula.
    return { userEnteredValue: typeof value === 'number' ? { numberValue: value } : { stringValue: String(value == null ? '' : value) } };
  });
  const start = { sheetId: sheet.getSheetId(), rowIndex: rowNumber - 1, columnIndex: firstColumn };
  const note = chapterMetadataNote_(sheet.getRange(rowNumber, 1).getNote(), chapterLogicalMetadata_(logical));
  const result = chapterGoogleJson_(
    'https://sheets.googleapis.com/v4/spreadsheets/' + config.sheetId + ':batchUpdate',
    { method: 'post', contentType: 'application/json', payload: JSON.stringify({ requests: [
      { updateCells: { start: start, rows: [{ values: values }], fields: 'userEnteredValue' } },
      { updateCells: { start: { sheetId: sheet.getSheetId(), rowIndex: rowNumber - 1, columnIndex: 0 },
        rows: [{ values: [{ note: note }] }], fields: 'note' } }
    ] }) }, 'SHEET_WRITE_FAILED'
  );
  chapterAssert_(result.spreadsheetId === config.sheetId && Array.isArray(result.replies) && result.replies.length === 2,
    'SHEET_WRITE_UNCONFIRMED');
}

function chapterSheetRange_(name, cells) { return "'" + name.replace(/'/g, "''") + "'!" + cells; }
function chapterText_(value, maximum, minimum) {
  chapterAssert_(typeof value === 'string' && value.length <= maximum && value.trim().length >= minimum &&
    !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value), 'INVALID_APPLICATION');
}
function chapterKeys_(value, keys) {
  chapterAssert_(value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(function (key) {
      return Object.prototype.hasOwnProperty.call(value, key);
    }), 'INVALID_SCHEMA');
}
function chapterParse_(value) {
  try { return JSON.parse(value); } catch (_) { chapterAssert_(false, 'INVALID_JSON'); }
}
function chapterAssert_(condition, code) {
  if (!condition) { const error = new Error(code); error.chapterCode = code; throw error; }
}
function chapterGoogleFetch_(url, options, code) {
  const request = Object.assign({}, options, {
    muteHttpExceptions: true, followRedirects: false,
    headers: Object.assign({}, options.headers || {}, { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() })
  });
  let response;
  try { response = UrlFetchApp.fetch(url, request); } catch (_) { chapterAssert_(false, code); }
  chapterAssert_(response.getResponseCode() >= 200 && response.getResponseCode() < 300, code);
  return response;
}
function chapterGoogleJson_(url, options, code) {
  const response = chapterGoogleFetch_(url, options, code);
  try { return JSON.parse(response.getContentText()); } catch (_) { chapterAssert_(false, code); }
}
function chapterJson_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
