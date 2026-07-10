/**
 * Job Hunt Dashboard → Google Sheets bridge.
 *
 * Deploy this as a Web App bound to your application-tracker spreadsheet.
 * The dashboard POSTs one job per "✓ Applied" click; this appends a row
 * matching your columns:  Last Update | Company | Job | Location | Status | Application
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

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000); // serialize concurrent writes so rows never collide
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = SHEET_NAME ? ss.getSheetByName(SHEET_NAME) : ss.getSheets()[0];

    var d = JSON.parse(e.postData.contents);
    var date = d.date ||
      Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "MM/dd/yyyy");
    var row = [date, d.company || "", d.title || "", d.location || "",
               d.status || "Applied", d.url || ""];

    // De-dupe: if this Application URL is already logged, update that row.
    var updated = false;
    if (d.url) {
      var values = sheet.getDataRange().getValues();
      for (var i = 1; i < values.length; i++) {        // row 0 = headers
        if (String(values[i][5]).trim() === String(d.url).trim()) {
          sheet.getRange(i + 1, 1).setValue(date);      // Last Update
          sheet.getRange(i + 1, 5).setValue(row[4]);    // Status
          updated = true;
          break;
        }
      }
    }
    if (!updated) sheet.appendRow(row);

    return _json({ ok: true, updated: updated });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// Lets you open the /exec URL in a browser to confirm the deployment is live.
function doGet() {
  return _json({ ok: true, service: "job-hunt-sheet-sync" });
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
