import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Calibrate",
  description: "Find the edge in settled DreamDEX Event Contract windows, backtest it, run it live.",
};

const NAV = [
  { href: "/", label: "Map" },
  { href: "/backtest", label: "Backtest" },
  { href: "/deploy", label: "Deploy" },
  { href: "/export", label: "Export" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-6xl items-center gap-8 px-6 py-3">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              Calibrate
            </Link>
            <nav className="flex gap-1 text-sm">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="rounded-md px-3 py-1.5 text-muted hover:bg-accent-soft hover:text-ink">
                  {n.label}
                </Link>
              ))}
            </nav>
            <span className="ml-auto rounded-full bg-accent-soft px-2.5 py-0.5 font-mono text-xs text-accent">Somnia testnet</span>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
        <footer className="border-t border-line px-6 py-4 text-center text-xs text-muted">
          Data: DreamDEX indexer and the Somnia oracle price feed. Fills are estimated from prints; every statistic shows its sample size.
        </footer>
      </body>
    </html>
  );
}
