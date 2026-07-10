# 📗 Google Sheets auto-fill — one-time setup (~5 min)

When you click **✓ Applied** on the dashboard, a row is added to your tracker
sheet automatically. This connects the two. You only do it once.

Your sheet's columns (already matched by the script):

| Last Update | Company | Job | Location | Status | Application |
|---|---|---|---|---|---|

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

## Notes

- **Keep the `/exec` URL private.** Anyone with it can add rows to your sheet
  (nothing worse — the script only appends job rows). Treat it like a password;
  don't commit it or share it.
- **Re-applying is safe.** If you mark the same job Applied again, the script
  updates its existing row (Last Update + Status) instead of adding a duplicate.
- **Change the Status later** (Interview / Rejected / Ghost) directly in the
  sheet — the dashboard never overwrites a row it didn't create, and only
  touches a row again if you re-click Applied on that exact job.
- **Editing the script later?** After any change to `Code.gs`, do
  **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**.
  The `/exec` URL stays the same, so you don't need to re-paste it.
- **Not the first tab?** If your tracker isn't the leftmost sheet tab, set
  `SHEET_NAME = "YourTabName"` at the top of `Code.gs` and redeploy.
