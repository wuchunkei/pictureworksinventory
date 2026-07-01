import SwiftUI
import UserNotifications
import LocalAuthentication
import Network

/// Thread-safe one-shot resolver for a TCP latency probe.
private final class PingBox: @unchecked Sendable {
    private let lock = NSLock()
    private var finished = false
    private let connection: NWConnection
    private let continuation: CheckedContinuation<Int?, Never>

    init(connection: NWConnection, continuation: CheckedContinuation<Int?, Never>) {
        self.connection = connection
        self.continuation = continuation
    }

    func finish(_ result: Int?) {
        lock.lock(); defer { lock.unlock() }
        if finished { return }
        finished = true
        connection.cancel()
        continuation.resume(returning: result)
    }
}

enum AuthPhase: Equatable {
    case checking
    case signedOut
    case signedIn
}

/// Data-connection status once signed in (the app shell shows immediately and
/// data loads in the background, WeChat-style).
enum ConnectionState: Equatable {
    case connecting   // no data yet, trying to reach a node
    case connected    // data loaded
    case lost         // 30s elapsed without a successful connection
}

enum ThemeOption: String, CaseIterable, Identifiable {
    case system
    case light
    case dark

    var id: String { rawValue }

    var title: String {
        switch self {
        case .system: return "Follow system"
        case .light: return "Light"
        case .dark: return "Dark"
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }
}

enum LanguageOption: String, CaseIterable, Identifiable {
    case english
    case chinese

    var id: String { rawValue }

    var title: String {
        switch self {
        case .english: return "English"
        case .chinese: return "中文"
        }
    }

    var localeIdentifier: String {
        switch self {
        case .english: return "en"
        case .chinese: return "zh-HK"
        }
    }
}

@MainActor
final class AppState: ObservableObject {
    @Published var phase: AuthPhase = .checking
    /// Data-connection status (drives the "Connecting…" / "Lost connection" UI).
    @Published var connectionState: ConnectionState = .connecting
    /// Banner tap opens the node picker as a sheet.
    @Published var showNodePickerSheet = false
    private var connectTask: Task<Void, Never>?
    @Published var currentUser: User?
    @Published var permissions: Permissions?
    @Published var companies: [Company] = []
    @Published var skus: [SKUItem] = []
    @Published var users: [User] = []
    @Published var records: [InventoryRecord] = []
    @Published var notifications: [NotificationItem] = []
    @Published var errorMessage: String?
    @Published var isRefreshing = false
    @Published var theme: ThemeOption {
        didSet {
            UserDefaults.standard.set(theme.rawValue, forKey: "theme")
        }
    }
    @Published var language: LanguageOption {
        didSet {
            UserDefaults.standard.set(language.rawValue, forKey: "language")
        }
    }
    @Published var notificationsEnabled: Bool {
        didSet {
            UserDefaults.standard.set(notificationsEnabled, forKey: "notificationsEnabled")
        }
    }
    @Published var userLogs: [UserLog] = []
    @Published var needsPasswordChange = false
    @Published var showBiometricEnrollment = false
    @Published var biometricEnabled: Bool {
        didSet { UserDefaults.standard.set(biometricEnabled, forKey: "biometricEnabled") }
    }
    @Published var appLockEnabled: Bool {
        didSet { UserDefaults.standard.set(appLockEnabled, forKey: "appLockEnabled") }
    }
    @Published var appLockDelay: AppLockDelay {
        didSet { UserDefaults.standard.set(appLockDelay.rawValue, forKey: "appLockDelay") }
    }
    @Published var appLocked = false
    var didJustLogout = false
    private var lastBackgroundedAt: Date?
    private var didGoToBackground = false
    private var ipLocationCache: [String: IPLocation] = [:]

    @Published var staffDirectory: StaffDirectory? {
        didSet {
            if let dir = staffDirectory,
               let data = try? JSONEncoder().encode(dir) {
                UserDefaults.standard.set(data, forKey: "staffDirectory")
            }
        }
    }

    let api = APIClient()

    // MARK: - Geolocation (logging, region gating)
    let geo = GeoManager()
    /// True when the user is in mainland China (by both IP and GPS) — only the
    /// China nodes may be selected.
    @Published var nodeRestricted = false
    /// Drives the "please enable location" nudge shown on each launch/foreground
    /// while permission isn't granted (sits above the app lock).
    @Published var showLocationNudge = false
    /// Ping-alert recipients (superadmin user IDs) — emailed when a node goes down/up.
    @Published var pingAlertRecipientIds: [String] = []

    /// Show the nudge whenever location isn't authorized.
    func refreshLocationNudge() { showLocationNudge = !geo.isAuthorized }

    // MARK: - Server node selection (bundled catalog + TCP latency)
    @Published var serverNodes: [ServerNodeInfo] = ServerNodeCatalog.nodes
    @Published var nodeLatencies: [String: Int?] = [:]
    @Published var selectedNodeLabel: String = ""
    @Published var isMeasuringNodes = false
    /// Whether the first-launch server-selection screen has been completed. Drives
    /// showing ServerSelectView before LoginView on first install.
    @Published var firstNodeChosen: Bool = UserDefaults.standard.bool(forKey: "firstNodeChosen") {
        didSet { UserDefaults.standard.set(firstNodeChosen, forKey: "firstNodeChosen") }
    }

    /// The China-routed nodes (China Mobile / CTExcel), the only ones selectable
    /// under the regional restriction.
    func isChinaNode(_ label: String) -> Bool {
        label.contains("CMLink") || label.contains("CTExcel")
    }

    /// Country/region grouping for the node picker. Derived from the node label.
    /// Order matters — used as the section order in the picker.
    static let nodeRegionOrder = ["China", "Hong Kong", "United States", "Other"]
    func nodeRegion(_ label: String) -> String {
        if isChinaNode(label) { return "China" }
        if label.contains("(HKG)") { return "Hong Kong" }
        if label.contains("(SJC)") { return "United States" }
        if label.contains("(Staging)") { return "Staging" }   // staging build
        return "Other"
    }

    /// Geofence removed — every node is always selectable regardless of location.
    func nodeSelectable(_ node: ServerNodeInfo) -> Bool { true }

    /// React to a geo update. The geofence is gone, so this only clears the
    /// "enable location" nudge once permission is granted; the coordinate keeps
    /// flowing into `X-Client-Geo` for per-operation logging.
    private func applyGeo() {
        nodeRestricted = false
        if geo.isAuthorized { showLocationNudge = false }
    }

    /// User manually pinned a (non-recommended) node — auto-select stops overriding it.
    var serverNodePinned: Bool {
        get { UserDefaults.standard.bool(forKey: "serverNodePinned") }
        set { UserDefaults.standard.set(newValue, forKey: "serverNodePinned") }
    }

    /// Lowest-latency reachable node = the recommendation.
    var recommendedNodeLabel: String? {
        nodeLatencies.compactMap { key, value -> (String, Int)? in
            value.map { (key, $0) }
        }.min { $0.1 < $1.1 }?.0
    }

    private func nodeLabel(forURL urlString: String) -> String {
        serverNodes.first { $0.url == urlString }?.label ?? serverNodes.first?.label ?? ""
    }

    /// User picked a node in a picker. Choosing the recommended (fastest) node
    /// returns to auto mode; choosing any other node pins to it.
    func selectServerNode(_ label: String) {
        guard let node = serverNodes.first(where: { $0.label == label }) else { return }
        // Regional protection: outside-China nodes can't be picked from mainland China.
        guard nodeSelectable(node) else { return }
        let newURL = node.url
        let changed = newURL != api.baseURL.absoluteString
        api.baseURL = URL(string: newURL) ?? api.baseURL
        selectedNodeLabel = label
        serverNodePinned = (label != recommendedNodeLabel)
        guard changed, phase == .signedIn else { return }
        // All nodes in a build share the same database, so the current token stays
        // valid — just reconnect on the new node with the Connecting…/Lost model.
        connectionState = .connecting
        beginConnecting()
    }

    /// First-launch picker: chose "Recommended" → auto-fastest every launch.
    func chooseRecommended() {
        serverNodePinned = false
        if let best = recommendedNodeLabel { selectServerNode(best) }
        firstNodeChosen = true
    }

    /// First-launch picker: pinned a specific node → fixed to it until changed.
    func chooseSpecificNode(_ label: String) {
        selectServerNode(label)
        firstNodeChosen = true
    }

    /// Per-node session cache — each node is an independent backend, so signing
    /// into one shouldn't force re-login when switching back to another you used.
    private func cachedSession(forNode url: String) -> (token: String, expiry: Date)? {
        guard let map = UserDefaults.standard.dictionary(forKey: "nodeSessions"),
              let entry = map[url] as? [String: Any],
              let token = entry["token"] as? String,
              let ts = entry["expiry"] as? Double else { return nil }
        let expiry = Date(timeIntervalSince1970: ts)
        return expiry > Date() ? (token, expiry) : nil
    }

    func cacheSession(token: String, expiry: Date, forNode url: String) {
        var map = UserDefaults.standard.dictionary(forKey: "nodeSessions") ?? [:]
        map[url] = ["token": token, "expiry": expiry.timeIntervalSince1970]
        UserDefaults.standard.set(map, forKey: "nodeSessions")
    }

    private func switchSession(toNode url: String) async {
        var candidates: [(String, Date)] = []
        if let t = api.token, let e = KeychainStore.readExpiresAt() { candidates.append((t, e)) }
        if let c = cachedSession(forNode: url) { candidates.append((c.token, c.expiry)) }
        for (token, expiry) in candidates {
            api.token = token
            do {
                try await refresh()
                KeychainStore.saveToken(token)
                KeychainStore.saveExpiresAt(expiry)
                cacheSession(token: token, expiry: expiry, forNode: url)
                return   // stayed signed in, no re-login needed
            } catch {
                continue
            }
        }
        // This node has no valid session — sign in here.
        api.token = nil
        currentUser = nil
        didJustLogout = true   // don't auto-trigger biometric against the new node
        errorMessage = "Please sign in on this server node."
        phase = .signedOut
    }

    /// Default to the recommended (fastest) node on every launch/login — UNLESS the
    /// user manually pinned a non-recommended node (that choice persists across
    /// launches). All nodes in a build share the database, so switching is safe and
    /// just triggers a reconnect.
    func autoSelectFastestNode() async {
        await measureNodeLatencies()
        if serverNodePinned {
            selectedNodeLabel = nodeLabel(forURL: api.baseURL.absoluteString)
            return
        }
        if let best = recommendedNodeLabel,
           let node = serverNodes.first(where: { $0.label == best }) {
            let switching = node.url != api.baseURL.absoluteString
            api.baseURL = URL(string: node.url) ?? api.baseURL
            selectedNodeLabel = best
            if switching && phase == .signedIn { beginConnecting() }
        } else {
            selectedNodeLabel = nodeLabel(forURL: api.baseURL.absoluteString)
        }
    }

    func measureNodeLatencies() async {
        guard !isMeasuringNodes else { return }
        isMeasuringNodes = true
        var results: [String: Int?] = [:]
        await withTaskGroup(of: (String, Int?).self) { group in
            for node in serverNodes {
                group.addTask { (node.label, await AppState.measureLatency(url: node.url)) }
            }
            for await (label, ms) in group { results[label] = ms }
        }
        nodeLatencies = results
        isMeasuringNodes = false
    }

    /// TCP connect time in ms to the URL's own host:port (443 https / 80 http),
    /// or nil on failure/timeout. Used as a lightweight latency probe.
    static func measureLatency(url: String) async -> Int? {
        guard let parsed = URL(string: url), let host = parsed.host else { return nil }
        let defaultPort: UInt16 = (parsed.scheme?.lowercased() == "http") ? 80 : 443
        let port = UInt16(parsed.port ?? Int(defaultPort)) ?? defaultPort
        return await withCheckedContinuation { (cont: CheckedContinuation<Int?, Never>) in
            let connection = NWConnection(
                host: NWEndpoint.Host(host),
                port: NWEndpoint.Port(rawValue: port)!,
                using: .tcp
            )
            let start = DispatchTime.now()
            let box = PingBox(connection: connection, continuation: cont)
            connection.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    let ns = DispatchTime.now().uptimeNanoseconds - start.uptimeNanoseconds
                    box.finish(Int(Double(ns) / 1_000_000.0))
                case .failed, .cancelled:
                    box.finish(nil)
                default:
                    break
                }
            }
            connection.start(queue: .global())
            DispatchQueue.global().asyncAfter(deadline: .now() + 5) { box.finish(nil) }
        }
    }

    var borrowedItems: [SKUItem] {
        guard let currentUser else { return [] }
        return skus.filter { $0.status == .borrowed && $0.borrowedByUserId == currentUser.id }
    }

    var repairingItems: [SKUItem] {
        guard let currentUser else { return [] }
        if currentUser.role == .superadmin || currentUser.role == .admin || currentUser.role == .warehouseManager {
            return skus.filter { $0.status == .repairing }
        }
        return skus.filter { $0.status == .repairing && $0.repairRequestedByUserId == currentUser.id }
    }

    var notificationBadgeCount: Int {
        guard let currentUser, canReceiveNotifications else { return 0 }
        return notifications.filter { notification in
            let receivedByMe = notification.recipientUserIds?.contains(currentUser.id) ?? false
            let submittedByMe = notification.senderUserId == currentUser.id
            return notification.isUnreadForBadge && receivedByMe && !submittedByMe
        }.count
    }

    var canReceiveNotifications: Bool {
        guard let role = currentUser?.role, role != .staff else { return false }
        return permissions?.canReceiveNotifications ?? true
    }

    var canRepairInventory: Bool {
        let role = currentUser?.role
        return permissions?.canRepairInventory ?? (role == .admin || role == .superadmin)
    }

    var canRequestDisposal: Bool {
        let role = currentUser?.role
        return permissions?.canRequestDisposal ?? (role == .warehouseManager || role == .admin || role == .superadmin)
    }

    var canReturnFromRepair: Bool {
        guard let role = currentUser?.role else { return false }
        return permissions?.canReturnFromRepair ?? role != .staff
    }

    init() {
        let storedTheme = UserDefaults.standard.string(forKey: "theme").flatMap(ThemeOption.init(rawValue:)) ?? .system
        self.theme = storedTheme
        let storedLanguage = UserDefaults.standard.string(forKey: "language").flatMap(LanguageOption.init(rawValue:)) ?? .english
        self.language = storedLanguage
        self.notificationsEnabled = UserDefaults.standard.object(forKey: "notificationsEnabled") as? Bool ?? false
        self.biometricEnabled = UserDefaults.standard.bool(forKey: "biometricEnabled")
        self.appLockEnabled = UserDefaults.standard.bool(forKey: "appLockEnabled")
        let storedDelay = UserDefaults.standard.string(forKey: "appLockDelay").flatMap(AppLockDelay.init(rawValue:)) ?? .immediately
        self.appLockDelay = storedDelay
        if let data = UserDefaults.standard.data(forKey: "staffDirectory"),
           let dir = try? JSONDecoder().decode(StaffDirectory.self, from: data) {
            self.staffDirectory = dir
        }
        self.selectedNodeLabel = serverNodes.first { $0.url == api.baseURL.absoluteString }?.label
            ?? serverNodes.first?.label ?? ""
        geo.bind(api: api)
        geo.onChange = { [weak self] in self?.applyGeo() }
        // Request the system location permission (OS dialog) and read a fresh fix.
        // If it isn't granted, show the persuasion nudge this launch.
        geo.start()
        refreshLocationNudge()
        // Restore the session FIRST (Face ID → show the app shell immediately).
        // Node latency probing must NOT block this — an offline node's 5s timeout
        // would otherwise delay the unlock screen every launch.
        Task { await restoreSession() }
        Task {
            // Background: measure node latencies (for the picker / logged-out fastest
            // pick) and run the region gate. Doesn't gate startup.
            await autoSelectFastestNode()
            await geo.refreshGate()
        }
    }

    var biometricLoginAvailable: Bool {
        guard biometricEnabled else { return false }
        let ctx = LAContext()
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil) else { return false }
        if let token = KeychainStore.readToken(), !token.isEmpty,
           let expiresAt = KeychainStore.readExpiresAt(), expiresAt > Date() {
            return true
        }
        if let biometricToken = KeychainStore.readBiometricToken(), !biometricToken.isEmpty {
            return true
        }
        return false
    }

    func restoreSession() async {
        if let token = KeychainStore.readToken() {
            if let expiresAt = KeychainStore.readExpiresAt(), expiresAt <= Date() {
                KeychainStore.deleteToken()
                KeychainStore.deleteExpiresAt()
                phase = .signedOut
                return
            }
            if biometricEnabled {
                let ctx = LAContext()
                if ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil) {
                    do {
                        try await ctx.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: "Verify your identity to continue")
                    } catch {
                        phase = .signedOut
                        return
                    }
                }
            }
            // Show the app shell immediately (the stored token is unexpired); load
            // data in the background with a Connecting…/Lost-connection indicator.
            api.token = token
            didGoToBackground = false
            phase = .signedIn
            beginConnecting()
        } else {
            phase = .signedOut
        }
    }

    /// Load data in the background and keep the connection status up to date.
    /// Retries every few seconds; after 30s of failure shows the "Lost connection"
    /// banner but keeps trying so it recovers automatically when a node is reachable.
    func beginConnecting() {
        connectTask?.cancel()
        connectionState = (companies.isEmpty && skus.isEmpty) ? .connecting : .connected
        let start = Date()
        connectTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                do {
                    try await self.refresh()   // sets connectionState = .connected on success
                    return
                } catch let err as APIClientError {
                    if case .missingToken = err {   // 401 — the session is invalid
                        self.signOutLocally()
                        return
                    }
                    if Date().timeIntervalSince(start) >= 30 { self.connectionState = .lost }
                } catch {
                    if Date().timeIntervalSince(start) >= 30 { self.connectionState = .lost }
                }
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            }
        }
    }

    private func signOutLocally() {
        connectTask?.cancel()
        KeychainStore.deleteToken()
        KeychainStore.deleteExpiresAt()
        api.token = nil
        currentUser = nil
        phase = .signedOut
    }

    var hasValidStoredSession: Bool {
        guard let token = KeychainStore.readToken(), !token.isEmpty else { return false }
        guard let expiresAt = KeychainStore.readExpiresAt(), expiresAt > Date() else { return false }
        return true
    }

    @discardableResult
    func loginWithBiometric() async -> Bool {
        let ctx = LAContext()
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil) else { return false }

        // Path 1: valid session token exists
        if let token = KeychainStore.readToken(), !token.isEmpty,
           let expiresAt = KeychainStore.readExpiresAt(), expiresAt > Date() {
            do {
                try await ctx.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: "Log in to Inventory")
                api.token = token
                try await refresh()
                didGoToBackground = false
                phase = .signedIn
                return true
            } catch {
                api.token = nil
                return false
            }
        }

        // Path 2: use long-lived biometric token (works after logout)
        guard let biometricToken = KeychainStore.readBiometricToken(), !biometricToken.isEmpty else { return false }
        do {
            try await ctx.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: "Log in to Inventory")
            let response = try await api.loginWithBiometricToken(biometricToken)
            api.token = response.token
            KeychainStore.saveToken(response.token)
            if !response.expiresAt.isEmpty {
                let formatter = ISO8601DateFormatter()
                formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                if let date = formatter.date(from: response.expiresAt) {
                    KeychainStore.saveExpiresAt(date)
                }
            }
            currentUser = response.currentUser
            try await refresh()
            didGoToBackground = false
            phase = .signedIn
            return true
        } catch {
            api.token = nil
            return false
        }
    }

    func login(username: String, password: String) async {
        await authenticate {
            try await api.login(username: username, password: password)
        }
    }

    func register(username: String, password: String, confirmPassword: String, phone: String, phoneCountryCode: String = "+86") async {
        await authenticate {
            try await api.register(username: username, password: password, confirmPassword: confirmPassword, phone: phone, phoneCountryCode: phoneCountryCode)
        }
    }

    func resetPassword(username: String, newPassword: String, confirmPassword: String, phone: String) async {
        await authenticate {
            try await api.resetPassword(username: username, newPassword: newPassword, confirmPassword: confirmPassword, phone: phone)
        }
    }

    func verifyIdentity(username: String, name: String, phone: String) async throws {
        try await api.verifyIdentity(username: username, name: name, phone: phone)
    }

    func updatePingAlerts(recipientUserIds: [String]) async throws {
        let result = try await api.updatePingAlerts(recipientUserIds: recipientUserIds)
        pingAlertRecipientIds = result.recipientUserIds ?? []
    }

    func refresh() async throws {
        isRefreshing = true
        defer { isRefreshing = false }
        let response = try await api.bootstrap()
        currentUser = response.currentUser
        permissions = response.permissions
        companies = response.warehouses
        skus = response.skus
        users = response.users ?? []
        records = response.records
        notifications = canReceiveNotifications ? response.notifications : []
        pingAlertRecipientIds = response.pingAlerts?.recipientUserIds ?? []
        errorMessage = nil
        connectionState = .connected
    }

    func lookupSKU(_ skuCode: String) async throws -> SKUItem {
        let item = try await api.scan(skuCode: skuCode)
        upsertSKU(item)
        return item
    }

    func runAction(_ action: SKUAction, skuCode: String) async throws -> SKUItem {
        let updated: SKUItem
        switch action {
        case .borrow:
            updated = try await api.borrow(skuCode: skuCode)
        case .returnItem:
            updated = try await api.returnItem(skuCode: skuCode)
        case .repair:
            updated = try await api.repair(skuCode: skuCode)
        case .repaired:
            updated = try await api.repaired(skuCode: skuCode)
        case .edit:
            throw APIClientError.server("Edit is handled separately.")
        }
        upsertSKU(updated)
        try? await refresh()
        return updated
    }

    func findBySerial(_ serial: String) -> SKUItem? {
        let query = serial.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return nil }
        return skus.first { ($0.serialNumber ?? "").lowercased().contains(query) }
    }

    func markNotificationRead(_ notification: NotificationItem) async {
        guard notification.status == "unread" else { return }
        do {
            let updated = try await api.markNotification(notification.id, status: "read")
            if let index = notifications.firstIndex(where: { $0.id == updated.id }) {
                notifications[index] = updated
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func logout() {
        let savedToken = api.token
        KeychainStore.deleteToken()
        KeychainStore.deleteExpiresAt()
        api.token = nil
        currentUser = nil
        permissions = nil
        companies = []
        skus = []
        users = []
        records = []
        notifications = []
        needsPasswordChange = false
        appLocked = false
        didGoToBackground = false
        didJustLogout = true
        phase = .signedOut
        guard let savedToken else { return }
        Task {
            // Before invalidating, try to get a biometric token for re-login after logout
            if biometricEnabled {
                api.token = savedToken
                if let result = try? await api.extendSession(biometric: true),
                   let biometricToken = result.biometricToken {
                    KeychainStore.saveBiometricToken(biometricToken)
                }
                api.token = nil
            }
            // Log out on server (invalidates session, records logout event)
            api.token = savedToken
            try? await api.logout()
            api.token = nil
        }
    }

    // MARK: Company CRUD

    func createCompany(name: String, code: String) async throws {
        let company = try await api.createCompany(name: name, code: code)
        companies.append(company)
    }

    func updateCompany(id: String, name: String, code: String) async throws {
        let updated = try await api.updateCompany(id: id, name: name, code: code)
        if let i = companies.firstIndex(where: { $0.id == id }) {
            companies[i] = updated
        }
    }

    func deleteCompany(id: String) async throws {
        try await api.deleteCompany(id: id)
        companies.removeAll { $0.id == id }
    }

    // MARK: Branch CRUD

    func addBranch(companyId: String, name: String, endorserUserId: String? = nil) async throws {
        let branch = try await api.addBranch(companyId: companyId, name: name, endorserUserId: endorserUserId)
        if let i = companies.firstIndex(where: { $0.id == companyId }) {
            companies[i].branches.append(branch)
        }
    }

    func updateBranch(companyId: String, parkId: String, name: String, endorserUserId: String? = nil) async throws {
        let updated = try await api.updateBranch(companyId: companyId, parkId: parkId, name: name, endorserUserId: endorserUserId)
        if let ci = companies.firstIndex(where: { $0.id == companyId }),
           let bi = companies[ci].branches.firstIndex(where: { $0.id == parkId }) {
            companies[ci].branches[bi] = updated
        }
    }

    func deleteBranch(companyId: String, parkId: String) async throws {
        try await api.deleteBranch(companyId: companyId, parkId: parkId)
        if let ci = companies.firstIndex(where: { $0.id == companyId }) {
            companies[ci].branches.removeAll { $0.id == parkId }
        }
    }

    // MARK: Location CRUD (child of branch)

    func addLocation(companyId: String, branchId: String, name: String) async throws {
        let location = try await api.addLocation(companyId: companyId, branchId: branchId, name: name)
        if let ci = companies.firstIndex(where: { $0.id == companyId }),
           let bi = companies[ci].branches.firstIndex(where: { $0.id == branchId }) {
            companies[ci].branches[bi].locations = (companies[ci].branches[bi].locations ?? []) + [location]
        }
    }

    func updateLocation(companyId: String, branchId: String, locationId: String, name: String) async throws {
        let updated = try await api.updateLocation(companyId: companyId, branchId: branchId, locationId: locationId, name: name)
        if let ci = companies.firstIndex(where: { $0.id == companyId }),
           let bi = companies[ci].branches.firstIndex(where: { $0.id == branchId }),
           let li = companies[ci].branches[bi].locations?.firstIndex(where: { $0.id == locationId }) {
            companies[ci].branches[bi].locations?[li] = updated
        }
    }

    func deleteLocation(companyId: String, branchId: String, locationId: String) async throws {
        try await api.deleteLocation(companyId: companyId, branchId: branchId, locationId: locationId)
        if let ci = companies.firstIndex(where: { $0.id == companyId }),
           let bi = companies[ci].branches.firstIndex(where: { $0.id == branchId }) {
            companies[ci].branches[bi].locations?.removeAll { $0.id == locationId }
        }
    }

    // MARK: Category CRUD

    func createCategory(companyId: String, code: String, branchIds: [String]) async throws {
        let category = try await api.createCategory(companyId: companyId, code: code, branchIds: branchIds)
        if let ci = companies.firstIndex(where: { $0.id == companyId }) {
            companies[ci].categories.append(category)
        }
    }

    func updateCategory(companyId: String, categoryId: String, code: String, branchIds: [String]) async throws {
        let updated = try await api.updateCategory(companyId: companyId, categoryId: categoryId, code: code, branchIds: branchIds)
        if let ci = companies.firstIndex(where: { $0.id == companyId }),
           let ki = companies[ci].categories.firstIndex(where: { $0.id == categoryId }) {
            companies[ci].categories[ki] = updated
        }
    }

    func deleteCategory(companyId: String, categoryId: String) async throws {
        try await api.deleteCategory(companyId: companyId, categoryId: categoryId)
        if let ci = companies.firstIndex(where: { $0.id == companyId }) {
            companies[ci].categories.removeAll { $0.id == categoryId }
        }
    }

    // MARK: User CRUD

    func createUser(username: String, name: String, password: String, role: String, phone: String?, phoneCountryCode: String?, email: String?, warehouseIds: [String], branchIds: [String]) async throws {
        let user = try await api.createUser(username: username, name: name, password: password, role: role, phone: phone, phoneCountryCode: phoneCountryCode, email: email, warehouseIds: warehouseIds, branchIds: branchIds)
        users.append(user)
    }

    func updateUser(id: String, name: String, role: String, phone: String?, phoneCountryCode: String?, email: String?, isDisabled: Bool, warehouseIds: [String], branchIds: [String]) async throws {
        let updated = try await api.updateUser(id: id, name: name, role: role, phone: phone, phoneCountryCode: phoneCountryCode, email: email, isDisabled: isDisabled, warehouseIds: warehouseIds, branchIds: branchIds)
        if let i = users.firstIndex(where: { $0.id == id }) {
            users[i] = updated
        }
    }

    func disableUser(id: String) async throws {
        let updated = try await api.disableUser(id: id)
        if let i = users.firstIndex(where: { $0.id == id }) {
            users[i] = updated
        }
    }

    func resumeUser(id: String) async throws {
        let updated = try await api.resumeUser(id: id)
        if let i = users.firstIndex(where: { $0.id == id }) {
            users[i] = updated
        }
    }

    func resetPasswordRequired(id: String) async throws {
        let updated = try await api.resetPasswordRequired(id: id)
        if let i = users.firstIndex(where: { $0.id == id }) {
            users[i] = updated
        }
    }

    func deleteUser(id: String) async throws {
        try await api.deleteUser(id: id)
        users.removeAll { $0.id == id }
    }

    // MARK: Inventory Actions

    func createSKU(warehouseId: String, branchId: String, categoryId: String, locationId: String?, skuNumber: String, descriptionId: String?, descriptionText: String?, serialNumber: String?) async throws -> SKUItem {
        let item = try await api.createSKU(warehouseId: warehouseId, branchId: branchId, categoryId: categoryId, locationId: locationId, skuNumber: skuNumber, descriptionId: descriptionId, descriptionText: descriptionText, serialNumber: serialNumber)
        upsertSKU(item)
        return item
    }

    func updateSKU(id: String, categoryId: String, branchId: String, locationId: String?, skuNumber: String?, descriptionId: String?, descriptionText: String?, serialNumber: String?) async throws -> SKUItem {
        let item = try await api.updateSKU(id: id, categoryId: categoryId, branchId: branchId, locationId: locationId, skuNumber: skuNumber, descriptionId: descriptionId, descriptionText: descriptionText, serialNumber: serialNumber)
        upsertSKU(item)
        return item
    }

    func requestRepair(skuCode: String, reason: String, destination: String) async throws -> SKUItem {
        let item = try await api.requestRepair(skuCode: skuCode, reason: reason, destination: destination)
        upsertSKU(item)
        try? await refresh()
        return item
    }

    func requestTransfer(skuCode: String, toBranchId: String, reason: String) async throws -> SKUItem {
        let item = try await api.requestTransfer(skuCode: skuCode, toBranchId: toBranchId, reason: reason)
        upsertSKU(item)
        try? await refresh()
        return item
    }

    func requestDisposal(skuCode: String, reason: String, netBookValue: String) async throws -> SKUItem {
        let item = try await api.requestDisposal(skuCode: skuCode, reason: reason, netBookValue: netBookValue)
        upsertSKU(item)
        try? await refresh()
        return item
    }

    func reviewNotification(_ id: String, approved: Bool, reviewNote: String?) async throws {
        let updated = try await api.reviewNotification(id, approved: approved, reviewNote: reviewNote)
        if let index = notifications.firstIndex(where: { $0.id == updated.id }) {
            notifications[index] = updated
        }
    }

    // MARK: Asset Check Forms

    func createAssetCheckForm(companyId: String, branchId: String, acfNo: String, signaturePng: String) async throws -> AssetCheckForm {
        let form = try await api.createAssetCheckForm(companyId: companyId, branchId: branchId, acfNo: acfNo, signaturePng: signaturePng)
        try? await refresh()   // pull the new notification for the endorser
        return form
    }

    func signAssetCheckForm(id: String, signaturePng: String) async throws {
        try await api.signAssetCheckForm(id: id, signaturePng: signaturePng)
        try? await refresh()
    }

    func denyAssetCheckForm(id: String, reason: String) async throws {
        try await api.denyAssetCheckForm(id: id, reason: reason)
        try? await refresh()
    }

    func withdrawAssetCheckForm(id: String) async throws {
        try await api.withdrawAssetCheckForm(id: id)
        try? await refresh()
    }

    func getAssetCheckForm(id: String) async throws -> AssetCheckForm {
        try await api.getAssetCheckForm(id: id)
    }

    func resubmitAssetCheckForm(id: String, companyId: String, branchId: String, acfNo: String, signaturePng: String) async throws {
        try await api.resubmitAssetCheckForm(id: id, companyId: companyId, branchId: branchId, acfNo: acfNo, signaturePng: signaturePng)
        try? await refresh()
    }

    func downloadAssetCheckForm(id: String) async throws -> (data: Data, filename: String) {
        try await api.downloadAssetCheckForm(id: id)
    }

    // MARK: User Logs

    func fetchUserLogs() async throws {
        let logs = try await api.fetchUserLogs()
        userLogs = logs
    }

    func cachedCountry(for ip: String) -> String? {
        ipLocationCache[ip]?.countryCode
    }

    func cachedLocation(for ip: String) -> IPLocation? {
        ipLocationCache[ip]
    }

    func resolveCountry(for ip: String) async {
        guard ipLocationCache[ip] == nil else { return }
        var cleanIp = ip
        if cleanIp.hasPrefix("::ffff:") { cleanIp = String(cleanIp.dropFirst(7)) }
        guard !cleanIp.isEmpty, cleanIp != "::1", !cleanIp.hasPrefix("127."),
              !cleanIp.hasPrefix("192.168."), !cleanIp.hasPrefix("10."),
              !cleanIp.hasPrefix("172.16."), !cleanIp.hasPrefix("100.64.") else { return }
        guard let url = URL(string: "https://ipinfo.io/\(cleanIp)/json") else { return }
        var request = URLRequest(url: url, timeoutInterval: 5)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200 else { return }
        struct IPInfoResponse: Decodable {
            var country: String?
            var city: String?
            var region: String?
        }
        guard let decoded = try? JSONDecoder().decode(IPInfoResponse.self, from: data),
              let cc = decoded.country, cc.count == 2, cc.allSatisfy(\.isLetter) else { return }
        objectWillChange.send()
        ipLocationCache[ip] = IPLocation(countryCode: cc, city: decoded.city, region: decoded.region)
    }

    var cacheSize: Int64 {
        var total = Int64(URLCache.shared.currentDiskUsage)
        if let data = UserDefaults.standard.data(forKey: "staffDirectory") {
            total += Int64(data.count)
        }
        if let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first {
            total += (try? directorySize(caches)) ?? 0
        }
        return total
    }

    func clearCache() {
        URLCache.shared.removeAllCachedResponses()
        ipLocationCache = [:]
        UserDefaults.standard.removeObject(forKey: "staffDirectory")
        staffDirectory = nil
        if let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first {
            try? FileManager.default.contentsOfDirectory(at: caches, includingPropertiesForKeys: nil)
                .forEach { try? FileManager.default.removeItem(at: $0) }
        }
    }

    private func directorySize(_ url: URL) throws -> Int64 {
        let contents = try FileManager.default.contentsOfDirectory(at: url, includingPropertiesForKeys: [.fileSizeKey, .isDirectoryKey])
        return try contents.reduce(0) { total, file in
            let values = try file.resourceValues(forKeys: [.fileSizeKey, .isDirectoryKey])
            if values.isDirectory == true {
                return total + (try directorySize(file))
            }
            return total + Int64(values.fileSize ?? 0)
        }
    }

    // MARK: Staff Directory Import

    /// Parse a staff file (XLSX/CSV) into entries WITHOUT saving — used to preview
    /// the import diff before the user confirms.
    func parseStaffEntries(from url: URL) async throws -> [StaffEntry] {
        let accessing = url.startAccessingSecurityScopedResource()
        defer { if accessing { url.stopAccessingSecurityScopedResource() } }
        let data = try Data(contentsOf: url)
        let ext = url.pathExtension.lowercased()
        if ext == "xlsx" || ext == "xls" {
            return try await api.parseStaffXLSX(base64: data.base64EncodedString())
        } else {
            let raw = String(data: data, encoding: .utf8)
                ?? String(data: data, encoding: .isoLatin1)
                ?? ""
            return parseCSV(raw)
        }
    }

    /// Replace the staff directory with the confirmed entries.
    func applyStaffDirectory(_ entries: [StaffEntry]) {
        staffDirectory = StaffDirectory(entries: entries, importedAt: Date())
    }

    /// Compare imported entries against the current directory (matched by name).
    func diffStaffImport(_ entries: [StaffEntry]) -> StaffImportDiff {
        let norm = { (s: String) in s.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
        let existing = Dictionary(staffDirectory?.entries.map { (norm($0.name), $0) } ?? [], uniquingKeysWith: { a, _ in a })
        var added: [StaffEntry] = [], updated: [StaffImportChange] = [], unchanged: [StaffEntry] = []
        for e in entries {
            if let old = existing[norm(e.name)] {
                let samePhone = (old.phone ?? "") == (e.phone ?? "")
                let sameEmail = (old.email ?? "") == (e.email ?? "")
                if samePhone && sameEmail { unchanged.append(e) }
                else { updated.append(StaffImportChange(old: old, new: e)) }
            } else {
                added.append(e)
            }
        }
        return StaffImportDiff(added: added, updated: updated, unchanged: unchanged, all: entries)
    }

    /// Matches a directory entry by display name (the new xlsx flow only has
    /// name/phone/email — the operator types the name and we fill the rest).
    func lookupStaffEntry(name: String) -> StaffEntry? {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !n.isEmpty else { return nil }
        return staffDirectory?.entries.first {
            $0.name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == n
        }
    }

    /// Best-matching directory entries for an autocomplete query (name or
    /// phone, works for both Chinese and English). Closest matches first.
    func staffSuggestions(for query: String, limit: Int = 6) -> [StaffEntry] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty, let entries = staffDirectory?.entries else { return [] }
        let matches = entries.filter {
            $0.name.lowercased().contains(q) || ($0.phone?.lowercased().contains(q) == true)
        }
        let sorted = matches.sorted { a, b in
            let an = a.name.lowercased(), bn = b.name.lowercased()
            let ap = an.hasPrefix(q), bp = bn.hasPrefix(q)
            if ap != bp { return ap }
            if an.count != bn.count { return an.count < bn.count }
            return an < bn
        }
        return Array(sorted.prefix(limit))
    }

    func lookupStaffEntry(employeeId: String) -> StaffEntry? {
        let id = employeeId.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !id.isEmpty else { return nil }
        return staffDirectory?.entries.first {
            $0.employeeId.lowercased() == id
        }
    }

    private func parseCSV(_ content: String) -> [StaffEntry] {
        let lines = content
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .init(charactersIn: "\r")) }
            .filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        guard lines.count > 1 else { return [] }
        var entries: [StaffEntry] = []
        for line in lines.dropFirst() {
            let fields = parseCSVRow(line)
            guard fields.count >= 2 else { continue }
            let eid  = fields[0].trimmingCharacters(in: .whitespacesAndNewlines)
            let name = fields[1].trimmingCharacters(in: .whitespacesAndNewlines)
            guard !eid.isEmpty, !name.isEmpty else { continue }
            let phone = fields.count > 2 ? fields[2].trimmingCharacters(in: .whitespacesAndNewlines) : nil
            let email = fields.count > 3 ? fields[3].trimmingCharacters(in: .whitespacesAndNewlines) : nil
            entries.append(StaffEntry(
                employeeId: eid,
                name: name,
                phone: phone?.isEmpty == true ? nil : phone,
                email: email?.isEmpty == true ? nil : email
            ))
        }
        return entries
    }

    private func parseCSVRow(_ line: String) -> [String] {
        var fields: [String] = []
        var current = ""
        var inQuotes = false
        for ch in line {
            switch ch {
            case "\"": inQuotes.toggle()
            case "," where !inQuotes:
                fields.append(current)
                current = ""
            default:
                current.append(ch)
            }
        }
        fields.append(current)
        return fields
    }

    func updateAPIBaseURL(_ value: String) {
        guard let url = URL(string: value.trimmingCharacters(in: .whitespacesAndNewlines)) else { return }
        api.baseURL = url
    }

    func requestNotificationPermission() async {
        do {
            let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
            notificationsEnabled = granted
            errorMessage = granted ? nil : "Notifications are disabled in system settings."
        } catch {
            notificationsEnabled = false
            errorMessage = error.localizedDescription
        }
    }

    func refreshNotificationPermissionState() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            notificationsEnabled = true
        case .notDetermined, .denied:
            notificationsEnabled = false
        @unknown default:
            notificationsEnabled = false
        }
    }

    private func authenticate(_ block: () async throws -> AuthResponse) async {
        do {
            let response = try await block()
            api.token = response.token
            KeychainStore.saveToken(response.token)
            if !response.expiresAt.isEmpty {
                let formatter = ISO8601DateFormatter()
                formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                if let date = formatter.date(from: response.expiresAt) {
                    KeychainStore.saveExpiresAt(date)
                    // Remember this node's session so switching back here later
                    // won't ask for the password again.
                    cacheSession(token: response.token, expiry: date, forNode: api.baseURL.absoluteString)
                }
            }
            currentUser = response.currentUser
            try await refresh()
            didGoToBackground = false
            didJustLogout = false
            phase = .signedIn
            errorMessage = nil
            if response.passwordExpired == true {
                needsPasswordChange = true
            } else if biometricCapable() && !UserDefaults.standard.bool(forKey: "biometricEnrollmentAsked") {
                showBiometricEnrollment = true
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func biometricCapable() -> Bool {
        let ctx = LAContext()
        return ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
    }

    var hasBiometricHardware: Bool {
        LAContext().biometryType != .none
    }

    var biometricLabel: String {
        LAContext().biometryType == .faceID ? "Face ID" : "Touch ID"
    }

    var biometricSystemImage: String {
        LAContext().biometryType == .faceID ? "faceid" : "touchid"
    }

    func enrollBiometric() async {
        showBiometricEnrollment = false
        let ctx = LAContext()
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil) else { return }
        do {
            let success = try await ctx.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: "Enable \(biometricLabel) for faster login")
            guard success else { return }
            let result = try await api.extendSession(biometric: true)
            KeychainStore.saveExpiresAt(result.expiresAt)
            if let biometricToken = result.biometricToken {
                KeychainStore.saveBiometricToken(biometricToken)
            }
            biometricEnabled = true
            UserDefaults.standard.set(true, forKey: "biometricEnrollmentAsked")
        } catch {}
    }

    func skipBiometricEnrollment() {
        UserDefaults.standard.set(true, forKey: "biometricEnrollmentAsked")
        showBiometricEnrollment = false
    }

    func extendSessionIfNeeded() async {
        guard biometricEnabled,
              let expiresAt = KeychainStore.readExpiresAt(),
              expiresAt.timeIntervalSinceNow < 3600,
              api.token != nil else { return }
        let ctx = LAContext()
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil) else { return }
        do {
            let success = try await ctx.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: "Verify your identity to continue")
            guard success else { return }
            let result = try await api.extendSession(biometric: true)
            KeychainStore.saveExpiresAt(result.expiresAt)
            if let biometricToken = result.biometricToken {
                KeychainStore.saveBiometricToken(biometricToken)
            }
        } catch {}
    }

    func appDidBackground() {
        lastBackgroundedAt = Date()
        didGoToBackground = true
        if appLockEnabled && phase == .signedIn && appLockDelay == .immediately {
            appLocked = true
        }
    }

    func appDidForeground() {
        // Read a fresh location on every foreground ("each use") and re-show the
        // nudge if permission still isn't granted.
        geo.readNow()
        refreshLocationNudge()
        // Refresh data / recover the connection when returning to the app.
        if phase == .signedIn { beginConnecting() }
        guard appLockEnabled, phase == .signedIn, didGoToBackground else { return }
        didGoToBackground = false
        guard appLockDelay != .immediately else { return }
        let elapsed = lastBackgroundedAt.map { Date().timeIntervalSince($0) } ?? 0
        if elapsed >= appLockDelay.seconds {
            appLocked = true
        }
    }

    func unlockApp() async {
        guard biometricEnabled else { appLocked = false; return }
        let ctx = LAContext()
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil) else { appLocked = false; return }
        do {
            try await ctx.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: "Unlock Inventory")
            appLocked = false
        } catch {}
    }

    func changePassword(currentPassword: String, newPassword: String, confirmPassword: String) async throws {
        try await api.changePassword(currentPassword: currentPassword, newPassword: newPassword, confirmPassword: confirmPassword)
        needsPasswordChange = false
    }

    private func upsertSKU(_ item: SKUItem) {
        if let index = skus.firstIndex(where: { $0.id == item.id }) {
            skus[index] = item
        } else {
            skus.insert(item, at: 0)
        }
    }
}

enum AppLockDelay: String, CaseIterable, Identifiable {
    case immediately
    case oneMinute = "1min"
    case fifteenMinutes = "15min"
    case oneHour = "1hr"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .immediately: return "Immediately"
        case .oneMinute: return "After 1 Minute"
        case .fifteenMinutes: return "After 15 Minutes"
        case .oneHour: return "After 1 Hour"
        }
    }

    var seconds: TimeInterval {
        switch self {
        case .immediately: return 0
        case .oneMinute: return 60
        case .fifteenMinutes: return 900
        case .oneHour: return 3600
        }
    }
}

enum SKUAction: String, CaseIterable, Identifiable {
    case borrow
    case returnItem
    case repair
    case repaired
    case edit

    var id: String { rawValue }

    var title: String {
        switch self {
        case .borrow: return "Borrow"
        case .returnItem: return "Return"
        case .repair: return "Repair"
        case .repaired: return "Repaired"
        case .edit: return "Edit"
        }
    }
}
