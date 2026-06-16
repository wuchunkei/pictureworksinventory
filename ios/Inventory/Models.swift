import Foundation

enum UserRole: String, Codable {
    case staff
    case warehouseManager = "warehouse_manager"
    case admin
    case superadmin

    var displayName: String {
        switch self {
        case .staff: return "Staff"
        case .warehouseManager: return "Manager"
        case .admin: return "Admin"
        case .superadmin: return "Superadmin"
        }
    }

    var canSeeManagementShortcuts: Bool {
        self == .warehouseManager || self == .admin || self == .superadmin
    }
}

struct User: Codable, Identifiable, Equatable {
    let id: String
    let username: String
    var name: String
    var role: UserRole
    var phone: String?
    var phoneCountryCode: String?
    var email: String?
    var passwordResetRequired: Bool?
    var isDisabled: Bool?
    var disabledAt: String?
    var warehouseIds: [String]?
    var branchIds: [String]?
    var createdAt: String?
    var updatedAt: String?
}

struct Permissions: Codable, Equatable {
    var canViewInventory: Bool
    var canManageInventory: Bool
    var canManageUsers: Bool
    var canManageAlerts: Bool
    var canViewUserLogs: Bool
    var canReviewApprovals: Bool
    var canCreateAdmin: Bool
}

struct Company: Codable, Identifiable, Equatable {
    let id: String
    var code: String
    var name: String
    var branches: [Park]
    var categories: [Category]
    var descriptions: [EquipmentDescription]?
}

struct Park: Codable, Identifiable, Equatable {
    let id: String
    var name: String
    var locations: [StockLocation]?
    var endorserUserId: String?
    var endorserName: String?
}

struct StockLocation: Codable, Identifiable, Equatable {
    let id: String
    var name: String
}

struct Category: Codable, Identifiable, Equatable {
    let id: String
    var code: String
    var branchIds: [String]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        code = try c.decode(String.self, forKey: .code)
        branchIds = try c.decodeIfPresent([String].self, forKey: .branchIds) ?? []
    }
}

struct EquipmentDescription: Codable, Identifiable, Equatable {
    let id: String
    var branchId: String?
    var text: String
}

enum SKUStatus: String, Codable {
    case available
    case borrowed
    case repairing
    case disposed
    case sold

    var displayName: String {
        switch self {
        case .available: return "Available"
        case .borrowed: return "Borrowed"
        case .repairing: return "Repairing"
        case .disposed: return "Disposed"
        case .sold: return "Sold"
        }
    }
}

struct SKUItem: Codable, Identifiable, Equatable {
    let id: String
    var skuCode: String?
    var skuNumber: String?
    var warehouseId: String?
    var categoryId: String?
    var branchId: String?
    var locationId: String?
    var companyCode: String?
    var companyName: String?
    var parkName: String?
    var locationName: String?
    var categoryCode: String?
    var serialNumber: String?
    var descriptionId: String?
    var descriptionText: String?
    var status: SKUStatus
    var borrowedByUserId: String?
    var borrowedByName: String?
    var borrowedByUsername: String?
    var borrowedAt: String?
    var repairStartedAt: String?
    var repairRequestedByUserId: String?
    var repairRequestedByName: String?
    var repairReason: String?
    var repairDestination: String?
    var disposalType: String?
    var soldTo: String?
    var lastScannedAt: String?
    var createdAt: String?
    var updatedAt: String?

    var displayCode: String {
        skuCode ?? skuNumber ?? ""
    }

    var canBorrow: Bool { status == .available }
    var canReturn: Bool { status == .borrowed }
    var canRepair: Bool { status == .available }
    var canMarkRepaired: Bool { status == .repairing }
}

struct InventoryRecord: Codable, Identifiable, Equatable {
    let id: String
    var type: String
    var skuId: String?
    var skuCode: String?
    var serialNumber: String?
    var userId: String?
    var operatorId: String?
    var fromBranchId: String?
    var toBranchId: String?
    var note: String?
    var createdAt: String?
}

struct ACFNotificationMeta: Codable, Equatable, Hashable {
    var acfNo: String?
    var requesterName: String?
    var requesterPhone: String?
    var endorserName: String?
    var endorserPhone: String?
    var password: String?
}

struct NotificationItem: Codable, Identifiable, Equatable, Hashable {
    let id: String
    var type: String
    var title: String
    var body: String
    var senderUserId: String?
    var recipientUserIds: [String]?
    var status: String
    var relatedEntityType: String?
    var relatedEntityId: String?
    var skuIds: [String]?
    var acf: ACFNotificationMeta?
    var reviewedByUserId: String?
    var reviewedAt: String?
    var reviewNote: String?
    var createdAt: String?
    var updatedAt: String?

    var isUnreadForBadge: Bool {
        status == "unread" || status == "pending"
    }
}

struct LoginStartResponse: Codable {
    var exists: Bool
    var hasPassword: Bool
    var resetRequired: Bool
    var user: LoginStartUser?
}

struct LoginStartUser: Codable {
    var username: String
    var name: String
    var phoneCountryCode: String?
}

struct AuthResponse: Codable {
    var token: String
    var expiresAt: String
    var currentUser: User
    var passwordExpired: Bool?
}

struct BootstrapResponse: Codable {
    var currentUser: User
    var permissions: Permissions
    var warehouses: [Company]
    var skus: [SKUItem]
    var users: [User]?
    var records: [InventoryRecord]
    var notifications: [NotificationItem]
    var pingAlerts: PingAlerts?
}

struct PingAlerts: Codable {
    var recipientUserIds: [String]?
    var intervalMinutes: Int?
}

struct SKUResponse: Codable {
    var sku: SKUItem
}

// MARK: - SMTP / Email Alert Settings

struct SMTPSettings: Codable, Equatable {
    var enabled: Bool = false
    var host: String = ""
    var port: Int = 587
    var secure: Bool = false
    var username: String = ""
    var password: String = ""
    var fromName: String = ""
    var fromAddress: String = ""
    var health: String? = nil
    var lastTestAt: String? = nil

    init() {}

    // The server may omit fields it has never set (a fresh seed only has
    // enabled/health/lastTestAt), so decode each one defensively with a default.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        enabled = try c.decodeIfPresent(Bool.self, forKey: .enabled) ?? false
        host = try c.decodeIfPresent(String.self, forKey: .host) ?? ""
        port = try c.decodeIfPresent(Int.self, forKey: .port) ?? 587
        secure = try c.decodeIfPresent(Bool.self, forKey: .secure) ?? false
        username = try c.decodeIfPresent(String.self, forKey: .username) ?? ""
        password = try c.decodeIfPresent(String.self, forKey: .password) ?? ""
        fromName = try c.decodeIfPresent(String.self, forKey: .fromName) ?? ""
        fromAddress = try c.decodeIfPresent(String.self, forKey: .fromAddress) ?? ""
        health = try c.decodeIfPresent(String.self, forKey: .health)
        lastTestAt = try c.decodeIfPresent(String.self, forKey: .lastTestAt)
    }
}

struct NotificationSettings: Codable {
    var smtp: SMTPSettings?
}

// MARK: - Asset Check Form

struct AssetCheckFormRow: Codable, Identifiable {
    var no: Int
    var assetId: String
    var location: String
    var description: String
    var serial: String
    var found: String
    var checkedBy: String
    var date: String
    var id: String { "\(no)-\(assetId)" }
}

struct AssetCheckForm: Codable, Identifiable {
    let id: String
    var acfNo: String
    var companyId: String?
    var companyName: String?
    var branchId: String?
    var branchName: String?
    var status: String
    var assetCount: Int?
    var rows: [AssetCheckFormRow]?
    var requesterName: String?
    var endorserName: String?
    var denyReason: String?
    var requestDate: String?
    var approvalDate: String?
}

struct NotificationsResponse: Codable {
    var notifications: [NotificationItem]
}

struct APIErrorPayload: Codable {
    var error: String
    var code: String?
}

// MARK: - User Log

struct UserLog: Codable, Identifiable {
    let id: String
    var type: String
    var actorUserId: String?
    var actorName: String?
    var actorRole: String?
    var entityType: String?
    var message: String?
    var ipAddress: String?
    var createdAt: String?
    var metadata: LogMetadata?

    /// GPS coordinate captured for this operation, if any.
    var geo: LogGeo? { metadata?.geo }
}

/// Only the geo portion of a log's metadata is decoded; other keys are ignored.
struct LogMetadata: Codable {
    var geo: LogGeo?
}

struct LogGeo: Codable {
    var country: String?
    var lat: Double?
    var lng: Double?

    var hasCoordinate: Bool { lat != nil && lng != nil }
}

// MARK: - IP Location

struct IPLocation {
    let countryCode: String
    let city: String?
    let region: String?
}

// MARK: - Local Staff Directory (CSV import)

struct StaffEntry: Codable, Identifiable {
    var employeeId: String
    var name: String
    var phone: String?
    var email: String?
    var id: String { "\(name)|\(phone ?? "")|\(employeeId)" }
}

struct StaffDirectory: Codable {
    var entries: [StaffEntry]
    var importedAt: Date
}

/// One changed person in a staff-directory import (same name, different info).
struct StaffImportChange: Identifiable {
    var old: StaffEntry
    var new: StaffEntry
    var id: String { new.id }
}

/// Result of comparing an imported staff file against the current directory.
struct StaffImportDiff {
    var added: [StaffEntry]       // new people
    var updated: [StaffImportChange]  // existing people whose info changed
    var unchanged: [StaffEntry]   // existing, no change
    var all: [StaffEntry]         // the full imported list (becomes the directory)
}

// MARK: - Inventory import (Asset Check Form diff/apply)

struct ImportNewItem: Codable, Identifiable {
    var assetId: String
    var description: String
    var serial: String
    var location: String
    var category: String
    var id: String { assetId }
}

struct ImportDiffField: Codable {
    var field: String
    var current: String
    var imported: String
}

struct ImportMismatch: Codable, Identifiable {
    var assetId: String
    var skuId: String
    var diffs: [ImportDiffField]
    var description: String
    var serial: String
    var location: String
    var id: String { skuId }
}

struct ImportExisting: Codable, Identifiable {
    var assetId: String
    var skuId: String
    var id: String { skuId }
}

struct ImportRemark: Codable, Identifiable {
    var assetId: String
    var remark: String
    var skuId: String?
    var description: String?
    var serial: String?
    var location: String?
    var currentBranchId: String?
    var currentLocation: String?
    var id: String { assetId + "|" + remark }
}

struct ImportCounts: Codable {
    var new: Int
    var mismatched: Int
    var existing: Int
    var newLocations: Int?
    var remarks: Int?
    var total: Int
}

struct ImportDiff: Codable {
    var newItems: [ImportNewItem]
    var mismatched: [ImportMismatch]
    var existing: [ImportExisting]
    var newLocations: [String]?
    var remarks: [ImportRemark]?
    var counts: ImportCounts
}

struct ImportApplyResult: Codable {
    var created: Int
    var updated: Int
    var errors: [String]
}
