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
 *   first time they're needed, styled like your other headers and given their
 *   own column color (one your other columns don't use). Drag them anywhere
 *   afterwards — rows are matched by header text, not position.
 * - New rows copy the formatting + dropdowns of the row above, so every
 *   column keeps its color and your Status chips keep working.
 * - GET …/exec?rows=1 returns the tracker rows (read-only) so the dashboard
 *   can show your response rates and follow-ups.
 *
 * Setup lives in sheet-sync/README.md. In short:
 *   Extensions → Apps Script → paste this → Deploy → Web app
 *   (Execute as: Me · Who has access: Anyone) → copy the /exec URL
 *   → paste it into the dashboard's ⚙ Sheet sync panel.
 *   Optional: run formatNewColumns() once from the editor to add + color
 *   the two new columns right away.
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
  { key: "jobType",  headers: ["Job Type", "Type"],       create: "Job Type",      width: 110 },
  { key: "prep",     headers: ["LeetCode Prep", "Prep"],  create: "LeetCode Prep", width: 380, wrap: true },
];

// Google Sheets' built-in palette: [header ("light 2"), body ("light 3")]
var PALETTE = [
  ["#b4a7d6", "#d9d2e9"],  // purple
  ["#a2c4c9", "#d0e0e3"],  // cyan
  ["#f9cb9c", "#fce5cd"],  // orange
  ["#d5a6bd", "#ead1dc"],  // magenta
  ["#b6d7a8", "#d9ead3"],  // green
  ["#a4c2f4", "#c9daf8"],  // cornflower
  ["#ffe599", "#fff2cc"],  // yellow
  ["#9fc5e8", "#cfe2f3"],  // blue
  ["#ea9999", "#f4cccc"],  // red
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
      Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "MM/dd/yyyy");
    d.status = d.status || "Applied";

    var hdr = _headerMap(sheet, false);
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
 * "Status") and map each payload key to its 0-based column. Unless
 * readOnly, missing "create" columns are appended to the header row and
 * styled (see _styleNewColumn).
 */
function _headerMap(sheet, readOnly) {
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
    if (col.create && !readOnly) {
      // first empty header cell after the last used one
      var at = headers.length;
      while (at > 0 && headers[at - 1] === "") at--;
      sheet.getRange(hRow + 1, at + 1).setValue(col.create);
      headers[at] = col.create.toLowerCase();
      cols[col.key] = at;
      _styleNewColumn(sheet, hRow, at, col);
    }
  });
  return { row: hRow, cols: cols };
}

/**
 * Make a brand-new column look like it belongs: header formatting copied
 * from the header to its left, plus a column color your other columns don't
 * use. Matches your style — pale ("light 3") or deeper ("light 2") headers,
 * and tinted data cells only if your other columns have tinted data cells.
 */
function _styleNewColumn(sheet, hRow, colIdx, col) {
  var headerCell = sheet.getRange(hRow + 1, colIdx + 1);
  if (colIdx > 0) {
    sheet.getRange(hRow + 1, colIdx).copyTo(headerCell, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  }

  // Colors already in use (headers + first data row), lower-cased hex
  var used = {};
  var lastRow = sheet.getLastRow();
  var hdrBgs = colIdx > 0 ? sheet.getRange(hRow + 1, 1, 1, colIdx).getBackgrounds()[0] : [];
  var bodyBgs = (colIdx > 0 && lastRow > hRow + 1)
    ? sheet.getRange(hRow + 2, 1, 1, colIdx).getBackgrounds()[0] : [];
  hdrBgs.concat(bodyBgs).forEach(function (c) { used[String(c).toLowerCase()] = 1; });

  var isWhite = function (c) { c = String(c).toLowerCase(); return c === "#ffffff" || c === "white" || c === ""; };
  var coloredHeaders = hdrBgs.filter(function (c) { return !isWhite(c); });
  var tintedBody = bodyBgs.some(function (c) { return !isWhite(c); });
  // Pale headers already? then use the pale shade for the header too.
  var paleHeaders = coloredHeaders.length > 0 && coloredHeaders.every(function (c) { return _brightness(c) > 205; });

  var pick = PALETTE.filter(function (p) { return !used[p[0]] && !used[p[1]]; })[0] || PALETTE[colIdx % PALETTE.length];
  headerCell.setBackground(paleHeaders ? pick[1] : pick[0]);
  if (!coloredHeaders.length) headerCell.setBackground(pick[0]).setFontWeight("bold");

  if (lastRow > hRow + 1) {
    var body = sheet.getRange(hRow + 2, colIdx + 1, lastRow - hRow - 1, 1);
    if (colIdx > 0) {  // borders / fonts / alignment from the column to the left
      sheet.getRange(hRow + 2, colIdx, lastRow - hRow - 1, 1)
        .copyTo(body, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    }
    // pale headers → body a shade lighter still, like a header/body pair
    body.setBackground(tintedBody ? (paleHeaders ? _mixWhite(pick[1], 0.5) : pick[1]) : null);
    if (col.wrap) body.setWrap(true).setVerticalAlignment("top");
  }
  if (col.width) sheet.setColumnWidth(colIdx + 1, col.width);
}

function _mixWhite(hex, t) {
  var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex));
  if (!m) return hex;
  var mix = function (h) { var v = Math.round(parseInt(h, 16) + (255 - parseInt(h, 16)) * t); return ("0" + v.toString(16)).slice(-2); };
  return "#" + mix(m[1]) + mix(m[2]) + mix(m[3]);
}

function _brightness(hex) {
  var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex));
  if (!m) return 255;
  return (parseInt(m[1], 16) * 299 + parseInt(m[2], 16) * 587 + parseInt(m[3], 16) * 114) / 1000;
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

/**
 * Run once from the Apps Script editor (select it → ▶ Run) to add and color
 * "Job Type" + "LeetCode Prep" now, instead of waiting for the next sync.
 */
function formatNewColumns() {
  var sheet = _sheet();
  var hdr = _headerMap(sheet, false);
  Logger.log("Columns: " + JSON.stringify(hdr.cols));
}

// GET /exec           → health check
// GET /exec?rows=1    → tracker rows as JSON (read-only; for the dashboard
//                        results panel and the morning digest)
function doGet(e) {
  if (!(e && e.parameter && e.parameter.rows)) {
    return _json({ ok: true, service: "job-hunt-sheet-sync", version: 3 });
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = _sheet();
  var hdr = _headerMap(sheet, true);
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
