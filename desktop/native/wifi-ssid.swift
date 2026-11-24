// wifi-ssid: prints the name of the Wi-Fi network this Mac is on, for Suspension Mode.
//
// Output: exactly one line on stdout, then exit 0:
//   SSID:<name>  joined to a Wi-Fi network whose name could be read
//   NONE         no Wi-Fi interface, Wi-Fi turned off, or not joined to any network
//   UNKNOWN      joined to a network, but its name cannot be read (Location access refused or not given yet)
//
// Since macOS 14.4 CoreWLAN hides the SSID unless the app has Location access. On the first run (status
// "not determined") this asks for when-in-use authorization and waits briefly on the run loop for the
// answer. The app only runs it while Suspension Mode is on (or its Allowed Wi-Fi dialog opens). Which
// name the prompt shows (the app's or this helper's) is to be checked on the Mac. Until the user
// answers, the name stays hidden and the answer is UNKNOWN; the app asks again every few seconds.
//
// A bare command-line tool may never be offered the Location prompt, so its own Info.plist
// (`wifi-ssid-Info.plist`: bundle id, name and the same usage strings as the app) is linked into the
// binary's __TEXT,__info_plist section.
//
// Built on the Mac only (`npm run build:wifi-helper` in desktop/):
//   swiftc -O native/wifi-ssid.swift -o build/bin/wifi-ssid -framework CoreWLAN -framework CoreLocation \
//     -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker native/wifi-ssid-Info.plist

import CoreLocation
import CoreWLAN
import Foundation

func answer(_ line: String) -> Never {
    FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
    exit(0)
}

final class LocationAuthorization: NSObject, CLLocationManagerDelegate {
    let manager = CLLocationManager()
    private(set) var decided = false

    override init() {
        super.init()
        manager.delegate = self
        decided = manager.authorizationStatus != .notDetermined
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus != .notDetermined { decided = true }
    }

    /// Asks once if nobody has answered yet, and waits up to `seconds` for the answer.
    func requestIfNeeded(waiting seconds: TimeInterval) {
        guard !decided else { return }
        manager.requestWhenInUseAuthorization()
        let deadline = Date().addingTimeInterval(seconds)
        while !decided && Date() < deadline {
            _ = RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.1))
        }
    }
}

// The app gives the helper 2 s in all; the wait stays well inside that.
let authorization = LocationAuthorization()
authorization.requestIfNeeded(waiting: 1.2)

guard let wifi = CWWiFiClient.shared().interface() else { answer("NONE") }
guard wifi.powerOn() else { answer("NONE") }

if let ssid = wifi.ssid(), !ssid.isEmpty {
    answer("SSID:\(ssid)")
}

// No name: either not joined to any network, or joined with the name hidden (no Location access).
// Without Location access CoreWLAN still reports the link itself: an interface mode other than none,
// a channel, a signal level or a transmit rate all mean the Mac is joined to something.
let joined = wifi.interfaceMode() != .none
    || wifi.wlanChannel() != nil
    || wifi.rssiValue() != 0
    || wifi.transmitRate() > 0
answer(joined ? "UNKNOWN" : "NONE")
