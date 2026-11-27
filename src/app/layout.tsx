import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "REDSEC v7.0 — Secure Edition",
  description: "REDSEC v7.0 “Black Sea” — a fully secured desktop OS built on the REDSEC native kernel with pre-built anti-virus (Velikan 7.0), the v7.0 Black Sea security patch series, loader.efi 4.0 secure boot, 30+ built-in apps, app store, voice commands and more.",
  keywords: ["REDSEC", "Black Sea", "HTML OS", "browser desktop", "web OS", "anti-virus OS", "secure boot"],
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='46' stroke='%23f43f5e' stroke-width='4' fill='%2305070c'/%3E%3Cpath d='M50 12 L78 21 V46 C78 63 67 75 50 84 C33 75 22 63 22 46 V21 Z' fill='%23f43f5e'/%3E%3Cpath d='M37 48 l8 8 18 -20' stroke='%23fff1f2' stroke-width='6' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
