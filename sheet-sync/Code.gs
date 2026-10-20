/**
 * Job Hunt Dashboard → Google Sheets bridge.
 *
 * Deploy this as a Web App bound to your application-tracker spreadsheet.
 * The dashboard POSTs one job per "✓ Applied" click; this writes a row into
 * your tracker, matching columns BY HEADER NAME:
 *   Last Update | Company | Job | Location | Status | Application
 *
 * - "Application" is where you applied (Company website, LinkedIn, Indeed…).
 * - The header row is found automatically (the first of the top 10 rows that
 *   has both "Company" and "Status").
 * - Optional columns are filled only if your sheet already has them:
 *   "URL" (or "Link"), "Job Type" and "LeetCode Prep". Nothing is added.
 * - New rows copy the formatting + dropdowns of the row above, so every
 *   column keeps its color and your Status chips keep working.
 * - GET …/exec?rows=1 returns the tracker rows (read-only) so the dashboard
 *   can show your response rates and follow-ups.
 *
 * Setup lives in sheet-sync/README.md. In short:
 *   Extensions → Apps Script → paste this → Deploy → Web app
 *   (Execute as: Me · Who has access: Anyone) → copy the /exec URL
 *   → paste it into the dashboard's ⚙ Sheet sync panel.
 *
 * Re-applying the same job updates its existing row instead of duplicating it
 * (matched by URL when the sheet has a URL column, else by Company + Job).
 */

// If your tracker isn't the first tab, put its exact name here (else leave "").
var SHEET_NAME = "";

// payload field → header text in the sheet (first alias found wins)
var COLUMNS = [
  { key: "date",     headers: ["Last Update", "Date"] },
  { key: "company",  headers: ["Company"] },
  { key: "title",    headers: ["Job", "Title", "Role"] },
  { key: "location", headers: ["Location"] },
  { key: "status",   headers: ["Status"] },
  { key: "application", headers: ["Application", "Source", "Applied via"] },
  { key: "url",      headers: ["URL", "Link", "Job Link"] },
  { key: "jobType",  headers: ["Job Type", "Type"] },
  { key: "prep",     headers: ["LeetCode Prep", "Prep"] },
];

function _sheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return SHEET_NAME ? ss.getSheetByName(SHEET_NAME) : ss.getSheets()[0];
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000); // serialize concurrent writes so rows never collide
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _sheet();

    var d = JSON.parse(e.postData.contents);
    d.date = d.date ||
      Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "yyyy-MM-dd");
    d.status = d.status || "Applied";

    var hdr = _headerMap(sheet);
    var values = sheet.getDataRange().getValues();
    var width = Math.max(sheet.getLastColumn(), 1);

    // De-dupe: if this job is already logged, update that row.
    var same = function (a, b) { return String(a).trim().toLowerCase() === String(b || "").trim().toLowerCase(); };
    var urlCol = hdr.cols.url, coCol = hdr.cols.company, tiCol = hdr.cols.title;
    for (var i = hdr.row + 1; i < values.length; i++) {
      var hit = (d.url && urlCol !== undefined) ? same(values[i][urlCol], d.url)
        : (coCol !== undefined && tiCol !== undefined && d.company && same(values[i][coCol], d.company) && same(values[i][tiCol], d.title));
      if (hit) {
        _set(sheet, i, hdr.cols.date, d.date);
        _set(sheet, i, hdr.cols.status, d.status);
        if (hdr.cols.application !== undefined && !values[i][hdr.cols.application]) _set(sheet, i, hdr.cols.application, d.application || "");
        return _json({ ok: true, updated: true });
      }
    }

    var row = [];
    for (var c = 0; c < width; c++) row.push("");
    COLUMNS.forEach(function (col) {
      var idx = hdr.cols[col.key];
      if (idx !== undefined) row[idx] = d[col.key] || "";
    });
    sheet.appendRow(row);
    _formatLikeRowAbove(sheet, sheet.getLastRow(), hdr, width);
    return _json({ ok: true, updated: false });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Find the header row (first of the top 10 rows containing "Company" and
 * "Status") and map each payload key to its 0-based column.
 */
function _headerMap(sheet) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var top = sheet.getRange(1, 1, Math.min(10, Math.max(sheet.getLastRow(), 1)), lastCol).getValues();
  var hRow = 0;
  for (var r = 0; r < top.length; r++) {
    var names = top[r].map(function (v) { return String(v).trim().toLowerCase(); });
    if (names.indexOf("company") !== -1 && names.indexOf("status") !== -1) { hRow = r; break; }
  }
  var headers = top[hRow].map(function (v) { return String(v).trim().toLowerCase(); });

  var cols = {};
  COLUMNS.forEach(function (col) {
    for (var a = 0; a < col.headers.length; a++) {
      var idx = headers.indexOf(col.headers[a].toLowerCase());
      if (idx !== -1) { cols[col.key] = idx; return; }
    }
  });
  return { row: hRow, cols: cols };
}

/** New row inherits the row above's formats + dropdowns (column colors, Status chips). */
function _formatLikeRowAbove(sheet, rowNum, hdr, width) {
  var above = rowNum - 1;
  if (above > hdr.row + 1) {
    var src = sheet.getRange(above, 1, 1, width), dst = sheet.getRange(rowNum, 1, 1, width);
    src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
  }
  if (hdr.cols.prep !== undefined) {
    sheet.getRange(rowNum, hdr.cols.prep + 1).setWrap(true).setVerticalAlignment("top");
  }
}

function _set(sheet, rowIdx, colIdx, value) {
  if (colIdx !== undefined) sheet.getRange(rowIdx + 1, colIdx + 1).setValue(value);
}

// GET /exec           → health check
// GET /exec?rows=1    → tracker rows as JSON (read-only; for the dashboard
//                        results panel and the morning digest)
function doGet(e) {
  if (!(e && e.parameter && e.parameter.rows)) {
    return _json({ ok: true, service: "job-hunt-sheet-sync", version: 4 });
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = _sheet();
  var hdr = _headerMap(sheet);
  var tz = ss.getSpreadsheetTimeZone();
  var values = sheet.getDataRange().getValues();
  var rows = [];
  for (var i = hdr.row + 1; i < values.length; i++) {
    var r = {};
    COLUMNS.forEach(function (col) {
      var idx = hdr.cols[col.key];
      if (idx === undefined) return;
      var v = values[i][idx];
      r[col.key] = v instanceof Date ? Utilities.formatDate(v, tz, "yyyy-MM-dd") : String(v).trim();
    });
    if (r.company || r.title) rows.push(r);
  }
  return _json({ ok: true, rows: rows });
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
