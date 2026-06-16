import Foundation

struct ServerNodeInfo: Codable, Identifiable {
    let label: String
    let url: String
    var id: String { label }
}

/// The list of backend routes is *client configuration*, not server state, so it
/// ships inside the app bundle (one set per build flavor) instead of the database.
/// This keeps staging and production strictly separated and lets the login screen
/// pick a node before any network call. Edit these lists when routes change.
enum ServerNodeCatalog {
    static let nodes: [ServerNodeInfo] = {
        #if STAGING
        return [
            ServerNodeInfo(label: "Cloudflare(Staging)", url: "https://inventory-staging-cloudflare.wuchunkei.com/api"),
            ServerNodeInfo(label: "CTExcel(Staging)", url: "https://inventory-staging-ctexcel.wuchunkei.com:5173/api"),
            ServerNodeInfo(label: "CMLink(Staging)", url: "https://inventory-staging-cmlink.wuchunkei.com:5173/api")
        ]
        #else
        // Production routes.
        return [
            ServerNodeInfo(label: "Cloudflare(HKG)", url: "https://inventory-cloudflare.wuchunkei.com/api"),
            ServerNodeInfo(label: "Tailscale(HKG)", url: "https://hkx86-production.longhair-mizar.ts.net/api"),
            ServerNodeInfo(label: "Ngrok(HKG)", url: "https://arguable-olive-anew.ngrok-free.dev/api"),
            ServerNodeInfo(label: "Cloudflare(SJC)", url: "https://sanjose.wuchunkei.com/api"),
            ServerNodeInfo(label: "Oracle(SJC)", url: "https://sjc.wuchunkei.com:5173/api"),
            ServerNodeInfo(label: "CTExcel", url: "https://inventory-ctexcel.wuchunkei.com:55173/api"),
            ServerNodeInfo(label: "CMLink", url: "https://inventory-cmlink.wuchunkei.com:55173/api")
        ]
        #endif
    }()

    /// The first node is the safe default (used when no valid cached node exists).
    static var defaultURL: String { nodes.first?.url ?? "https://inventory.wuchunkei.com/api" }

    static func contains(_ urlString: String) -> Bool {
        nodes.contains { $0.url == urlString }
    }
}

enum APIClientError: LocalizedError {
    case invalidURL
    case missingToken
    case server(String)
    case transport(String)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "The API URL is invalid."
        case .missingToken:
            return "Please log in again."
        case .server(let message), .transport(let message):
            return message
        }
    }
}

struct GeoResponse: Codable {
    let country: String?
    let lat: Double?
    let lng: Double?
    let ip: String?
}

@MainActor
final class APIClient {
    var token: String?
    /// "<lat>,<lng>" attached as `X-Client-Geo` to every request once the user
    /// has consented and a fix is available. The backend logs it on each call.
    var clientGeoHeader: String?
    var baseURL: URL {
        didSet {
            UserDefaults.standard.set(baseURL.absoluteString, forKey: "apiBaseURL")
        }
    }

    private let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: config)
    }()

    init(baseURL: URL = APIClient.defaultBaseURL()) {
        self.baseURL = baseURL
    }

    static func defaultBaseURL() -> URL {
        // Honor a cached node only if it is one of THIS build's bundled nodes.
        // That lets the user stay on whichever node they picked (e.g. CTExcel)
        // while still rejecting a stale URL from another environment — so a
        // staging build can never accidentally talk to a production route.
        if let stored = UserDefaults.standard.string(forKey: "apiBaseURL"),
           ServerNodeCatalog.contains(stored),
           let url = URL(string: stored) {
            return url
        }
        return URL(string: ServerNodeCatalog.defaultURL)!
    }

    func loginStart(username: String) async throws -> LoginStartResponse {
        try await send("login-start", method: "POST", body: ["username": username], requiresAuth: false)
    }

    func login(username: String, password: String) async throws -> AuthResponse {
        try await send("login", method: "POST", body: ["username": username, "password": password], requiresAuth: false)
    }

    func register(username: String, password: String, confirmPassword: String, phone: String, phoneCountryCode: String = "+86") async throws -> AuthResponse {
        try await send(
            "register",
            method: "POST",
            body: ["username": username, "password": password, "confirmPassword": confirmPassword, "phone": phone, "phoneCountryCode": phoneCountryCode],
            requiresAuth: false
        )
    }

    func forgotPassword(username: String) async throws {
        try await sendVoid("forgot-password", method: "POST", body: ["username": username], requiresAuth: false)
    }

    func verifyIdentity(username: String, name: String, phone: String) async throws {
        try await sendVoid("verify-identity", method: "POST", body: ["username": username, "name": name, "phone": phone], requiresAuth: false)
    }

    func resetPassword(username: String, newPassword: String, confirmPassword: String, phone: String) async throws -> AuthResponse {
        try await send(
            "reset-password",
            method: "POST",
            body: ["username": username, "newPassword": newPassword, "confirmPassword": confirmPassword, "phone": phone],
            requiresAuth: false
        )
    }

    func logout() async throws {
        try await sendVoid("logout", method: "POST")
    }

    struct ExtendSessionResult {
        let expiresAt: Date
        let biometricToken: String?
    }

    func extendSession(biometric: Bool) async throws -> ExtendSessionResult {
        struct Res: Codable { var expiresAt: String; var biometricToken: String? }
        let res: Res = try await send("session/extend", method: "POST", body: ["biometric": biometric])
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = formatter.date(from: res.expiresAt) ?? Date()
        return ExtendSessionResult(expiresAt: date, biometricToken: res.biometricToken)
    }

    func loginWithBiometricToken(_ biometricToken: String) async throws -> AuthResponse {
        try await send("login/biometric", method: "POST", body: ["biometricToken": biometricToken], requiresAuth: false)
    }

    func changePassword(currentPassword: String, newPassword: String, confirmPassword: String) async throws {
        try await sendVoid("change-password", method: "POST", body: [
            "currentPassword": currentPassword,
            "newPassword": newPassword,
            "confirmPassword": confirmPassword
        ])
    }

    func bootstrap() async throws -> BootstrapResponse {
        try await send("bootstrap")
    }

    func updatePingAlerts(recipientUserIds: [String]) async throws -> PingAlerts {
        struct Res: Codable { var pingAlerts: PingAlerts }
        let res: Res = try await send("ping-alerts", method: "PATCH", body: ["recipientUserIds": recipientUserIds])
        return res.pingAlerts
    }

    /// Public endpoint: returns the IP-derived country (Cloudflare CF-IPCountry)
    /// plus whatever GPS we attached. Used to gate node selection by region.
    func fetchGeo() async throws -> GeoResponse {
        try await send("geo", requiresAuth: false)
    }

    // MARK: - Inventory import (Asset Check Form)

    func importParse(companyId: String, branchId: String, fileBase64: String) async throws -> ImportDiff {
        try await send("inventory/import/parse", method: "POST", body: [
            "companyId": companyId, "branchId": branchId, "fileBase64": fileBase64
        ])
    }

    func importApply(companyId: String, branchId: String, create: [[String: Any]], update: [[String: Any]], place: [[String: Any]]) async throws -> ImportApplyResult {
        try await send("inventory/import/apply", method: "POST", body: [
            "companyId": companyId, "branchId": branchId, "create": create, "update": update, "place": place
        ])
    }

    func parseStaffXLSX(base64: String) async throws -> [StaffEntry] {
        struct DTO: Codable { var name: String; var phone: String?; var email: String? }
        struct Res: Codable { var entries: [DTO] }
        let res: Res = try await send("staff/parse-xlsx", method: "POST", body: ["fileBase64": base64])
        return res.entries.map {
            StaffEntry(
                employeeId: "",
                name: $0.name,
                phone: ($0.phone?.isEmpty ?? true) ? nil : $0.phone,
                email: ($0.email?.isEmpty ?? true) ? nil : $0.email
            )
        }
    }

    func scan(skuCode: String) async throws -> SKUItem {
        let escaped = skuCode.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? skuCode
        let response: SKUResponse = try await send("scan/\(escaped)")
        return response.sku
    }

    func borrow(skuCode: String) async throws -> SKUItem {
        try await skuAction("borrow", skuCode: skuCode)
    }

    func returnItem(skuCode: String) async throws -> SKUItem {
        try await skuAction("return", skuCode: skuCode)
    }

    func repair(skuCode: String) async throws -> SKUItem {
        try await skuAction("repair", skuCode: skuCode)
    }

    func repaired(skuCode: String) async throws -> SKUItem {
        try await skuAction("return-after-repair", skuCode: skuCode)
    }

    // MARK: Company

    func createCompany(name: String, code: String) async throws -> Company {
        struct Res: Codable { var warehouse: Company }
        let res: Res = try await send("warehouses", method: "POST", body: ["name": name, "code": code])
        return res.warehouse
    }

    func updateCompany(id: String, name: String, code: String) async throws -> Company {
        struct Res: Codable { var warehouse: Company }
        let res: Res = try await send("warehouses/\(id)", method: "PATCH", body: ["name": name, "code": code])
        return res.warehouse
    }

    func deleteCompany(id: String) async throws {
        try await sendVoid("warehouses/\(id)", method: "DELETE")
    }

    // MARK: Branch

    func addBranch(companyId: String, name: String, endorserUserId: String?) async throws -> Park {
        struct Res: Codable { var branch: Park }
        let body: [String: Any] = ["name": name, "endorserUserId": endorserUserId ?? NSNull()]
        let res: Res = try await send("warehouses/\(companyId)/branches", method: "POST", body: body)
        return res.branch
    }

    func updateBranch(companyId: String, parkId: String, name: String, endorserUserId: String?) async throws -> Park {
        struct Res: Codable { var branch: Park }
        let body: [String: Any] = ["name": name, "endorserUserId": endorserUserId ?? NSNull()]
        let res: Res = try await send("warehouses/\(companyId)/branches/\(parkId)", method: "PATCH", body: body)
        return res.branch
    }

    func deleteBranch(companyId: String, parkId: String) async throws {
        try await sendVoid("warehouses/\(companyId)/branches/\(parkId)", method: "DELETE")
    }

    // MARK: Location (child of branch)

    func addLocation(companyId: String, branchId: String, name: String) async throws -> StockLocation {
        struct Res: Codable { var location: StockLocation }
        let res: Res = try await send("warehouses/\(companyId)/branches/\(branchId)/locations", method: "POST", body: ["name": name])
        return res.location
    }

    func updateLocation(companyId: String, branchId: String, locationId: String, name: String) async throws -> StockLocation {
        struct Res: Codable { var location: StockLocation }
        let res: Res = try await send("warehouses/\(companyId)/branches/\(branchId)/locations/\(locationId)", method: "PATCH", body: ["name": name])
        return res.location
    }

    func deleteLocation(companyId: String, branchId: String, locationId: String) async throws {
        try await sendVoid("warehouses/\(companyId)/branches/\(branchId)/locations/\(locationId)", method: "DELETE")
    }

    // MARK: Category

    func createCategory(companyId: String, code: String, branchIds: [String]) async throws -> Category {
        struct Res: Codable { var category: Category }
        let body: [String: Any] = ["code": code, "branchIds": branchIds]
        let res: Res = try await send("warehouses/\(companyId)/categories", method: "POST", body: body)
        return res.category
    }

    func updateCategory(companyId: String, categoryId: String, code: String, branchIds: [String]) async throws -> Category {
        struct Res: Codable { var category: Category }
        let body: [String: Any] = ["code": code, "branchIds": branchIds]
        let res: Res = try await send("warehouses/\(companyId)/categories/\(categoryId)", method: "PATCH", body: body)
        return res.category
    }

    func deleteCategory(companyId: String, categoryId: String) async throws {
        try await sendVoid("warehouses/\(companyId)/categories/\(categoryId)", method: "DELETE")
    }

    // MARK: User Management

    func createUser(username: String, name: String, password: String, role: String, phone: String?, phoneCountryCode: String?, email: String?, warehouseIds: [String], branchIds: [String]) async throws -> User {
        struct Res: Codable { var user: User }
        var body: [String: Any] = ["username": username, "name": name, "password": password, "role": role, "warehouseIds": warehouseIds, "branchIds": branchIds]
        if let phone { body["phone"] = phone }
        if let phoneCountryCode { body["phoneCountryCode"] = phoneCountryCode }
        if let email { body["email"] = email }
        let res: Res = try await send("users", method: "POST", body: body)
        return res.user
    }

    func updateUser(id: String, name: String, role: String, phone: String?, phoneCountryCode: String?, email: String?, isDisabled: Bool, warehouseIds: [String], branchIds: [String]) async throws -> User {
        struct Res: Codable { var user: User }
        var body: [String: Any] = ["name": name, "role": role, "warehouseIds": warehouseIds, "branchIds": branchIds]
        if let phone { body["phone"] = phone }
        if let phoneCountryCode { body["phoneCountryCode"] = phoneCountryCode }
        if let email { body["email"] = email }
        let res: Res = try await send("users/\(id)", method: "PATCH", body: body)
        return res.user
    }

    func disableUser(id: String) async throws -> User {
        struct Res: Codable { var user: User }
        let res: Res = try await send("users/\(id)/disable", method: "PATCH", body: [:])
        return res.user
    }

    func resumeUser(id: String) async throws -> User {
        struct Res: Codable { var user: User }
        let res: Res = try await send("users/\(id)/resume", method: "PATCH", body: [:])
        return res.user
    }

    func resetPasswordRequired(id: String) async throws -> User {
        struct Res: Codable { var user: User }
        let res: Res = try await send("users/\(id)/reset-password-required", method: "POST", body: [:])
        return res.user
    }

    func deleteUser(id: String) async throws {
        try await sendVoid("users/\(id)", method: "DELETE")
    }

    // MARK: Inventory Actions

    func createSKU(warehouseId: String, branchId: String, categoryId: String, locationId: String?, skuNumber: String, descriptionId: String?, descriptionText: String?, serialNumber: String?) async throws -> SKUItem {
        var body: [String: Any] = ["warehouseId": warehouseId, "branchId": branchId, "categoryId": categoryId, "skuNumber": skuNumber]
        if let locationId { body["locationId"] = locationId }
        if let descriptionId { body["descriptionId"] = descriptionId }
        if let descriptionText { body["descriptionText"] = descriptionText }
        if let serialNumber { body["serialNumber"] = serialNumber }
        let res: SKUResponse = try await send("skus", method: "POST", body: body)
        return res.sku
    }

    func updateSKU(id: String, categoryId: String, branchId: String, locationId: String?, skuNumber: String?, descriptionId: String?, descriptionText: String?, serialNumber: String?) async throws -> SKUItem {
        var body: [String: Any] = ["categoryId": categoryId, "branchId": branchId, "locationId": locationId ?? NSNull()]
        if let skuNumber { body["skuNumber"] = skuNumber }
        body["descriptionId"] = descriptionId ?? NSNull()
        if let descriptionText { body["descriptionText"] = descriptionText }
        if let serialNumber { body["serialNumber"] = serialNumber }
        let res: SKUResponse = try await send("skus/\(id)", method: "PATCH", body: body)
        return res.sku
    }

    func requestRepair(skuCode: String, reason: String, destination: String) async throws -> SKUItem {
        let res: SKUResponse = try await send("repair", method: "POST", body: ["skuNumber": skuCode, "reason": reason, "destination": destination])
        return res.sku
    }

    func requestTransfer(skuCode: String, toBranchId: String, reason: String) async throws -> SKUItem {
        let res: SKUResponse = try await send("transfer", method: "POST", body: ["skuNumber": skuCode, "toBranchId": toBranchId, "reason": reason])
        return res.sku
    }

    func requestDisposal(skuCode: String, reason: String, netBookValue: String) async throws -> SKUItem {
        let res: SKUResponse = try await send("disposal", method: "POST", body: ["skuNumber": skuCode, "reason": reason, "netBookValue": netBookValue])
        return res.sku
    }

    func fetchUserLogs() async throws -> [UserLog] {
        struct Res: Codable { var userLogs: [UserLog] }
        let res: Res = try await send("user-logs")
        return res.userLogs
    }

    func reviewNotification(_ id: String, approved: Bool, reviewNote: String?) async throws -> NotificationItem {
        struct Res: Codable { var notification: NotificationItem }
        var body: [String: Any] = ["status": approved ? "approved" : "denied"]
        if let note = reviewNote { body["reviewNote"] = note }
        let res: Res = try await send("notifications/\(id)/review", method: "POST", body: body)
        return res.notification
    }

    // MARK: - Notification / SMTP settings (superadmin)

    func fetchNotificationSettings() async throws -> SMTPSettings {
        struct Res: Codable { var notificationSettings: NotificationSettings }
        let res: Res = try await send("notification-settings")
        return res.notificationSettings.smtp ?? SMTPSettings()
    }

    func updateSMTPSettings(_ smtp: SMTPSettings) async throws -> SMTPSettings {
        struct Res: Codable { var notificationSettings: NotificationSettings }
        let body: [String: Any] = ["smtp": [
            "enabled": smtp.enabled,
            "host": smtp.host,
            "port": smtp.port,
            "secure": smtp.secure,
            "username": smtp.username,
            "password": smtp.password,
            "fromName": smtp.fromName,
            "fromAddress": smtp.fromAddress
        ]]
        let res: Res = try await send("notification-settings", method: "PATCH", body: body)
        return res.notificationSettings.smtp ?? smtp
    }

    /// Sends a real test email. Returns the server message.
    func testSMTP(to: String?) async throws -> String {
        struct Res: Codable { var ok: Bool; var message: String? }
        var body: [String: Any] = [:]
        if let to, !to.isEmpty { body["to"] = to }
        let res: Res = try await send("notification-settings/smtp-test", method: "POST", body: body)
        return res.message ?? (res.ok ? "Test email sent." : "Test failed.")
    }

    func markNotification(_ id: String, status: String) async throws -> NotificationItem {
        struct Response: Codable {
            var notification: NotificationItem
        }
        let response: Response = try await send("notifications/\(id)", method: "PATCH", body: ["status": status])
        return response.notification
    }

    // MARK: - Asset Check Forms

    func createAssetCheckForm(companyId: String, branchId: String, acfNo: String, signaturePng: String) async throws -> AssetCheckForm {
        struct Res: Codable { var form: AssetCheckForm }
        let res: Res = try await send("asset-check-forms", method: "POST", body: [
            "companyId": companyId, "branchId": branchId, "acfNo": acfNo, "signaturePng": signaturePng
        ])
        return res.form
    }

    func signAssetCheckForm(id: String, signaturePng: String) async throws {
        try await sendVoid("asset-check-forms/\(id)/sign", method: "POST", body: ["signaturePng": signaturePng])
    }

    func denyAssetCheckForm(id: String, reason: String) async throws {
        try await sendVoid("asset-check-forms/\(id)/deny", method: "POST", body: ["reason": reason])
    }

    func withdrawAssetCheckForm(id: String) async throws {
        try await sendVoid("asset-check-forms/\(id)/withdraw", method: "POST")
    }

    func getAssetCheckForm(id: String) async throws -> AssetCheckForm {
        struct Res: Codable { var form: AssetCheckForm }
        let res: Res = try await send("asset-check-forms/\(id)")
        return res.form
    }

    func resubmitAssetCheckForm(id: String, companyId: String, branchId: String, acfNo: String, signaturePng: String) async throws {
        try await sendVoid("asset-check-forms/\(id)/resubmit", method: "POST", body: [
            "companyId": companyId, "branchId": branchId, "acfNo": acfNo, "signaturePng": signaturePng
        ])
    }

    /// Downloads the role-appropriate file (PDF for a party, ZIP for superadmin).
    /// Returns the bytes and the server-suggested filename.
    func downloadAssetCheckForm(id: String) async throws -> (data: Data, filename: String) {
        let baseString = baseURL.absoluteString.hasSuffix("/") ? baseURL.absoluteString : "\(baseURL.absoluteString)/"
        guard let normalizedBaseURL = URL(string: baseString),
              let endpoint = URL(string: "asset-check-forms/\(id)/download", relativeTo: normalizedBaseURL)?.absoluteURL else {
            throw APIClientError.invalidURL
        }
        var request = URLRequest(url: endpoint)
        guard let token else { throw APIClientError.missingToken }
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let clientGeoHeader { request.setValue(clientGeoHeader, forHTTPHeaderField: "X-Client-Geo") }
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                throw APIClientError.transport("The server response was invalid.")
            }
            guard (200..<300).contains(http.statusCode) else {
                if let payload = try? JSONDecoder.inventory.decode(APIErrorPayload.self, from: data) {
                    throw APIClientError.server(payload.error)
                }
                throw APIClientError.server("Download failed with status \(http.statusCode).")
            }
            var filename = "AssetCheckForm"
            if let disp = http.value(forHTTPHeaderField: "Content-Disposition"),
               let range = disp.range(of: "filename=\"") {
                let rest = disp[range.upperBound...]
                if let end = rest.firstIndex(of: "\"") { filename = String(rest[..<end]) }
            }
            return (data, filename)
        } catch let error as APIClientError {
            throw error
        } catch {
            throw APIClientError.transport(error.localizedDescription)
        }
    }

    private func sendVoid(_ path: String, method: String, body: [String: Any]? = nil, requiresAuth: Bool = true) async throws {
        let baseString = baseURL.absoluteString.hasSuffix("/") ? baseURL.absoluteString : "\(baseURL.absoluteString)/"
        guard let normalizedBaseURL = URL(string: baseString),
              let endpoint = URL(string: path, relativeTo: normalizedBaseURL)?.absoluteURL else {
            throw APIClientError.invalidURL
        }
        var request = URLRequest(url: endpoint)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let clientGeoHeader { request.setValue(clientGeoHeader, forHTTPHeaderField: "X-Client-Geo") }
        if requiresAuth {
            guard let token else { throw APIClientError.missingToken }
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        do {
            let (data, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIClientError.transport("The server response was invalid.")
            }
            guard (200..<300).contains(httpResponse.statusCode) else {
                if let payload = try? JSONDecoder.inventory.decode(APIErrorPayload.self, from: data) {
                    throw APIClientError.server(payload.error)
                }
                throw APIClientError.server("Request failed with status \(httpResponse.statusCode).")
            }
        } catch let error as APIClientError {
            throw error
        } catch {
            throw APIClientError.transport(error.localizedDescription)
        }
    }

    private func skuAction(_ endpoint: String, skuCode: String) async throws -> SKUItem {
        let response: SKUResponse = try await send(endpoint, method: "POST", body: ["skuNumber": skuCode])
        return response.sku
    }

    private func send<Response: Decodable>(
        _ path: String,
        method: String = "GET",
        body: [String: Any]? = nil,
        requiresAuth: Bool = true
    ) async throws -> Response {
        let baseString = baseURL.absoluteString.hasSuffix("/") ? baseURL.absoluteString : "\(baseURL.absoluteString)/"
        guard let normalizedBaseURL = URL(string: baseString),
              let endpoint = URL(string: path, relativeTo: normalizedBaseURL)?.absoluteURL else {
            throw APIClientError.invalidURL
        }
        var request = URLRequest(url: endpoint)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let clientGeoHeader { request.setValue(clientGeoHeader, forHTTPHeaderField: "X-Client-Geo") }
        if requiresAuth {
            guard let token else { throw APIClientError.missingToken }
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        do {
            let (data, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIClientError.transport("The server response was invalid.")
            }
            guard (200..<300).contains(httpResponse.statusCode) else {
                // 401 = the session is invalid (distinct from a network failure) so
                // the connection loop can sign out instead of retrying forever.
                if httpResponse.statusCode == 401 { throw APIClientError.missingToken }
                if let payload = try? JSONDecoder.inventory.decode(APIErrorPayload.self, from: data) {
                    throw APIClientError.server(payload.error)
                }
                throw APIClientError.server("Request failed with status \(httpResponse.statusCode).")
            }
            return try JSONDecoder.inventory.decode(Response.self, from: data)
        } catch let error as APIClientError {
            throw error
        } catch {
            throw APIClientError.transport(error.localizedDescription)
        }
    }
}

extension JSONDecoder {
    static var inventory: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}
