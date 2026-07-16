import type { Metadata } from "next";
import { JetBrains_Mono, Inter } from "next/font/google";
import NextTopLoader from "nextjs-toploader";
import "./globals.css";

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const baseUrl = process.env.APP_URL || 'http://localhost:3000'

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: {
    default: 'OpenRenew — Stop getting surprised by vendor renewals',
    template: '%s — OpenRenew',
  },
  description: 'OpenRenew uses AI to extract key dates from contract PDFs and sends alerts at 60, 30, and 7 days before anything expires or auto-renews. Built for ops and finance teams.',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: [{ url: '/favicon-180x180.png', sizes: '180x180' }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${jetbrainsMono.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NextTopLoader color="#10B981" showSpinner={false} height={2} />
        {children}
      </body>
    </html>
  );
}
