/**
 * Job Hunt Dashboard → Google Sheets bridge.
 *
 * Deploy this as a Web App bound to your application-tracker spreadsheet.
 * The dashboard POSTs one job per "✓ Applied" click; this writes a row into
 * your tracker, matching columns BY HEADER NAME:
 *   Last Update | Company | Job | Location | Status | Application | Job Type | LeetCode Prep
 *
 * - The header row is found automatically (your sheet's headers sit on row 3).
 * - "Job Type" and "LeetCode Prep" are added to the end of the header row the
 *   first time they're needed. Drag the columns anywhere afterwards — rows are
 *   matched by header text, not position.
 *
 * Setup lives in sheet-sync/README.md. In short:
 *   Extensions → Apps Script → paste this → Deploy → Web app
 *   (Execute as: Me · Who has access: Anyone) → copy the /exec URL
 *   → paste it into the dashboard's ⚙ Sheet sync panel.
 *
 * Re-applying the same job updates its existing row instead of duplicating it.
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
  { key: "url",      headers: ["Application", "URL", "Link"] },
  { key: "jobType",  headers: ["Job Type", "Type"],       create: "Job Type" },
  { key: "prep",     headers: ["LeetCode Prep", "Prep"],  create: "LeetCode Prep" },
];

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000); // serialize concurrent writes so rows never collide
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = SHEET_NAME ? ss.getSheetByName(SHEET_NAME) : ss.getSheets()[0];

    var d = JSON.parse(e.postData.contents);
    d.date = d.date ||
      Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "MM/dd/yyyy");
    d.status = d.status || "Applied";

    var hdr = _headerMap(sheet);
    var values = sheet.getDataRange().getValues();
    var width = Math.max(sheet.getLastColumn(), 1);

    // De-dupe: if this Application URL is already logged, update that row.
    var urlCol = hdr.cols.url;
    if (d.url && urlCol !== undefined) {
      for (var i = hdr.row + 1; i < values.length; i++) {
        if (String(values[i][urlCol]).trim() === String(d.url).trim()) {
          _set(sheet, i, hdr.cols.date, d.date);
          _set(sheet, i, hdr.cols.status, d.status);
          // fill the new columns on rows logged before they existed
          if (hdr.cols.jobType !== undefined && !values[i][hdr.cols.jobType]) _set(sheet, i, hdr.cols.jobType, d.jobType || "");
          if (hdr.cols.prep !== undefined && !values[i][hdr.cols.prep]) _set(sheet, i, hdr.cols.prep, d.prep || "");
          return _json({ ok: true, updated: true });
        }
      }
    }

    var row = [];
    for (var c = 0; c < width; c++) row.push("");
    COLUMNS.forEach(function (col) {
      var idx = hdr.cols[col.key];
      if (idx !== undefined) row[idx] = d[col.key] || "";
    });
    sheet.appendRow(row);
    return _json({ ok: true, updated: false });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Find the header row (first of the top 10 rows containing "Company" and
 * "Status"), map each payload key to its 0-based column, and append any
 * missing "create" columns to the end of that header row.
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
    if (col.create) {
      // first empty header cell after the last used one
      var at = headers.length;
      while (at > 0 && headers[at - 1] === "") at--;
      sheet.getRange(hRow + 1, at + 1).setValue(col.create);
      headers[at] = col.create.toLowerCase();
      cols[col.key] = at;
    }
  });
  return { row: hRow, cols: cols };
}

function _set(sheet, rowIdx, colIdx, value) {
  if (colIdx !== undefined) sheet.getRange(rowIdx + 1, colIdx + 1).setValue(value);
}

// Lets you open the /exec URL in a browser to confirm the deployment is live.
function doGet() {
  return _json({ ok: true, service: "job-hunt-sheet-sync", version: 2 });
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
