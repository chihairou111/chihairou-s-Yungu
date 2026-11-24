# chihairou's Yungu (local) — desktop shell

Electron around the frontend's standalone Next server (`frontend/.next/standalone`, built by
`cd frontend && npm run build`). The main process starts the server in a `utilityProcess` on a free
`127.0.0.1` port with `DATA_SOURCE=direct`, locks it with a per-launch secret cookie (`yl_local`), signs
in with the saved credentials (`credentials.bin` in the user-data folder, encrypted by the OS keychain
through `safeStorage`; kept in memory only where no keychain is available), then opens the app.

```sh
npm install
npm run build            # tsc → dist/, plus dist/splash.html
npx electron .           # Linux without a display: xvfb-run -a npx electron . --no-sandbox
npm test                 # unit tests (Vitest)
xvfb-run -a npx playwright test   # smoke spec: the built shell on the mock data source
```

Development-only overrides (ignored once packaged): `YUNGU_LOCAL_DATA_SOURCE=mock` runs the server on
the mock data source; `YUNGU_LOCAL_USER_DATA=<dir>` uses another user-data folder;
`YUNGU_LOCAL_SIGN_IN_DELAY_MS=<ms>` delays the startup sign-in (a slow Yungu, for the splash check);
`YUNGU_LOCAL_STARTUP_UNREACHABLE=<n>` (mock only) stands in for saved credentials and a Yungu that cannot
be reached at the first `n` startup sign-in tries, then signs in; `YUNGU_LOCAL_SIGN_IN_RETRY_MS=<ms>`
shortens the retry's 10 s interval (both for the retry check).

**Startup sign-in retry** (`src/sign-in-retry.ts`): when the startup sign-in cannot reach Yungu (the Mac
opened the app before its Wi-Fi connected), the sign-in page opens with the notice `yl_signin_notice=
unreachable` ("Can't reach Yungu right now — trying again.") and the sign-in is tried again every 10 s and
on `powerMonitor` resume / unlock-screen, never while suspended (also how a startup skipped because the app
started suspended is made up once the suspension ends). It opens Assignments once it gets through, and
stops once the user signs in by hand, the window leaves the sign-in page, or on a Restart. A Keychain that
refuses to save or forget the credentials is logged (the error's class name) and the launch carries on.

**Redirects** (`will-redirect`, `redirectTarget` in `src/navigation.ts`): a window's main frame never
follows a redirect off the app. A file link (`/api/files/<id>`) redirects to a signed address on Yungu's
file storage; that is downloaded instead (`downloadURL`: the Save dialog and the suspension gate), any
other address goes to the browser (or nowhere), and a window opened only for the redirect ("Open in new
tab") closes again.

## Yungu's fetch: Node's, not `net.fetch`

The server calls Yungu through `globalThis.__yunguFetch ?? fetch`. The plan was for `src/server.ts` to
install Electron's `net.fetch` (Chromium's network stack: system proxy settings and certificate store).
A check on Electron 45.4.1, in a utility process, found:

- `redirect: 'manual'` does not return the 3xx: the promise rejects with `Redirect was cancelled`
  (with or without `credentials: 'omit'`). The direct sign-in needs the real 3xx, its `Location` and
  its `Set-Cookie`.
- A hand-set `Cookie` header is sent only while Chromium's own cookie jar has nothing for the host;
  once a response has set cookies, Chromium replaces the hand-set header with its jar's cookies.
  `credentials: 'omit'` is accepted and stops that (the hand-set header is then sent as given).

So `__yunguFetch` is left unset and the server uses Node's own `fetch`. Proxies and custom
certificates on the user's network are therefore not picked up from the system.

## Appearance

The gear's Appearance (Automatic, Light, Dark) is saved in `settings.json` (`appearance`: `auto` | `light` |
`dark`) through `window.yunguLocal.setAppearance` (`yungu-local:set-appearance`, main window's app page
only, the value checked). The main process sets `nativeTheme.themeSource` (`system` for Automatic), which
also drives every page's `prefers-color-scheme`: the splash and start-error page (`src/splash.html`) and
Automatic in the app follow it. The window's `backgroundColor` is the app's surface for the scheme in use
(`#f9f9ff` / `#111318`, `src/appearance.ts`), set at creation and on every `nativeTheme` update, so no
white shows before a page paints. Each boot writes the frontend's `yl_appearance` cookie from the setting,
so the first page is rendered in the same scheme. (The smoke spec launches with `colorScheme: null`:
Playwright otherwise emulates a light `prefers-color-scheme`.)

## Suspension Mode

A switch in the Settings gear's menu (under Appearance), off by default, with a list of allowed Wi-Fi
names ("Allowed networks…"; for now it opens the Allowed Wi-Fi dialog). While it is on and the Mac is on a Wi-Fi whose name is not in the list, or whose name
cannot be read, nothing is sent to Yungu: the window shows the Suspension Mode screen (its one button
turns the switch off), and it goes by itself on an allowed Wi-Fi or off Wi-Fi. No Wi-Fi is never
suspended. Names compare exactly (trimmed; case counts). Settings: `settings.json` in the user-data folder.

- `src/wifi.ts` runs the Wi-Fi helper (2 s limit); `src/suspension.ts` decides and polls; `src/settings.ts`
  keeps the switch and the list. The Wi-Fi is read **only while the switch is on** (every 3 s, and at
  start, `powerMonitor` resume / unlock-screen — Electron has no network-change event), plus one reading
  when the Allowed Wi-Fi dialog opens (for "Add current Wi-Fi"). So nobody is asked for Location access
  before using Suspension Mode. Switching on is suspended ("Can't tell which Wi-Fi this is.") until the
  first fresh reading lands; a reading from before is never reused. Likewise going to sleep or locking
  (`powerMonitor` suspend / lock-screen) and waking or unlocking drop the last reading first, so the app is
  suspended ("unknown") until the Wi-Fi it woke up on has been read: a re-login cannot send the password
  on a Wi-Fi that is not allowed.
- The server process (`src/server.ts`) installs `globalThis.__yunguFetch`, through which every Yungu and
  OSS request of the server goes: while suspended it refuses new requests and aborts those on their way
  (`src/fetch-gate.ts`). The frontend reports the refusal as "Can't reach Yungu right now. Try again."
- The window's session cancels every request that leaves the app (`webRequest.onBeforeRequest`) and
  downloads from outside; the app's own `127.0.0.1` server is never blocked.
- `src/preload.ts` (the main window only) gives the page `window.yunguLocal`; the hosted web app has none
  and shows nothing of this.
- Started while suspended, the saved sign-in waits until the suspension ends (the sign-in page shows
  the screen meanwhile).

**The Wi-Fi helper** (`native/wifi-ssid.swift`, CoreWLAN + CoreLocation) prints one line: `SSID:<name>`,
`NONE` or `UNKNOWN`. macOS 14.4+ hides the name without Location access, which the helper asks for on its
first run. A bare command-line tool may never get that prompt, so `native/wifi-ssid-Info.plist` (bundle id
`dev.chihairou.yungu.local.wifi-ssid`, name, the same usage strings) is linked into the binary's
`__TEXT,__info_plist` section. It can only be built on a Mac: `npm run build:wifi-helper`
(→ `build/bin/wifi-ssid`); `dist:mac`
runs it first and electron-builder ships it as `resources/bin/wifi-ssid` (`build.extraResources`), with
`NSLocationWhenInUseUsageDescription` / `NSLocationUsageDescription` in the app's Info.plist
(`build.mac.extendInfo`). In development, `YUNGU_WIFI_HELPER=<script>` replaces it (ignored once packaged);
the smoke spec `e2e/suspension.spec.ts` uses a shell script whose output it changes. Without a helper the
reading is "unknown", which only matters with the switch on.

To check on the Mac: the helper builds; turning the switch on (or opening Allowed Wi-Fi) shows a Location
prompt, and which name it shows (the app's or the helper's); after allowing, readings are `SSID:<name>`.
