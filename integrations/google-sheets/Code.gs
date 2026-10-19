/* Job Fair 2026 application receiver. See docs/GOOGLE_SHEETS_SETUP.md before deployment. */
const CHAPTER_HEADERS = Object.freeze([
  'Application ID', 'Reference', 'Full name', 'Email', 'Contact number',
  'Job position', 'Preferred employer', 'Submitted at (UTC)', 'CV link',
  'CV file', 'Application status', 'Country', 'Experience (years)',
  'Recent role', 'Skills', 'NC2 certificate', 'Expected NC2', 'Education',
  'Professional summary', 'Cover letter', 'Employer allocations', 'Consent',
  'Diploma / education document', 'NC2 document', 'NBI / apostille document', 'Form 18a document', 'Other document',
  'Driver license details', 'Driver license document', 'How did you hear about us?'
]);
const CHAPTER_SHEET_ID = '1v9-lAvpJPUCxCqr03EkVwKKAfedEDtckHir4ro6cyeU';
const CHAPTER_MAX_CV_BYTES = 5 * 1024 * 1024;
const CHAPTER_MAX_BODY_CHARS = 23000000;
const CHAPTER_DOCUMENT_CATEGORIES = ['diploma', 'nc2', 'nbi', 'form18a', 'other', 'driver-license'];
const CHAPTER_DISCOVERY_SOURCES = ['Facebook', 'TikTok', 'Instagram', 'Reddit', 'Threads', 'X (Twitter)',
  'YouTube', 'LinkedIn', 'Google search', 'Friend or family', 'Other'];
const CHAPTER_FILE_FIELDS = 'id,name,mimeType,size,trashed,parents,appProperties,driveId';

/** Public health response intentionally exposes no configuration or applicant data. */
function doGet() {
  return chapterJson_({ ok: true, service: 'chapter-applications', version: 1, schemaVersion: 4, columns: CHAPTER_HEADERS.length });
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
    chapterVerifyHeaders_(sheet);
    chapterPrivateFolder_(config.folderId);
    const application = payload.application;
    const existing = chapterFindRow_(sheet, application.id, application.reference);
    const documentFiles = payload.documents.map(function (document) {
      return { category: document.category, file: chapterGetOrCreateCv_(config, application, document, document.bytes, document.id) };
    });
    const documentColumns = CHAPTER_DOCUMENT_CATEGORIES.map(function (category) {
      const item = documentFiles.find(function (item) { return item.category === category; });
      return item ? 'https://drive.google.com/file/d/' + item.file.id + '/view' : '';
    });
    if (existing) {
      const cvLink = String(sheet.getRange(existing, 9).getValue());
      const match = /^https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)\/view$/.exec(cvLink);
      chapterAssert_(match, 'EXISTING_CV_MISSING');
      const file = chapterDriveGet_(match[1]);
      chapterVerifyCv_(file, config.folderId, application, payload.resume);
      chapterPrivatePermissions_(file.id);
      const existingDocuments = sheet.getRange(existing, 23, 1, 5).getValues()[0];
      chapterAssert_(existingDocuments.every(function (value, index) { return value === documentColumns[index]; }), 'EXISTING_DOCUMENT_MISMATCH');
      chapterAssert_(sheet.getRange(existing, 28).getValue() === (application.driverLicenseDetails || '') &&
        sheet.getRange(existing, 29).getValue() === documentColumns[5], 'EXISTING_DOCUMENT_MISMATCH');
      return chapterJson_({ ok: true, applicationId: application.id,
        reference: application.reference, row: existing, duplicate: true, cvUrl: cvLink });
    }

    const file = chapterGetOrCreateCv_(config, application, payload.resume, payload.bytes);
    const row = chapterRow_(application, file).concat(documentColumns.slice(0, 5), [application.driverLicenseDetails || '', documentColumns[5], application.discoverySource || '']);
    // Use an explicit range: append's table detection can skip a hidden first column.
    // The script lock serializes writers and the ID/reference check makes retries safe.
    const rowNumber = sheet.getLastRow() + 1;
    if (rowNumber > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 100);
    const targetRange = chapterSheetRange_(config.sheetName, 'A' + rowNumber + ':AD' + rowNumber);
    const result = chapterGoogleJson_(
      'https://sheets.googleapis.com/v4/spreadsheets/' + config.sheetId + '/values/' +
      encodeURIComponent(targetRange) + '?valueInputOption=RAW',
      { method: 'put', contentType: 'application/json',
        payload: JSON.stringify({ majorDimension: 'ROWS', values: [row] }) }, 'SHEET_WRITE_FAILED'
    );
    const range = result.updatedRange;
    const rowMatch = typeof range === 'string' && /!A(\d+):AD(\d+)$/.exec(range);
    chapterAssert_(rowMatch && Number(rowMatch[1]) === rowNumber && Number(rowMatch[2]) === rowNumber &&
      result.updatedRows === 1 && result.updatedColumns === CHAPTER_HEADERS.length, 'SHEET_WRITE_UNCONFIRMED');
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
    chapterRemoveLegacyStatusColumns_(sheet);
    if (sheet.getMaxColumns() < CHAPTER_HEADERS.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), CHAPTER_HEADERS.length - sheet.getMaxColumns());
    if (sheet.getLastRow() > 0) {
      const current = sheet.getRange(1, 1, 1, CHAPTER_HEADERS.length).getValues()[0];
      chapterAssert_(current.every(function (value, index) { return value === CHAPTER_HEADERS[index] || index >= 22 && !value; }), 'HEADER_MISMATCH');
      sheet.getRange(1, 23, 1, CHAPTER_HEADERS.length - 22).setValues([CHAPTER_HEADERS.slice(22)]);
    }
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, CHAPTER_HEADERS.length).setValues([CHAPTER_HEADERS.slice()]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, CHAPTER_HEADERS.length).setFontWeight('bold');
      if (!sheet.getFilter()) sheet.getRange(1, 1, sheet.getMaxRows(), CHAPTER_HEADERS.length).createFilter();
    }
    chapterVerifyHeaders_(sheet);
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
    // No secret is logged or returned. CV links still require authorized Drive access.
    return { ok: true, sheetName: config.sheetName,
      cvFolderUrl: 'https://drive.google.com/drive/folders/' + config.folderId };
  } finally {
    lock.releaseLock();
  }
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
  const headers = sheet.getRange(1, 1, 1, CHAPTER_HEADERS.length).getValues()[0];
  chapterAssert_(headers.every(function (header, index) { return header === CHAPTER_HEADERS[index]; }), 'HEADER_MISMATCH');
  chapterAssert_(sheet.getLastColumn() <= CHAPTER_HEADERS.length, 'HEADER_MISMATCH');
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

function chapterValidatePayload_(payload) {
  chapterKeys_(payload, payload && payload.version === 2 ? ['version', 'application', 'resume', 'documents'] : ['version', 'application', 'resume']);
  chapterAssert_(payload.version === 1 || payload.version === 2, 'INVALID_VERSION');
  const application = payload.application;
  const applicationKeys = [
    'id', 'reference', 'submittedAt', 'jobTitle', 'jobId', 'status', 'fullName', 'email',
    'phone', 'country', 'recentJobTitle', 'experienceYears', 'skills', 'education', 'summary',
    'coverLetter', 'consent', 'nc2Certificate', 'documentReadiness', 'preferredEmployer',
    'expectedNc2', 'employers'
  ];
  if (application && Object.prototype.hasOwnProperty.call(application, 'driverLicenseDetails')) applicationKeys.push('driverLicenseDetails');
  if (application && Object.prototype.hasOwnProperty.call(application, 'discoverySource')) applicationKeys.push('discoverySource');
  chapterKeys_(application, applicationKeys);
  if (Object.prototype.hasOwnProperty.call(application, 'driverLicenseDetails')) chapterText_(application.driverLicenseDetails, 200, 0);
  if (Object.prototype.hasOwnProperty.call(application, 'discoverySource')) {
    chapterAssert_(application.discoverySource === '' || CHAPTER_DISCOVERY_SOURCES.indexOf(application.discoverySource) !== -1, 'INVALID_APPLICATION');
  }
  [ ['id', 100, 1], ['reference', 80, 1], ['jobId', 100, 1], ['jobTitle', 160, 2],
    ['fullName', 120, 2], ['email', 254, 3], ['phone', 30, 7], ['country', 80, 2],
    ['recentJobTitle', 160, 2], ['skills', 2000, 2], ['education', 2000, 0],
    ['summary', 4000, 0], ['coverLetter', 6000, 0], ['nc2Certificate', 200, 0],
    ['preferredEmployer', 160, 0], ['expectedNc2', 300, 0]
  ].forEach(function (rule) { chapterText_(application[rule[0]], rule[1], rule[2]); });
  chapterAssert_(/^[A-Za-z0-9_-]+$/.test(application.id) && /^[A-Za-z0-9_-]+$/.test(application.reference), 'INVALID_APPLICATION');
  chapterAssert_(typeof application.submittedAt === 'string' && application.submittedAt.length <= 35 &&
    /^\d{4}-\d{2}-\d{2}T/.test(application.submittedAt) && Number.isFinite(Date.parse(application.submittedAt)), 'INVALID_APPLICATION');
  chapterAssert_(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(application.email) && /^[+\d\s().-]+$/.test(application.phone) &&
    application.phone.replace(/\D/g, '').length >= 7, 'INVALID_APPLICATION');
  chapterAssert_(typeof application.experienceYears === 'number' && Number.isFinite(application.experienceYears) &&
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
  const documents = payload.version === 2 ? payload.documents : [];
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
  return { application: application, resume: resume, bytes: bytes, documents: validated };
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
    application.experienceYears, application.recentJobTitle, application.skills, application.nc2Certificate,
    application.expectedNc2, application.education, application.summary, application.coverLetter,
    application.employers.map(function (employer) { return employer.name + ': ' + employer.workers; }).join('; '), 'Yes'];
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
