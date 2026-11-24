import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import InitColorSchemeScript from "@mui/material/InitColorSchemeScript";
import ThemeRegistry from "@/components/ThemeRegistry";
import { APPEARANCE_ATTRIBUTE, APPEARANCE_COOKIE, parseAppearance } from "@/lib/appearance";
import "./globals.css";
import { SITE_NAME } from '@/lib/site';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: SITE_NAME,
  description: "Assignments and timetable from task.yungu.org, on this Mac.",
};

// The appearance cookie is read here, above every page, so no route is prerendered as a static shell.
// Every page already rendered per request (each reads the session or a cookie, and was `instant =
// false`); only the `/` redirect and the 404 page were static, and they now render per request too.
export const instant = false;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The appearance choice comes with the request (reading a cookie is instant), so the first HTML is
  // already in the right scheme: Light or Dark on <html>; Automatic leaves it to MUI's init script,
  // which sets it from `prefers-color-scheme` before the body paints (MUI then follows it live).
  const appearance = parseAppearance((await cookies()).get(APPEARANCE_COOKIE)?.value);
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      {...{ [APPEARANCE_ATTRIBUTE]: appearance === 'auto' ? undefined : appearance }}
      // The init script (Automatic) and MUI set the attribute before React hydrates.
      suppressHydrationWarning
    >
      <body>
        {appearance === 'auto' && (
          // Storage keys MUI never writes (it keeps nothing in localStorage here): the script always
          // follows the system scheme, whatever an old visit may have stored under MUI's own keys.
          <InitColorSchemeScript
            attribute={APPEARANCE_ATTRIBUTE}
            defaultMode="system"
            modeStorageKey="yl-appearance-mode"
            colorSchemeStorageKey="yl-appearance-scheme"
          />
        )}
        <AppRouterCacheProvider>
          <ThemeRegistry appearance={appearance}>{children}</ThemeRegistry>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
