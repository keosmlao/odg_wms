import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Sans_Lao } from "next/font/google";
import PWARegister from "@/components/PWARegister";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const notoSansLao = Noto_Sans_Lao({
  variable: "--font-noto-lao",
  subsets: ["lao"],
  weight: ["300", "400", "500", "600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "ODG WMS",
  description: "ລະບົບຄຸ້ມຄອງຄັງສິນຄ້າ ODG",
  manifest: "/manifest.json",
  applicationName: "ODG WMS",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ODG WMS",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover" as const,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="lo"
      className={`${geistSans.variable} ${geistMono.variable} ${notoSansLao.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col overflow-x-hidden" suppressHydrationWarning>
        <PWARegister />
        {children}
      </body>
    </html>
  );
}
