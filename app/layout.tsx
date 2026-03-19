import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Self-hosted via next/font — no external request, no layout shift, Vercel-optimised
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "HR Policy Assistant",
  description:
    "Ask questions about company HR policies. Get cited, accurate answers instantly.",
  robots: "noindex, nofollow",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`h-full ${inter.variable}`}>
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}
