package com.inventoryborrowingsystem.data

import com.google.gson.annotations.SerializedName

// MARK: - Enums

enum class UserRole(val value: String) {
    @SerializedName("staff") STAFF("staff"),
    @SerializedName("warehouse_manager") WAREHOUSE_MANAGER("warehouse_manager"),
    @SerializedName("admin") ADMIN("admin"),
    @SerializedName("superadmin") SUPERADMIN("superadmin");

    val displayName: String get() = when (this) {
        STAFF -> "Staff"
        WAREHOUSE_MANAGER -> "Manager"
        ADMIN -> "Admin"
        SUPERADMIN -> "Superadmin"
    }

    val canSeeManagementShortcuts: Boolean
        get() = this == WAREHOUSE_MANAGER || this == ADMIN || this == SUPERADMIN

    companion object {
        fun fromValue(value: String): UserRole = entries.find { it.value == value } ?: STAFF
    }
}

enum class SKUStatus(val value: String) {
    @SerializedName("available") AVAILABLE("available"),
    @SerializedName("borrowed") BORROWED("borrowed"),
    @SerializedName("repairing") REPAIRING("repairing"),
    @SerializedName("disposed") DISPOSED("disposed"),
    @SerializedName("sold") SOLD("sold");

    val displayName: String get() = when (this) {
        AVAILABLE -> "Available"
        BORROWED -> "Borrowed"
        REPAIRING -> "Repairing"
        DISPOSED -> "Disposed"
        SOLD -> "Sold"
    }

    companion object {
        fun fromValue(value: String): SKUStatus = entries.find { it.value == value } ?: AVAILABLE
    }
}

enum class SKUAction(val value: String) {
    BORROW("borrow"),
    RETURN_ITEM("returnItem"),
    REPAIR("repair"),
    REPAIRED("repaired");

    val title: String get() = when (this) {
        BORROW -> "Borrow"
        RETURN_ITEM -> "Return"
        REPAIR -> "Repair"
        REPAIRED -> "Repaired"
    }
}

enum class ThemeOption(val value: String) {
    SYSTEM("system"),
    LIGHT("light"),
    DARK("dark");

    val title: String get() = when (this) {
        SYSTEM -> "Follow system"
        LIGHT -> "Light"
        DARK -> "Dark"
    }

    companion object {
        fun fromValue(value: String): ThemeOption = entries.find { it.value == value } ?: SYSTEM
    }
}

enum class LanguageOption(val value: String) {
    ENGLISH("english"),
    CHINESE("chinese");

    val title: String get() = when (this) {
        ENGLISH -> "English"
        CHINESE -> "中文"
    }

    companion object {
        fun fromValue(value: String): LanguageOption = entries.find { it.value == value } ?: ENGLISH
    }
}

enum class AppLockDelay(val value: String) {
    IMMEDIATELY("immediately"),
    ONE_MINUTE("1min"),
    FIFTEEN_MINUTES("15min"),
    ONE_HOUR("1hr");

    val title: String get() = when (this) {
        IMMEDIATELY -> "Immediately"
        ONE_MINUTE -> "After 1 Minute"
        FIFTEEN_MINUTES -> "After 15 Minutes"
        ONE_HOUR -> "After 1 Hour"
    }

    val seconds: Long get() = when (this) {
        IMMEDIATELY -> 0L
        ONE_MINUTE -> 60L
        FIFTEEN_MINUTES -> 900L
        ONE_HOUR -> 3600L
    }

    companion object {
        fun fromValue(value: String): AppLockDelay = entries.find { it.value == value } ?: IMMEDIATELY
    }
}

// MARK: - Data Classes

data class User(
    val id: String,
    val username: String,
    var name: String,
    var role: UserRole,
    var phone: String? = null,
    @SerializedName("phoneCountryCode") var phoneCountryCode: String? = null,
    var email: String? = null,
    @SerializedName("passwordResetRequired") var passwordResetRequired: Boolean? = null,
    @SerializedName("isDisabled") var isDisabled: Boolean? = null,
    @SerializedName("disabledAt") var disabledAt: String? = null,
    @SerializedName("warehouseIds") var warehouseIds: List<String>? = null,
    @SerializedName("branchIds") var branchIds: List<String>? = null,
    @SerializedName("createdAt") var createdAt: String? = null,
    @SerializedName("updatedAt") var updatedAt: String? = null
)

data class Permissions(
    @SerializedName("canViewInventory") var canViewInventory: Boolean,
    @SerializedName("canManageInventory") var canManageInventory: Boolean,
    @SerializedName("canManageUsers") var canManageUsers: Boolean,
    @SerializedName("canManageAlerts") var canManageAlerts: Boolean,
    @SerializedName("canViewUserLogs") var canViewUserLogs: Boolean,
    @SerializedName("canReviewApprovals") var canReviewApprovals: Boolean,
    @SerializedName("canCreateAdmin") var canCreateAdmin: Boolean
)

data class Company(
    val id: String,
    var code: String,
    var name: String,
    var branches: List<Park>,
    var categories: List<Category>,
    var descriptions: List<EquipmentDescription>? = null
)

data class Park(
    val id: String,
    var name: String,
    var locations: List<StockLocation>? = null,
    @SerializedName("endorserUserId") var endorserUserId: String? = null,
    @SerializedName("endorserName") var endorserName: String? = null
)

data class StockLocation(
    val id: String,
    var name: String
)

data class Category(
    val id: String,
    var code: String,
    @SerializedName("branchIds") var branchIds: List<String> = emptyList()
)

data class EquipmentDescription(
    val id: String,
    @SerializedName("branchId") var branchId: String? = null,
    var text: String
)

data class SKUItem(
    val id: String,
    @SerializedName("skuCode") var skuCode: String? = null,
    @SerializedName("skuNumber") var skuNumber: String? = null,
    @SerializedName("warehouseId") var warehouseId: String? = null,
    @SerializedName("categoryId") var categoryId: String? = null,
    @SerializedName("branchId") var branchId: String? = null,
    @SerializedName("locationId") var locationId: String? = null,
    @SerializedName("companyCode") var companyCode: String? = null,
    @SerializedName("companyName") var companyName: String? = null,
    @SerializedName("parkName") var parkName: String? = null,
    @SerializedName("locationName") var locationName: String? = null,
    @SerializedName("categoryCode") var categoryCode: String? = null,
    @SerializedName("serialNumber") var serialNumber: String? = null,
    @SerializedName("descriptionId") var descriptionId: String? = null,
    @SerializedName("descriptionText") var descriptionText: String? = null,
    var status: SKUStatus,
    @SerializedName("borrowedByUserId") var borrowedByUserId: String? = null,
    @SerializedName("borrowedByName") var borrowedByName: String? = null,
    @SerializedName("borrowedByUsername") var borrowedByUsername: String? = null,
    @SerializedName("borrowedAt") var borrowedAt: String? = null,
    @SerializedName("repairStartedAt") var repairStartedAt: String? = null,
    @SerializedName("repairRequestedByUserId") var repairRequestedByUserId: String? = null,
    @SerializedName("repairRequestedByName") var repairRequestedByName: String? = null,
    @SerializedName("repairReason") var repairReason: String? = null,
    @SerializedName("repairDestination") var repairDestination: String? = null,
    @SerializedName("disposalType") var disposalType: String? = null,
    @SerializedName("soldTo") var soldTo: String? = null,
    @SerializedName("lastScannedAt") var lastScannedAt: String? = null,
    @SerializedName("lastScannedByUserId") var lastScannedByUserId: String? = null,
    @SerializedName("lastScannedByName") var lastScannedByName: String? = null,
    @SerializedName("createdAt") var createdAt: String? = null,
    @SerializedName("updatedAt") var updatedAt: String? = null
) {
    val displayCode: String get() = skuCode ?: skuNumber ?: ""
    val canBorrow: Boolean get() = status == SKUStatus.AVAILABLE
    val canReturn: Boolean get() = status == SKUStatus.BORROWED
    val canRepair: Boolean get() = status == SKUStatus.AVAILABLE
    val canMarkRepaired: Boolean get() = status == SKUStatus.REPAIRING
}

data class InventoryRecord(
    val id: String,
    var type: String,
    @SerializedName("skuId") var skuId: String? = null,
    @SerializedName("skuCode") var skuCode: String? = null,
    @SerializedName("serialNumber") var serialNumber: String? = null,
    @SerializedName("userId") var userId: String? = null,
    @SerializedName("operatorId") var operatorId: String? = null,
    @SerializedName("fromBranchId") var fromBranchId: String? = null,
    @SerializedName("toBranchId") var toBranchId: String? = null,
    var note: String? = null,
    @SerializedName("createdAt") var createdAt: String? = null
)

data class NotificationItem(
    val id: String,
    var type: String,
    var title: String,
    var body: String,
    @SerializedName("senderUserId") var senderUserId: String? = null,
    @SerializedName("recipientUserIds") var recipientUserIds: List<String>? = null,
    var status: String,
    @SerializedName("relatedEntityType") var relatedEntityType: String? = null,
    @SerializedName("relatedEntityId") var relatedEntityId: String? = null,
    @SerializedName("skuIds") var skuIds: List<String>? = null,
    var acf: ACFNotificationMeta? = null,
    @SerializedName("reviewedByUserId") var reviewedByUserId: String? = null,
    @SerializedName("reviewedAt") var reviewedAt: String? = null,
    @SerializedName("reviewNote") var reviewNote: String? = null,
    @SerializedName("createdAt") var createdAt: String? = null,
    @SerializedName("updatedAt") var updatedAt: String? = null
) {
    val isUnreadForBadge: Boolean get() = status == "unread" || status == "pending"
}

data class UserLog(
    val id: String,
    var type: String,
    @SerializedName("actorUserId") var actorUserId: String? = null,
    @SerializedName("actorName") var actorName: String? = null,
    @SerializedName("actorRole") var actorRole: String? = null,
    @SerializedName("entityType") var entityType: String? = null,
    var message: String? = null,
    @SerializedName("ipAddress") var ipAddress: String? = null,
    @SerializedName("createdAt") var createdAt: String? = null,
    @SerializedName("metadata") var metadata: LogMetadata? = null
) {
    /** GPS coordinate captured for this operation, if any. */
    val geo: LogGeo? get() = metadata?.geo
}

/** Only the geo portion of a log's metadata is decoded; other keys are ignored. */
data class LogMetadata(
    @SerializedName("geo") var geo: LogGeo? = null
)

data class LogGeo(
    @SerializedName("country") var country: String? = null,
    @SerializedName("lat") var lat: Double? = null,
    @SerializedName("lng") var lng: Double? = null
)

// MARK: - API Response Models

data class LoginStartResponse(
    var exists: Boolean,
    var hasPassword: Boolean,
    var resetRequired: Boolean,
    var user: LoginStartUser? = null
)

data class LoginStartUser(
    var username: String,
    var name: String,
    @SerializedName("phoneCountryCode") var phoneCountryCode: String? = null
)

data class AuthResponse(
    var token: String,
    @SerializedName("expiresAt") var expiresAt: String,
    @SerializedName("currentUser") var currentUser: User,
    @SerializedName("passwordExpired") var passwordExpired: Boolean? = null
)

data class ExtendSessionResponse(
    @SerializedName("expiresAt") var expiresAt: String,
    @SerializedName("biometricToken") var biometricToken: String? = null
)

data class BootstrapResponse(
    @SerializedName("currentUser") var currentUser: User,
    var permissions: Permissions,
    var warehouses: List<Company>,
    var skus: List<SKUItem>,
    var users: List<User>? = null,
    var records: List<InventoryRecord>,
    var notifications: List<NotificationItem>
)

data class SKUResponse(
    var sku: SKUItem
)

data class GeoResponse(
    var country: String? = null,
    var lat: Double? = null,
    var lng: Double? = null,
    var ip: String? = null
)

// Inventory import (Asset Check Form diff/apply)
data class ImportNewItem(
    var assetId: String = "",
    var description: String = "",
    var serial: String = "",
    var location: String = "",
    var category: String = ""
)

data class ImportDiffField(
    var field: String = "",
    var current: String = "",
    var imported: String = ""
)

data class ImportMismatch(
    var assetId: String = "",
    var skuId: String = "",
    var diffs: List<ImportDiffField> = emptyList(),
    var description: String = "",
    var serial: String = "",
    var location: String = ""
)

data class ImportExisting(
    var assetId: String = "",
    var skuId: String = ""
)

data class ImportRemark(
    var assetId: String = "",
    var remark: String = "",
    var skuId: String? = null,
    var description: String = "",
    var serial: String = "",
    var location: String = "",
    var currentBranchId: String? = null,
    var currentLocation: String = ""
)

data class ImportCounts(
    var new: Int = 0,
    var mismatched: Int = 0,
    var existing: Int = 0,
    var newLocations: Int = 0,
    var remarks: Int = 0,
    var total: Int = 0
)

data class ImportDiff(
    var newItems: List<ImportNewItem> = emptyList(),
    var mismatched: List<ImportMismatch> = emptyList(),
    var existing: List<ImportExisting> = emptyList(),
    var newLocations: List<String> = emptyList(),
    var remarks: List<ImportRemark> = emptyList(),
    var counts: ImportCounts = ImportCounts()
)

data class ImportApplyResult(
    var created: Int = 0,
    var updated: Int = 0,
    var transferred: Int = 0,
    var errors: List<String> = emptyList()
)

data class NotificationsResponse(
    var notifications: List<NotificationItem>
)

data class APIErrorPayload(
    var error: String,
    var code: String? = null
)

data class UserResponse(
    var user: User
)

data class UserLogsResponse(
    @SerializedName("userLogs") var userLogs: List<UserLog>
)

data class NotificationResponse(
    var notification: NotificationItem
)

data class CompanyResponse(
    var warehouse: Company
)

data class ParkResponse(
    var park: Park
)

data class CategoryResponse(
    var category: Category
)

data class BranchResponse(
    var branch: Park
)

data class LocationResponse(
    var location: StockLocation
)

// MARK: - Staff directory (local CSV/XLSX import)

data class StaffEntry(
    @SerializedName("employeeId") var employeeId: String = "",
    var name: String,
    var phone: String? = null,
    var email: String? = null
) {
    val id: String get() = "$name|${phone ?: ""}|$employeeId"
}

data class StaffDirectory(
    var entries: List<StaffEntry>,
    var importedAt: Long
)

data class StaffImportChange(val old: StaffEntry, val new: StaffEntry)

data class StaffImportDiff(
    val added: List<StaffEntry>,
    val updated: List<StaffImportChange>,
    val unchanged: List<StaffEntry>,
    val all: List<StaffEntry>
)

// MARK: - Asset Check Form (ACF)

data class AssetCheckFormRow(
    var no: Int,
    var assetId: String,
    var location: String,
    var description: String,
    var serial: String,
    var found: String,
    var checkedBy: String,
    var date: String
)

data class AssetCheckForm(
    val id: String,
    var acfNo: String,
    @SerializedName("companyId") var companyId: String? = null,
    @SerializedName("companyName") var companyName: String? = null,
    @SerializedName("branchId") var branchId: String? = null,
    @SerializedName("branchName") var branchName: String? = null,
    var status: String,
    @SerializedName("assetCount") var assetCount: Int? = null,
    var rows: List<AssetCheckFormRow>? = null,
    @SerializedName("requesterName") var requesterName: String? = null,
    @SerializedName("endorserName") var endorserName: String? = null,
    @SerializedName("denyReason") var denyReason: String? = null,
    @SerializedName("requestDate") var requestDate: String? = null,
    @SerializedName("approvalDate") var approvalDate: String? = null
)

data class ACFNotificationMeta(
    var acfNo: String? = null,
    var requesterName: String? = null,
    var requesterPhone: String? = null,
    var endorserName: String? = null,
    var endorserPhone: String? = null,
    var password: String? = null
)

data class AssetCheckFormResponse(
    var form: AssetCheckForm
)

// MARK: - SMTP / Email alert settings

data class SMTPSettings(
    var enabled: Boolean = false,
    var host: String = "",
    var port: Int = 587,
    var secure: Boolean = false,
    var username: String = "",
    var password: String = "",
    var fromName: String = "",
    var fromAddress: String = "",
    var health: String? = null,
    var lastTestAt: String? = null
)

data class NotificationSettings(
    var smtp: SMTPSettings? = null
)

data class NotificationSettingsResponse(
    @SerializedName("notificationSettings") var notificationSettings: NotificationSettings
)

data class SMTPTestResponse(
    var ok: Boolean = false,
    var message: String? = null
)

// MARK: - Server nodes (bundled catalog)

data class ServerNodeInfo(
    val label: String,
    val url: String
)
