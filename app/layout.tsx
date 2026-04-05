import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenClaw — Signal Dashboard",
  description: "N8N signal ingestion dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-claw-bg font-mono antialiased">
        {children}
      </body>
    </html>
  );
}
