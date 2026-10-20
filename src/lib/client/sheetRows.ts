"use client";
import { toast } from "./effects";
import { NS, isIgnoredSheetRow, type SheetRow } from "@/lib/game/progress";
import type { Store } from "@/lib/sync/store";

/** Read your tracker sheet (Code.gs GET ?rows=1) into this device's cache. */
export async function loadSheetRows(store: Store, force = false) {
  const url = store.get<string>(NS.pref, "sheetUrl");
  if (!url) { if (force) toast("Connect your sheet in Tools, Sheet sync first", true); return; }
  const cached = store.get<{ rows: SheetRow[]; at: number }>(NS.sheet, "rows");
  if (!force && cached && Date.now() - cached.at < 20 * 60_000) return;
  try {
    const res = await fetch(url + "?rows=1");
    const data = await res.json();
    if (!data.ok || !Array.isArray(data.rows)) throw new Error(data.error || "no rows");
    store.set(NS.sheet, "rows", { rows: data.rows, at: Date.now() });
    if (force) toast(`Loaded ${data.rows.filter((r: SheetRow) => !isIgnoredSheetRow(r)).length} rows from your sheet`);
  } catch {
    if (force) toast("Couldn't read the sheet. Redeploy the latest Code.gs (see sheet-sync/README).", true);
  }
}
