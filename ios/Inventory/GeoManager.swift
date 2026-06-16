import Foundation
import CoreLocation

/// Reads the user's location so each operation can be logged with where it
/// happened. (The old region/geofence gate has been removed — node selection is
/// never restricted by location anymore; we only capture the coordinate.)
///
/// We request the system location permission directly (no custom pre-prompt) —
/// the OS dialog itself is where the user allows or denies. The Info.plist usage
/// description explains why. If the user hasn't granted it, AppState shows a
/// persuasion nudge on each launch; if they deny outright, GPS is simply
/// unavailable and no `X-Client-Geo` is attached.
///
/// Once a fix exists it is attached to every API call as `X-Client-Geo` so the
/// backend can log the latitude/longitude where each operation happened.
@MainActor
final class GeoManager: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published private(set) var coordinate: CLLocationCoordinate2D?
    @Published private(set) var ipCountry: String?
    /// Retained for API compatibility with AppState; always false now that the
    /// geofence is removed.
    @Published private(set) var restricted = false
    @Published private(set) var status: CLAuthorizationStatus

    /// Invoked on the main actor whenever `restricted`/`coordinate` changes so the
    /// owner (AppState) can re-evaluate node selection.
    var onChange: (() -> Void)?

    private let manager = CLLocationManager()
    private weak var api: APIClient?

    /// Location is usable (the user granted permission).
    var isAuthorized: Bool { status == .authorizedWhenInUse || status == .authorizedAlways }
    /// The user hasn't decided yet — a request will show the OS dialog.
    var isUndetermined: Bool { status == .notDetermined }

    override init() {
        status = CLLocationManager().authorizationStatus
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyKilometer
        status = manager.authorizationStatus
    }

    func bind(api: APIClient) { self.api = api }

    /// Request permission if undecided (shows the OS dialog), and read a fresh
    /// fix when authorized. Call on launch and on every foreground ("each use").
    func start() {
        if manager.authorizationStatus == .notDetermined {
            manager.requestWhenInUseAuthorization()
        } else if isAuthorized {
            manager.requestLocation()
        }
    }

    /// One-shot location read (used on foreground). No-ops without permission.
    func readNow() {
        if isAuthorized { manager.requestLocation() }
    }

    private func updateHeader() {
        guard let c = coordinate else { return }
        api?.clientGeoHeader = String(format: "%.5f,%.5f", c.latitude, c.longitude)
    }

    /// Pull the IP country from the backend (kept for informational logging only;
    /// it no longer gates node selection).
    func refreshGate() async {
        guard let api else { return }
        if let geo = try? await api.fetchGeo() { ipCountry = geo.country }
        recompute()
    }

    private func recompute() {
        // Geofence removed: node choice is never restricted by location. The
        // coordinate is still captured (see updateHeader) purely so the backend
        // can log where each operation happened.
        restricted = false
        onChange?()
    }

    // MARK: CLLocationManagerDelegate
    // The manager is created on the main actor, so its callbacks arrive on the
    // main run loop; `assumeIsolated` lets us touch main-actor state safely while
    // satisfying Swift 6 concurrency checking.

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let coordinate = locations.last?.coordinate else { return }
        MainActor.assumeIsolated {
            self.coordinate = coordinate
            updateHeader()
            recompute()
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let newStatus = manager.authorizationStatus
        MainActor.assumeIsolated {
            self.status = newStatus
            if isAuthorized { self.manager.requestLocation() }
            onChange?()
        }
    }
}
