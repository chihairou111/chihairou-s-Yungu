import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import StyleProvider from "@/components/StyleProvider";
import { STYLE_COOKIE, parseStyle } from "@/lib/style";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Yungu", template: "%s · Yungu" },
  description: "Assignments and timetable from task.yungu.org.",
};

// The theme follows the `yl_style` cookie, so every page renders per request with the stored
// style already applied (no flash of the other style on reload).
export const instant = false;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const style = parseStyle((await cookies()).get(STYLE_COOKIE)?.value);
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <AppRouterCacheProvider>
          <StyleProvider initialStyle={style}>{children}</StyleProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
