import type { Metadata, Viewport } from "next";
import { Instrument_Sans, Lora } from "next/font/google";
import "./globals.css";

// The display serif (headlines, one italic accent word) and the grotesk for everything else, as on Hourelle.
const lora = Lora({ variable: "--font-lora", subsets: ["latin"], style: ["normal", "italic"] });
const sans = Instrument_Sans({ variable: "--font-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Job hunt",
  description: "Entry-level SWE and tech roles, with a little village that only real work can feed.",
  appleWebApp: { capable: true, title: "Job hunt", statusBarStyle: "default" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FAF6EF" },
    { media: "(prefers-color-scheme: dark)", color: "#171512" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${lora.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
