import type { Metadata, Viewport } from "next";
import { Alegreya_Sans, Pixelify_Sans, Zilla_Slab } from "next/font/google";
import "./globals.css";

// The guild's type: a sturdy slab for headings, a warm humanist sans for reading, pixels for the game.
const slab = Zilla_Slab({ variable: "--font-slab", subsets: ["latin"], weight: ["500", "600", "700"] });
const sans = Alegreya_Sans({ variable: "--font-sans", subsets: ["latin"], weight: ["400", "500", "700"] });
const pixel = Pixelify_Sans({ variable: "--font-pixel", subsets: ["latin"], weight: ["400", "500", "600"] });

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
    { media: "(prefers-color-scheme: light)", color: "#F2E9D3" },
    { media: "(prefers-color-scheme: dark)", color: "#16130E" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${slab.variable} ${sans.variable} ${pixel.variable}`}>
      <body>{children}</body>
    </html>
  );
}
