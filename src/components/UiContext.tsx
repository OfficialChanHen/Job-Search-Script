"use client";
import { createContext, useContext, useMemo, useState } from "react";

/** One drawer at a time holds everything that isn't the job list or the game. */
export type Drawer = "" | "tools" | "followups" | "reviews" | "results" | "badges" | "sheet" | "resumes" | "pace" | "account";
export type MobileTab = "jobs" | "village";
interface Ui {
  drawer: Drawer; setDrawer: (d: Drawer) => void;
  qp: boolean; setQp: (b: boolean) => void;
  vil: string | null; setVil: (sel: string | null) => void;   // null = closed, "" = open, "<topic>" = open on a hunter
  tab: MobileTab; setTab: (t: MobileTab) => void;
}
const Ctx = createContext<Ui | null>(null);
export function UiProvider({ children }: { children: React.ReactNode }) {
  const [drawer, setDrawer] = useState<Drawer>("");
  const [qp, setQp] = useState(false);
  const [vil, setVil] = useState<string | null>(null);
  const [tab, setTab] = useState<MobileTab>("jobs");
  const v = useMemo(() => ({ drawer, setDrawer, qp, setQp, vil, setVil, tab, setTab }), [drawer, qp, vil, tab]);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}
export function useUi() {
  const u = useContext(Ctx);
  if (!u) throw new Error("useUi outside UiProvider");
  return u;
}
