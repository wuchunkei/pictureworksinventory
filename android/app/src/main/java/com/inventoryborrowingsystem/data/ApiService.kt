package com.inventoryborrowingsystem.data

import retrofit2.http.*

interface ApiService {

    // Auth
    @POST("login-start")
    suspend fun loginStart(@Body body: Map<String, String>): LoginStartResponse

    @POST("login")
    suspend fun login(@Body body: Map<String, String>): AuthResponse

    @POST("register")
    suspend fun register(@Body body: Map<String, String>): AuthResponse

    @POST("reset-password")
    suspend fun resetPassword(@Body body: Map<String, String>): AuthResponse

    @POST("verify-identity")
    suspend fun verifyIdentity(@Body body: Map<String, String>): Unit

    @POST("forgot-password")
    suspend fun forgotPassword(@Body body: Map<String, String>): Unit

    @POST("logout")
    suspend fun logout(): Unit

    @POST("session/extend")
    suspend fun extendSession(@Body body: Map<String, Any>): ExtendSessionResponse

    @POST("login/biometric")
    suspend fun loginWithBiometricToken(@Body body: Map<String, String>): AuthResponse

    @POST("change-password")
    suspend fun changePassword(@Body body: Map<String, String>): Unit

    // Bootstrap
    @GET("bootstrap")
    suspend fun bootstrap(): BootstrapResponse

    // Public: IP-derived country (Cloudflare CF-IPCountry) + echoed GPS.
    @GET("geo")
    suspend fun geo(): GeoResponse

    // Inventory import (Asset Check Form): parse+diff, then apply.
    @POST("inventory/import/parse")
    suspend fun importParse(@Body body: Map<String, String>): ImportDiff

    @POST("inventory/import/apply")
    suspend fun importApply(@Body body: @JvmSuppressWildcards Map<String, Any>): ImportApplyResult

    // Scan
    @GET("scan/{skuCode}")
    suspend fun scan(@Path("skuCode", encoded = true) skuCode: String): SKUResponse

    // Inventory actions
    @POST("borrow")
    suspend fun borrow(@Body body: Map<String, String>): SKUResponse

    @POST("return")
    suspend fun returnItem(@Body body: Map<String, String>): SKUResponse

    @POST("repair")
    suspend fun repair(@Body body: Map<String, String>): SKUResponse

    @POST("return-after-repair")
    suspend fun returnAfterRepair(@Body body: Map<String, String>): SKUResponse

    @POST("transfer")
    suspend fun transfer(@Body body: Map<String, String>): SKUResponse

    @POST("disposal")
    suspend fun disposal(@Body body: Map<String, Any>): SKUResponse

    // Users
    @GET("users")
    suspend fun getUsers(): List<User>

    @POST("users")
    suspend fun createUser(@Body body: Map<String, Any>): UserResponse

    @PATCH("users/{id}")
    suspend fun updateUser(@Path("id") id: String, @Body body: Map<String, Any>): UserResponse

    @PATCH("users/{id}/disable")
    suspend fun disableUser(@Path("id") id: String): UserResponse

    @PATCH("users/{id}/resume")
    suspend fun resumeUser(@Path("id") id: String): UserResponse

    @POST("users/{id}/reset-password-required")
    suspend fun resetPasswordRequired(@Path("id") id: String): UserResponse

    @DELETE("users/{id}")
    suspend fun deleteUser(@Path("id") id: String): Unit

    // Notifications
    @GET("notifications")
    suspend fun getNotifications(): NotificationsResponse

    @POST("notifications/{id}/review")
    suspend fun reviewNotification(@Path("id") id: String, @Body body: Map<String, Any>): NotificationResponse

    @PATCH("notifications/{id}")
    suspend fun markNotification(@Path("id") id: String, @Body body: Map<String, String>): NotificationResponse

    // Records
    @GET("records")
    suspend fun getRecords(): List<InventoryRecord>

    // User logs
    @GET("user-logs")
    suspend fun getUserLogs(): UserLogsResponse

    // Warehouses / Companies
    @POST("warehouses")
    suspend fun createCompany(@Body body: Map<String, String>): CompanyResponse

    @PATCH("warehouses/{id}")
    suspend fun updateCompany(@Path("id") id: String, @Body body: Map<String, String>): CompanyResponse

    @DELETE("warehouses/{id}")
    suspend fun deleteCompany(@Path("id") id: String): Unit

    // Branches (current backend uses /branches and {branch} key)
    @POST("warehouses/{companyId}/branches")
    suspend fun addBranch(@Path("companyId") companyId: String, @Body body: Map<String, Any?>): BranchResponse

    @PATCH("warehouses/{companyId}/branches/{branchId}")
    suspend fun updateBranch(@Path("companyId") companyId: String, @Path("branchId") branchId: String, @Body body: Map<String, Any?>): BranchResponse

    @DELETE("warehouses/{companyId}/branches/{branchId}")
    suspend fun deleteBranch(@Path("companyId") companyId: String, @Path("branchId") branchId: String): Unit

    // Locations (child of branch)
    @POST("warehouses/{companyId}/branches/{branchId}/locations")
    suspend fun addLocation(@Path("companyId") companyId: String, @Path("branchId") branchId: String, @Body body: Map<String, String>): LocationResponse

    @PATCH("warehouses/{companyId}/branches/{branchId}/locations/{locationId}")
    suspend fun updateLocation(@Path("companyId") companyId: String, @Path("branchId") branchId: String, @Path("locationId") locationId: String, @Body body: Map<String, String>): LocationResponse

    @DELETE("warehouses/{companyId}/branches/{branchId}/locations/{locationId}")
    suspend fun deleteLocation(@Path("companyId") companyId: String, @Path("branchId") branchId: String, @Path("locationId") locationId: String): Unit

    // Categories
    @POST("warehouses/{companyId}/categories")
    suspend fun createCategory(@Path("companyId") companyId: String, @Body body: Map<String, Any>): CategoryResponse

    @PATCH("warehouses/{companyId}/categories/{categoryId}")
    suspend fun updateCategory(@Path("companyId") companyId: String, @Path("categoryId") categoryId: String, @Body body: Map<String, Any>): CategoryResponse

    @DELETE("warehouses/{companyId}/categories/{categoryId}")
    suspend fun deleteCategory(@Path("companyId") companyId: String, @Path("categoryId") categoryId: String): Unit

    // SKUs (current backend uses top-level /skus)
    @POST("skus")
    suspend fun createSKU(@Body body: Map<String, Any?>): SKUResponse

    @PATCH("skus/{id}")
    suspend fun updateSKU(@Path("id") id: String, @Body body: Map<String, Any?>): SKUResponse

    // Asset Check Forms
    @POST("asset-check-forms")
    suspend fun createAssetCheckForm(@Body body: Map<String, Any?>): AssetCheckFormResponse

    @GET("asset-check-forms/{id}")
    suspend fun getAssetCheckForm(@Path("id") id: String): AssetCheckFormResponse

    @POST("asset-check-forms/{id}/sign")
    suspend fun signAssetCheckForm(@Path("id") id: String, @Body body: Map<String, String>): Unit

    @POST("asset-check-forms/{id}/deny")
    suspend fun denyAssetCheckForm(@Path("id") id: String, @Body body: Map<String, String>): Unit

    @POST("asset-check-forms/{id}/withdraw")
    suspend fun withdrawAssetCheckForm(@Path("id") id: String): Unit

    @POST("asset-check-forms/{id}/resubmit")
    suspend fun resubmitAssetCheckForm(@Path("id") id: String, @Body body: Map<String, Any?>): AssetCheckFormResponse

    @GET("asset-check-forms/{id}/download")
    @Streaming
    suspend fun downloadAssetCheckForm(@Path("id") id: String): retrofit2.Response<okhttp3.ResponseBody>

    // Notification / SMTP settings (superadmin)
    @GET("notification-settings")
    suspend fun getNotificationSettings(): NotificationSettingsResponse

    @PATCH("notification-settings")
    suspend fun updateNotificationSettings(@Body body: Map<String, Any?>): NotificationSettingsResponse

    @POST("notification-settings/smtp-test")
    suspend fun testSMTP(@Body body: Map<String, Any?>): SMTPTestResponse

    // Staff directory XLSX parse
    @POST("staff/parse-xlsx")
    suspend fun parseStaffXLSX(@Body body: Map<String, String>): StaffParseResponse
}

data class StaffParseDTO(
    var name: String,
    var phone: String? = null,
    var email: String? = null
)

data class StaffParseResponse(
    var entries: List<StaffParseDTO>
)
