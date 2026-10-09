/**
 * The House Menu — Google Sheets + Drive backend.
 * Create an Apps Script project FROM your spreadsheet (Extensions > Apps Script).
 * Script Properties: APP_SECRET = a long random secret.
 * Deploy as Web App: Execute as Me; Access Anyone.
 * Note: URL + secret grant write access; do not publish the secret in a public repo.
 */
const RECIPES_TAB = 'Recipes';
const HEADERS = ['id', 'title', 'category', 'method', 'tags', 'sections', 'checked', 'photoUrl', 'photoFileId', 'version', 'updatedAt'];
const PHOTO_FOLDER = 'House Menu Photos';

function setupCookbook() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(RECIPES_TAB);
  if (!sheet) sheet = ss.insertSheet(RECIPES_TAB);
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sheet.setFrozenRows(1);
  getPhotoFolder_();
}

function doGet(e) {
  const params = e.parameter || {};
  const callback = params.callback || '';
  let result;
  try {
    authorize_(params.secret);
    if (params.action !== 'list') throw new Error('Unknown action');
    result = { ok: true, recipes: getRecipes_() };
  } catch (error) {
    result = { ok: false, error: String(error.message || error) };
  }
  const json = JSON.stringify(result);
  // JSONP callback must be a valid JavaScript identifier, not arbitrary code.
  if (callback && /^[$A-Z_a-z][$\w]*$/.test(callback)) {
    return ContentService.createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let result;
  const lock = LockService.getScriptLock();
  try {
    const data = JSON.parse(e.postData.contents);
    authorize_(data.secret);
    lock.waitLock(25000);
    try {
      if (data.action === 'save') saveRecipe_(data);
      else if (data.action === 'delete') deleteRecipe_(data.id);
      else if (data.action === 'check') checkRecipe_(data.id, data.checked);
      else throw new Error('Unknown action');
    } finally {
      lock.releaseLock();
    }
    result = { ok: true };
  } catch (error) {
    result = { ok: false, error: String(error.message || error) };
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function authorize_(secret) {
  const expected = PropertiesService.getScriptProperties().getProperty('APP_SECRET');
  if (!expected || !secret || secret !== expected) throw new Error('Unauthorized');
}

function getSheet_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RECIPES_TAB);
  if (!sheet) throw new Error('Run setupCookbook first');
  return sheet;
}

function getRecipes_() {
  const values = getSheet_().getDataRange().getValues();
  return values.slice(1).filter(row => row[0]).map(row => ({
    id: String(row[0]),
    title: String(row[1] || ''),
    category: String(row[2] || 'Mains'),
    method: String(row[3] || ''),
    tags: String(row[4] || ''),
    sections: parseJson_(row[5], []),
    checked: parseJson_(row[6], {}),
    photoUrl: String(row[7] || ''),
    version: String(row[9] || '')
  }));
}

function parseJson_(value, fallback) {
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function findRow_(id) {
  const sheet = getSheet_();
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  const index = ids.findIndex(row => String(row[0]) === String(id));
  return index < 0 ? 0 : index + 2;
}

function getPhotoFolder_() {
  const props = PropertiesService.getScriptProperties();
  const savedId = props.getProperty('PHOTO_FOLDER_ID');
  if (savedId) return DriveApp.getFolderById(savedId);
  const folder = DriveApp.createFolder(PHOTO_FOLDER);
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

function saveRecipe_(data) {
  const recipe = data.recipe || {};
  if (!recipe.id || !recipe.title || !Array.isArray(recipe.sections) || !recipe.sections.length) {
    throw new Error('Invalid recipe');
  }
  const sheet = getSheet_();
  const rowIndex = findRow_(recipe.id);
  const previous = rowIndex ? sheet.getRange(rowIndex, 1, 1, HEADERS.length).getValues()[0] : null;
  let photoUrl = previous ? String(previous[7] || '') : '';
  let photoFileId = previous ? String(previous[8] || '') : '';

  if (data.photoData) {
    const match = /^data:image\/jpeg;base64,(.+)$/.exec(data.photoData);
    if (!match) throw new Error('Photo must be JPEG');
    const bytes = Utilities.base64Decode(match[1]);
    if (bytes.length > 4 * 1024 * 1024) throw new Error('Photo is too large');
    const blob = Utilities.newBlob(bytes, 'image/jpeg', recipe.id + '.jpg');
    const file = getPhotoFolder_().createFile(blob);
    // Browser-readable photo URL requires link access; don't use for sensitive photos.
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    photoUrl = 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1200';
    if (photoFileId) {
      try { DriveApp.getFileById(photoFileId).setTrashed(true); } catch (_) {}
    }
    photoFileId = file.getId();
  }

  const row = [
    String(recipe.id), String(recipe.title), String(recipe.category || 'Mains'),
    String(recipe.method || ''), String(recipe.tags || ''),
    JSON.stringify(recipe.sections), JSON.stringify(recipe.checked || {}),
    photoUrl, photoFileId, String(data.version || Date.now()), new Date()
  ];
  if (rowIndex) sheet.getRange(rowIndex, 1, 1, HEADERS.length).setValues([row]);
  else sheet.appendRow(row);
}

function checkRecipe_(id, checked) {
  const row = findRow_(id);
  if (!row) throw new Error('Recipe not found');
  getSheet_().getRange(row, 7).setValue(JSON.stringify(checked || {}));
}

function deleteRecipe_(id) {
  const row = findRow_(id);
  if (!row) return;
  const sheet = getSheet_();
  const fileId = sheet.getRange(row, 9).getValue();
  sheet.deleteRow(row);
  if (fileId) {
    try { DriveApp.getFileById(fileId).setTrashed(true); } catch (_) {}
  }
}
