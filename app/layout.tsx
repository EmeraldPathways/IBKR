import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IBKR Event Contract Workbench",
  description: "Private research, paper trading, risk controls and optional IBKR bridge control plane.",
  other: { "codex-preview": "development" },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
