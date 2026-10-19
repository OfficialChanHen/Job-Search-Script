"use client";
import dynamic from "next/dynamic";

// Progress lives in this browser (and syncs to your account), so the app only renders on the client.
const App = dynamic(() => import("./App"), {
  ssr: false,
  loading: () => <div className="wrap"><div className="empty">Loading your job hunt…</div></div>,
});
export default function ClientApp() { return <App />; }
