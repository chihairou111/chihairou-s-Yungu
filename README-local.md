# chihairou's Yungu (local)

A Mac app that shows your Yungu (task.yungu.org) in its own window. It runs on your Mac and talks only
to Yungu. Nothing goes to any other server, and nobody else sees your data.

## Build it at home (Apple Silicon Mac)

You need Node.js (and git; `xcode-select --install` gives you git if you don't have it).

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
  can still sign in by hand meanwhile. With Suspension Mode on, it waits until the network is allowed.
- **After you rebuild the app** (`npm run dist:mac`): the build is unsigned, so macOS may ask again whether
  it may use the saved password in your keychain. Choose **Always Allow** (enter your Mac password if
  asked). If you choose Deny, the app asks for your Yungu password once more.

## Permissions

- **Camera and microphone**: only when an assignment asks to photograph or record something.

That's all: Suspension Mode needs no permission (it never asks for Location).

## Suspension Mode

For when you don't want the app talking to Yungu (for example, on a network you don't trust).

1. Connect to a network that is fine (school, home). Open the **Settings** gear and choose
   **Allowed networks...**, type a **Label** for it (say, "School") and press **Add current network**.
   Do this once on each network you want to allow.
2. Switch **Suspension Mode** on (also in the gear).

The app recognises a network by its router, not by the Wi-Fi's name, so a network can only be added
while you're on it. While Suspension Mode is on, on any other network (or one whose router can't be
read), nothing is sent to Yungu and the window shows the Suspension Mode screen. It lifts by itself on an
allowed network or with Wi-Fi off. "No Wi-Fi" also covers Ethernet or iPhone (USB) tethering with Wi-Fi
off, and a Wi-Fi with only IPv6: none of these are suspended. The button on the screen turns the switch off. It is off by default.
To take a network off the list, press **Remove <label>** in **Allowed networks...**.

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
