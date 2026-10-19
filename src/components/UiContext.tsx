"use client";
import { createContext, useContext, useMemo, useState } from "react";

export type SidePanel = "" | "followups" | "reviews" | "results";
export type ToolPanel = "" | "resumes" | "sheet" | "pace";
interface Ui {
  side: SidePanel; setSide: (p: SidePanel) => void;
  tool: ToolPanel; setTool: (p: ToolPanel) => void;
  qp: boolean; setQp: (b: boolean) => void;
  vil: string | null; setVil: (sel: string | null) => void;   // null = closed, "" = open, "graphs" = open on a hunter
}
const Ctx = createContext<Ui | null>(null);
export function UiProvider({ children }: { children: React.ReactNode }) {
  const [side, setSide] = useState<SidePanel>("");
  const [tool, setTool] = useState<ToolPanel>("");
  const [qp, setQp] = useState(false);
  const [vil, setVil] = useState<string | null>(null);
  const v = useMemo(() => ({ side, setSide, tool, setTool, qp, setQp, vil, setVil }), [side, tool, qp, vil]);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}
export function useUi() {
  const u = useContext(Ctx);
  if (!u) throw new Error("useUi outside UiProvider");
  return u;
}
