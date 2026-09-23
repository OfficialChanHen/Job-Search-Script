# 📗 Google Sheets auto-fill — one-time setup (~5 min)

When you click **✓ Applied** on the dashboard, a row is added to your tracker
sheet automatically. This connects the two. You only do it once.

Columns written (matched **by header name**, so order doesn't matter):

| Last Update | Company | Job | Location | Status | Application | Job Type | LeetCode Prep |
|---|---|---|---|---|---|---|---|

**Job Type** (Full-time / Contract / Part-time / Temporary) and **LeetCode Prep**
(interview focus, then one `• #N Problem` bullet per line) are added to the end
of your header row automatically the first time a job is synced — or right away
if you run `formatNewColumns` once (see below). Drag them wherever you like
afterwards.

**Colors:** each new column gets its own color from Google Sheets' palette —
one none of your existing columns use — styled like your other headers (pale or
deeper shade to match), with tinted data cells if your other columns have them.
Every synced row copies the formatting and dropdowns of the row above it, so
column colors and your Status chips carry down. LeetCode Prep cells wrap.

**Read access:** the dashboard's 📈 Results and 📬 Follow-ups (and the optional
morning digest) read your rows back through the same `/exec` URL
(`…/exec?rows=1`, read-only).

**Not connected, or want to add a job without marking it Applied?** Click
**📋 Copy row** on any job, click the first empty cell in column A of your
sheet, and paste — the values land in the columns above, in order.
**⬇ Export tracked** downloads every Applied/Saved job as a CSV in the same
column order (File → Import → Append to current sheet).

---

## Steps

1. **Open your tracker sheet** →
   [Applications sheet](https://docs.google.com/spreadsheets/d/1IV-ZBhVWQJbmDRk23a17zjiFmBgA1E1cqIsSR2uMDPo/edit)

2. Menu: **Extensions → Apps Script**. A code editor opens in a new tab.

3. Delete whatever is in `Code.gs`, then **paste the entire contents of
   [`Code.gs`](Code.gs)** from this folder. Click 💾 **Save**.

4. Click **Deploy → New deployment**.
   - Click the ⚙ gear → **Web app**.
   - **Description:** anything (e.g. "Job dashboard sync").
   - **Execute as:** `Me`.
   - **Who has access:** `Anyone`.
   - Click **Deploy**.

5. Google asks you to **authorize**. Click through:
   *Review permissions → pick your account → Advanced →
   "Go to (project name) (unsafe)" → Allow.*
   (It says "unsafe" for every personal script — it's your own code editing
   your own sheet. Safe.)

6. Copy the **Web app URL** it shows you. It ends in **`/exec`** and looks like:
   `https://script.google.com/macros/s/AKfy…long…/exec`

7. On the **dashboard**, click **⚙ Sheet sync** → paste the URL →
   **Save & test**. A test row appears in your sheet within a second or two —
   delete that row, and you're done.

---

## Already set this up before? (update to version 3)

1. Paste the new `Code.gs` over the old one and 💾 Save.
2. **Optional — color the new columns now:** pick `formatNewColumns` in the
   function dropdown next to ▶ Run, click **Run** (authorize if asked).
   "Job Type" and "LeetCode Prep" appear at the end of your header row, colored.
3. **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**.
   The `/exec` URL stays the same. Opening the URL in a browser should now show
   `"version":3`.

## Notes

- **Keep the `/exec` URL private.** Anyone with it can add rows to your sheet
  and read your tracker rows (company, job, status). Treat it like a password;
  don't commit it or share it — as a GitHub secret (`SHEET_EXEC_URL`) it stays private.
- **Re-applying is safe.** If you mark the same job Applied again, the script
  updates its existing row (Last Update + Status, and fills Job Type / LeetCode
  Prep if blank) instead of adding a duplicate.
- **Change the Status later** (Interview / Rejected / Ghost) directly in the
  sheet — the dashboard never overwrites a row it didn't create, and only
  touches a row again if you re-click Applied on that exact job.
- **Not the first tab?** If your tracker isn't the leftmost sheet tab, set
  `SHEET_NAME = "YourTabName"` at the top of `Code.gs` and redeploy.
