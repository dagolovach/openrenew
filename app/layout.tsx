import type { Metadata } from "next";
import { JetBrains_Mono, Inter } from "next/font/google";
import NextTopLoader from "nextjs-toploader";
import PostHogProvider from "@/components/PostHogProvider";
import PostHogPageView from "@/components/PostHogPageView";
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
  keywords: [
    'contract renewal tracker',
    'vendor contract alerts',
    'SaaS renewal tracker',
    'contract expiry alerts',
    'contract management',
    'vendor renewal reminders',
    'auto-renewal tracker',
    'contract deadline alerts',
  ],
  authors: [{ name: 'OpenRenew', url: baseUrl }],
  creator: 'OpenRenew',
  publisher: 'OpenRenew',
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: baseUrl,
    siteName: 'OpenRenew',
    title: 'OpenRenew — Stop getting surprised by vendor renewals',
    description: 'AI-powered contract renewal tracking for ops and finance teams. Upload once, get alerts before anything expires.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'OpenRenew — Stop getting surprised by vendor renewals',
    description: 'AI-powered contract renewal tracking for ops and finance teams.',
    creator: '@openrenew',
  },
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: [{ url: '/favicon-180x180.png', sizes: '180x180' }],
  },
  alternates: {
    canonical: baseUrl,
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
        <PostHogProvider>
          {children}
          <PostHogPageView />
        </PostHogProvider>
      </body>
    </html>
  );
}
