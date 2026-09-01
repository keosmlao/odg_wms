import type { Metadata } from "next";
import { Geist_Mono, Montserrat, Noto_Sans_Lao } from "next/font/google";
import PWARegister from "@/components/PWARegister";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { DENSITY_INIT_SCRIPT } from "@/lib/density";
import "./globals.css";

// Brand typeface per the ODIEN Mall guideline (p.6). The Lao counterpart in the
// guideline is BoonHome, which is not on Google Fonts — until the licensed
// woff2 lands in public/fonts, Lao text falls back to Noto Sans Lao.
const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["200", "400", "500", "700", "900"],
  display: "swap",
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
    { media: "(prefers-color-scheme: light)", color: "#2c6fb6" },
    { media: "(prefers-color-scheme: dark)", color: "#003260" },
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
      className={`${montserrat.variable} ${geistMono.variable} ${notoSansLao.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      {/* ຕັ້ງ data-theme ກ່ອນ paint ຄັ້ງທຳອິດ — ບໍ່ດັ່ງນັ້ນຄົນທີ່ເລືອກໂໝດມືດ
          ຈະເຫັນຈໍຂາວແວັບໜຶ່ງທຸກເທື່ອທີ່ໂຫຼດໜ້າ. ຕ້ອງເປັນ script ທຳມະດາ
          ບໍ່ແມ່ນ next/script ເພາະຕ້ອງແລ່ນກ່ອນ hydration. */}
      <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      <script dangerouslySetInnerHTML={{ __html: DENSITY_INIT_SCRIPT }} />
      <body className="min-h-full flex flex-col overflow-x-hidden" suppressHydrationWarning>
        <PWARegister />
        {children}
      </body>
    </html>
  );
}
