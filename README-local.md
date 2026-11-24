# chihairou's Yungu (local)

A Mac app that shows your Yungu (task.yungu.org) in its own window. It runs on your Mac and talks only
to Yungu. Nothing goes to any other server, and nobody else sees your data.

## Build it at home (Apple Silicon Mac)

You need Node.js and the Xcode Command Line Tools (the Wi-Fi helper for Suspension Mode is compiled with
`swiftc`; install them with `xcode-select --install`).

```sh
git clone <this repo>
cd <this repo>
git switch local
cd desktop
npm run setup        # installs the frontend and the desktop shell
npm run dist:mac     # builds everything; the .dmg ends up in desktop/release/
```

Open `desktop/release/*.dmg` and drag the app into Applications.

## First open

The app is not signed by Apple, so macOS stops it the first time:

- Right-click the app, choose **Open**, then **Open** again; or
- open **System Settings > Privacy & Security**, scroll down, and press **Open Anyway**.

You only do this once.

## Sign in

The first time, it asks for your student ID and password. They are saved on this Mac, encrypted with the
Mac's keychain, and the app signs in by itself after that. **Sign out** (account menu) forgets the password.

- **Opened before the Wi-Fi connects** (or while Yungu is down): the sign-in page says "Can't reach Yungu
  right now — trying again." and the app keeps trying by itself (every 10 seconds, and when the Mac wakes
  or unlocks). It opens Assignments by itself once it gets through; you don't need to type anything. You
  can still sign in by hand meanwhile. With Suspension Mode on, it waits until the Wi-Fi is allowed.
- **After you rebuild the app** (`npm run dist:mac`): the build is unsigned, so macOS may ask again whether
  it may use the saved password in your keychain. Choose **Always Allow** (enter your Mac password if
  asked). If you choose Deny, the app asks for your Yungu password once more.

## Permissions

- **Camera and microphone**: only when an assignment asks to photograph or record something.
- **Location**: only when you switch on Suspension Mode or open **Allowed Wi-Fi...** (that dialog reads the
  current Wi-Fi once). macOS needs it before an app may read the Wi-Fi name. The location is never stored
  or sent.

## Suspension Mode

For when you don't want the app talking to Yungu (for example, on a Wi-Fi you don't trust).

1. Open the account (avatar) menu and choose **Allowed Wi-Fi...**. Add the Wi-Fi names that are fine
   (**Add current Wi-Fi** adds the one you're on).
2. Switch **Suspension Mode** on.

While it is on, on any Wi-Fi not in the list (or one whose name can't be read), nothing is sent to Yungu
and the window shows the Suspension Mode screen. It lifts by itself on an allowed Wi-Fi or with no Wi-Fi.
The button on the screen turns the switch off. It is off by default.

## Where your data lives

`~/Library/Application Support/chihairou's Yungu (local)` : the saved sign-in, window size and Suspension
Mode settings, and the record of which files you've handed in (`hand-in.json`). Delete the folder to start
fresh.

## Handing in

This app keeps its own record of which files you handed in; it does not import the record from the hosted
version. So the first time you open an assignment that already has an open draft, the files in it right
now are treated as handed in. Sign out does not clear this record.

## Updating

```sh
git pull
cd desktop
npm run setup
npm run dist:mac
```

Then replace the app in Applications with the new one. Your data folder is kept.
