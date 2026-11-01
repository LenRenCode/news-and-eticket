import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tiket Bus Samarinda - Penajam",
  description:
    "Demo pemesanan tiket bus untuk rute Samarinda–Penajam dan Penajam–Samarinda.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
      </head>
      <body>
        <nav className="nav-container no-print">
          <div className="nav-content">
            <Link href="/" className="nav-brand">
              <span style={{ fontSize: "24px" }}>🎟️</span>
              <span>BUS ANTAR KOTA</span>
            </Link>
            <div className="nav-links">
              <a href="/" className="nav-link-btn">
                Berita
              </a>
              <Link href="/" className="nav-link-btn">
                Pilih Jadwal
              </Link>
            </div>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
