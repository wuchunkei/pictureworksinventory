package com.inventoryborrowingsystem.viewmodel

import android.Manifest
import android.annotation.SuppressLint
import android.app.Application
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Looper
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.inventoryborrowingsystem.data.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import retrofit2.HttpException
import java.io.IOException
import java.util.Date

enum class AuthPhase { CHECKING, SIGNED_OUT, SIGNED_IN }

class AppViewModel(application: Application) : AndroidViewModel(application) {

    private val tokenStore = TokenStore(application)
    private val prefsStore = PreferencesStore(application)

    // Auth state
    private val _phase = MutableStateFlow(AuthPhase.CHECKING)
    val phase: StateFlow<AuthPhase> = _phase.asStateFlow()

    private val _currentUser = MutableStateFlow<User?>(null)
    val currentUser: StateFlow<User?> = _currentUser.asStateFlow()

    private val _permissions = MutableStateFlow<Permissions?>(null)
    val permissions: StateFlow<Permissions?> = _permissions.asStateFlow()

    private val _companies = MutableStateFlow<List<Company>>(emptyList())
    val companies: StateFlow<List<Company>> = _companies.asStateFlow()

    private val _skus = MutableStateFlow<List<SKUItem>>(emptyList())
    val skus: StateFlow<List<SKUItem>> = _skus.asStateFlow()

    private val _users = MutableStateFlow<List<User>>(emptyList())
    val users: StateFlow<List<User>> = _users.asStateFlow()

    private val _records = MutableStateFlow<List<InventoryRecord>>(emptyList())
    val records: StateFlow<List<InventoryRecord>> = _records.asStateFlow()

    private val _notifications = MutableStateFlow<List<NotificationItem>>(emptyList())
    val notifications: StateFlow<List<NotificationItem>> = _notifications.asStateFlow()

    private val _userLogs = MutableStateFlow<List<UserLog>>(emptyList())
    val userLogs: StateFlow<List<UserLog>> = _userLogs.asStateFlow()

    private val _errorMessage = MutableStateFlow<String?>(null)
    val errorMessage: StateFlow<String?> = _errorMessage.asStateFlow()

    private val _isRefreshing = MutableStateFlow(false)
    val isRefreshing: StateFlow<Boolean> = _isRefreshing.asStateFlow()

    private val _needsPasswordChange = MutableStateFlow(false)
    val needsPasswordChange: StateFlow<Boolean> = _needsPasswordChange.asStateFlow()

    private val _showBiometricEnrollment = MutableStateFlow(false)
    val showBiometricEnrollment: StateFlow<Boolean> = _showBiometricEnrollment.asStateFlow()

    private val _appLocked = MutableStateFlow(false)
    val appLocked: StateFlow<Boolean> = _appLocked.asStateFlow()

    var didJustLogout = false
        private set

    // Settings from DataStore
    val theme: StateFlow<ThemeOption> = prefsStore.themeFlow
        .stateIn(viewModelScope, SharingStarted.Eagerly, ThemeOption.SYSTEM)

    val language: StateFlow<LanguageOption> = prefsStore.languageFlow
        .stateIn(viewModelScope, SharingStarted.Eagerly, LanguageOption.ENGLISH)

    val apiBaseUrl: StateFlow<String> = prefsStore.apiBaseUrlFlow
        .stateIn(viewModelScope, SharingStarted.Eagerly, PreferencesStore.DEFAULT_API_BASE_URL)

    val appLockEnabled: StateFlow<Boolean> = prefsStore.appLockEnabledFlow
        .stateIn(viewModelScope, SharingStarted.Eagerly, false)

    val appLockDelay: StateFlow<AppLockDelay> = prefsStore.appLockDelayFlow
        .stateIn(viewModelScope, SharingStarted.Eagerly, AppLockDelay.IMMEDIATELY)

    val biometricEnabled: StateFlow<Boolean> = prefsStore.biometricEnabledFlow
        .stateIn(viewModelScope, SharingStarted.Eagerly, false)

    val notificationsEnabled: StateFlow<Boolean> = prefsStore.notificationsEnabledFlow
        .stateIn(viewModelScope, SharingStarted.Eagerly, false)

    // Derived state
    val borrowedItems: StateFlow<List<SKUItem>> = combine(_skus, _currentUser) { skus, user ->
        if (user == null) emptyList()
        else skus.filter { it.status == SKUStatus.BORROWED && it.borrowedByUserId == user.id }
    }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    val repairingItems: StateFlow<List<SKUItem>> = combine(_skus, _currentUser) { skus, user ->
        if (user == null) emptyList()
        else when (user.role) {
            UserRole.SUPERADMIN, UserRole.ADMIN, UserRole.WAREHOUSE_MANAGER ->
                skus.filter { it.status == SKUStatus.REPAIRING }
            else ->
                skus.filter { it.status == SKUStatus.REPAIRING && it.repairRequestedByUserId == user.id }
        }
    }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    val notificationBadgeCount: StateFlow<Int> = combine(_notifications, _currentUser) { notifications, user ->
        if (user == null) 0
        else notifications.count { notification ->
            val receivedByMe = notification.recipientUserIds?.contains(user.id) == true
            val submittedByMe = notification.senderUserId == user.id
            notification.isUnreadForBadge && receivedByMe && !submittedByMe
        }
    }.stateIn(viewModelScope, SharingStarted.Eagerly, 0)

    // App lock tracking
    private var lastBackgroundedAt: Long? = null
    private var didGoToBackground = false

    // Init: load preferences and restore session
    init {
        viewModelScope.launch {
            // Load API base URL and set it
            apiBaseUrl.collect { url ->
                ApiClient.setBaseUrl(url)
            }
        }
        viewModelScope.launch {
            restoreSession()
        }
        viewModelScope.launch {
            // In auto/recommended mode, switch to the fastest node on launch.
            applyNodePreferenceOnLaunch()
        }
        loadStaffDirectory()
        // NOTE: initGeo() is NOT called here — it touches _showLocationNudge,
        // which is declared further down and would still be null at this point
        // (Kotlin init-order), causing an NPE on launch. It runs from a second
        // init block placed after those StateFlows are initialized.
    }

    private fun api() = ApiClient.getService()

    // MARK: - Session Management

    private suspend fun restoreSession() {
        if (tokenStore.hasValidSession()) {
            val token = tokenStore.readToken() ?: run {
                _phase.value = AuthPhase.SIGNED_OUT
                return
            }
            ApiClient.setToken(token)
            try {
                refresh()
                didGoToBackground = false
                _phase.value = AuthPhase.SIGNED_IN
            } catch (e: Exception) {
                tokenStore.deleteToken()
                tokenStore.deleteExpiresAt()
                ApiClient.setToken(null)
                _phase.value = AuthPhase.SIGNED_OUT
            }
        } else {
            _phase.value = AuthPhase.SIGNED_OUT
        }
    }

    fun biometricLoginAvailable(context: Context): Boolean {
        if (!biometricEnabled.value) return false
        val mgr = BiometricManager.from(context)
        if (mgr.canAuthenticate(BIOMETRIC_STRONG) != BiometricManager.BIOMETRIC_SUCCESS) return false
        if (tokenStore.hasValidSession()) return true
        val biometricToken = tokenStore.readBiometricToken()
        return !biometricToken.isNullOrEmpty()
    }

    fun loginWithBiometric(activity: FragmentActivity, onResult: (Boolean) -> Unit) {
        val context = activity.applicationContext
        val mgr = BiometricManager.from(context)
        if (mgr.canAuthenticate(BIOMETRIC_STRONG) != BiometricManager.BIOMETRIC_SUCCESS) {
            onResult(false)
            return
        }

        val executor = ContextCompat.getMainExecutor(context)
        val promptInfo = BiometricPrompt.PromptInfo.Builder()
            .setTitle("Log in to Inventory")
            .setSubtitle("Use biometric to authenticate")
            .setNegativeButtonText("Cancel")
            .build()

        val biometricPrompt = BiometricPrompt(activity, executor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    viewModelScope.launch {
                        val success = doLoginWithBiometric()
                        onResult(success)
                    }
                }
                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    onResult(false)
                }
                override fun onAuthenticationFailed() {
                    // Do nothing, let user retry
                }
            })
        biometricPrompt.authenticate(promptInfo)
    }

    private suspend fun doLoginWithBiometric(): Boolean {
        // Path 1: valid session token
        if (tokenStore.hasValidSession()) {
            val token = tokenStore.readToken() ?: return false
            return try {
                ApiClient.setToken(token)
                refresh()
                didGoToBackground = false
                _phase.value = AuthPhase.SIGNED_IN
                true
            } catch (e: Exception) {
                ApiClient.setToken(null)
                false
            }
        }
        // Path 2: biometric token
        val biometricToken = tokenStore.readBiometricToken() ?: return false
        return try {
            val response = api().loginWithBiometricToken(mapOf("biometricToken" to biometricToken))
            ApiClient.setToken(response.token)
            tokenStore.saveToken(response.token)
            tokenStore.saveExpiresAt(response.expiresAt)
            _currentUser.value = response.currentUser
            refresh()
            didGoToBackground = false
            _phase.value = AuthPhase.SIGNED_IN
            true
        } catch (e: Exception) {
            ApiClient.setToken(null)
            false
        }
    }

    fun login(username: String, password: String) {
        viewModelScope.launch {
            authenticate {
                api().login(mapOf("username" to username, "password" to password))
            }
        }
    }

    fun register(username: String, password: String, confirmPassword: String, phone: String, phoneCountryCode: String = "+86") {
        viewModelScope.launch {
            authenticate {
                api().register(mapOf(
                    "username" to username,
                    "password" to password,
                    "confirmPassword" to confirmPassword,
                    "phone" to phone,
                    "phoneCountryCode" to phoneCountryCode
                ))
            }
        }
    }

    fun resetPassword(username: String, newPassword: String, confirmPassword: String, phone: String, phoneCountryCode: String = "+86") {
        viewModelScope.launch {
            authenticate {
                api().resetPassword(mapOf(
                    "username" to username,
                    "newPassword" to newPassword,
                    "confirmPassword" to confirmPassword,
                    "phone" to phone,
                    "phoneCountryCode" to phoneCountryCode
                ))
            }
        }
    }

    suspend fun verifyIdentity(username: String, name: String, phone: String) {
        api().verifyIdentity(mapOf("username" to username, "name" to name, "phone" to phone))
    }

    suspend fun loginStart(username: String): LoginStartResponse {
        return api().loginStart(mapOf("username" to username))
    }

    suspend fun forgotPassword(username: String) {
        try { api().forgotPassword(mapOf("username" to username)) } catch (_: Exception) {}
    }

    private suspend fun authenticate(block: suspend () -> AuthResponse) {
        try {
            val response = block()
            ApiClient.setToken(response.token)
            tokenStore.saveToken(response.token)
            tokenStore.saveExpiresAt(response.expiresAt)
            _currentUser.value = response.currentUser
            refresh()
            didGoToBackground = false
            didJustLogout = false
            _phase.value = AuthPhase.SIGNED_IN
            _errorMessage.value = null
            if (response.passwordExpired == true) {
                _needsPasswordChange.value = true
            } else {
                val asked = prefsStore.biometricEnrollmentAskedFlow.first()
                if (!asked) {
                    _showBiometricEnrollment.value = true
                }
            }
        } catch (e: Exception) {
            _errorMessage.value = parseError(e)
        }
    }

    suspend fun refresh() {
        _isRefreshing.value = true
        try {
            val response = api().bootstrap()
            _currentUser.value = response.currentUser
            _permissions.value = response.permissions
            _companies.value = response.warehouses
            _skus.value = response.skus
            _users.value = response.users ?: emptyList()
            _records.value = response.records
            _notifications.value = response.notifications
            _errorMessage.value = null
        } finally {
            _isRefreshing.value = false
        }
    }

    fun refreshAsync() {
        viewModelScope.launch {
            try { refresh() } catch (_: Exception) {}
        }
    }

    suspend fun lookupSKU(skuCode: String): SKUItem {
        val item = api().scan(skuCode).sku
        upsertSKU(item)
        return item
    }

    suspend fun runAction(action: SKUAction, skuCode: String): SKUItem {
        val body = mapOf("skuNumber" to skuCode)
        val updated = when (action) {
            SKUAction.BORROW -> api().borrow(body).sku
            SKUAction.RETURN_ITEM -> api().returnItem(body).sku
            SKUAction.REPAIR -> api().repair(body).sku
            SKUAction.REPAIRED -> api().returnAfterRepair(body).sku
        }
        upsertSKU(updated)
        try { refresh() } catch (_: Exception) {}
        return updated
    }

    fun findBySerial(serial: String): SKUItem? {
        val query = serial.trim().lowercase()
        if (query.isEmpty()) return null
        return _skus.value.firstOrNull { (it.serialNumber ?: "").lowercase().contains(query) }
    }

    suspend fun markNotificationRead(notification: NotificationItem) {
        if (notification.status != "unread") return
        try {
            val updated = api().markNotification(notification.id, mapOf("status" to "read")).notification
            val list = _notifications.value.toMutableList()
            val idx = list.indexOfFirst { it.id == updated.id }
            if (idx >= 0) list[idx] = updated
            _notifications.value = list
        } catch (e: Exception) {
            _errorMessage.value = parseError(e)
        }
    }

    fun logout() {
        val savedToken = tokenStore.readToken()
        tokenStore.deleteToken()
        tokenStore.deleteExpiresAt()
        ApiClient.setToken(null)
        _currentUser.value = null
        _permissions.value = null
        _companies.value = emptyList()
        _skus.value = emptyList()
        _users.value = emptyList()
        _records.value = emptyList()
        _notifications.value = emptyList()
        _needsPasswordChange.value = false
        _appLocked.value = false
        didGoToBackground = false
        didJustLogout = true
        _phase.value = AuthPhase.SIGNED_OUT

        if (savedToken != null) {
            viewModelScope.launch {
                if (biometricEnabled.value) {
                    try {
                        ApiClient.setToken(savedToken)
                        val result = api().extendSession(mapOf("biometric" to true))
                        result.biometricToken?.let { tokenStore.saveBiometricToken(it) }
                        ApiClient.setToken(null)
                    } catch (_: Exception) {
                        ApiClient.setToken(null)
                    }
                }
                try {
                    ApiClient.setToken(savedToken)
                    api().logout()
                } catch (_: Exception) {
                } finally {
                    ApiClient.setToken(null)
                }
            }
        }
    }

    // MARK: - App Lock

    fun appDidBackground() {
        lastBackgroundedAt = System.currentTimeMillis()
        didGoToBackground = true
        if (appLockEnabled.value && _phase.value == AuthPhase.SIGNED_IN && appLockDelay.value == AppLockDelay.IMMEDIATELY) {
            _appLocked.value = true
        }
    }

    fun appDidForeground() {
        // Read a fresh location on every foreground ("each use") and re-show the
        // nudge if permission still isn't granted.
        refreshLocationNudge()
        viewModelScope.launch { readLocation(); refreshGeoGate() }
        if (!appLockEnabled.value || _phase.value != AuthPhase.SIGNED_IN || !didGoToBackground) return
        didGoToBackground = false
        if (appLockDelay.value == AppLockDelay.IMMEDIATELY) return
        val elapsed = lastBackgroundedAt?.let { (System.currentTimeMillis() - it) / 1000L } ?: 0L
        if (elapsed >= appLockDelay.value.seconds) {
            _appLocked.value = true
        }
    }

    fun unlockApp(activity: FragmentActivity) {
        if (!biometricEnabled.value) {
            _appLocked.value = false
            return
        }
        val context = activity.applicationContext
        val mgr = BiometricManager.from(context)
        if (mgr.canAuthenticate(BIOMETRIC_STRONG) != BiometricManager.BIOMETRIC_SUCCESS) {
            _appLocked.value = false
            return
        }
        val executor = ContextCompat.getMainExecutor(context)
        val promptInfo = BiometricPrompt.PromptInfo.Builder()
            .setTitle("Unlock Inventory")
            .setSubtitle("Use biometric to unlock")
            .setNegativeButtonText("Cancel")
            .build()
        val biometricPrompt = BiometricPrompt(activity, executor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    _appLocked.value = false
                }
                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {}
                override fun onAuthenticationFailed() {}
            })
        biometricPrompt.authenticate(promptInfo)
    }

    // MARK: - Biometric enrollment

    fun enrollBiometric(activity: FragmentActivity) {
        _showBiometricEnrollment.value = false
        val context = activity.applicationContext
        val mgr = BiometricManager.from(context)
        if (mgr.canAuthenticate(BIOMETRIC_STRONG) != BiometricManager.BIOMETRIC_SUCCESS) return

        val executor = ContextCompat.getMainExecutor(context)
        val promptInfo = BiometricPrompt.PromptInfo.Builder()
            .setTitle("Enable Biometric Login")
            .setSubtitle("Enable biometric authentication for faster login")
            .setNegativeButtonText("Cancel")
            .build()
        val biometricPrompt = BiometricPrompt(activity, executor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    viewModelScope.launch {
                        try {
                            val res = api().extendSession(mapOf("biometric" to true))
                            tokenStore.saveExpiresAt(res.expiresAt)
                            res.biometricToken?.let { tokenStore.saveBiometricToken(it) }
                            prefsStore.setBiometricEnabled(true)
                            prefsStore.setBiometricEnrollmentAsked(true)
                        } catch (_: Exception) {}
                    }
                }
                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {}
                override fun onAuthenticationFailed() {}
            })
        biometricPrompt.authenticate(promptInfo)
    }

    fun skipBiometricEnrollment() {
        _showBiometricEnrollment.value = false
        viewModelScope.launch { prefsStore.setBiometricEnrollmentAsked(true) }
    }

    fun dismissBiometricEnrollment() {
        _showBiometricEnrollment.value = false
    }

    // MARK: - User CRUD

    suspend fun createUser(username: String, name: String, password: String = "", role: String, phone: String?, phoneCountryCode: String?, email: String?, warehouseIds: List<String> = emptyList(), branchIds: List<String> = emptyList()) {
        // Backend ignores the password and sets passwordResetRequired (user sets it on first login).
        val body = mutableMapOf<String, Any>("username" to username, "name" to name, "role" to role, "warehouseIds" to warehouseIds, "branchIds" to branchIds)
        phone?.let { body["phone"] = it }
        phoneCountryCode?.let { body["phoneCountryCode"] = it }
        email?.let { body["email"] = it }
        val user = api().createUser(body).user
        _users.value = _users.value + user
    }

    suspend fun updateUser(id: String, name: String, role: String, phone: String?, phoneCountryCode: String?, email: String?, isDisabled: Boolean, warehouseIds: List<String> = emptyList(), branchIds: List<String> = emptyList()) {
        val body = mutableMapOf<String, Any>("name" to name, "role" to role, "warehouseIds" to warehouseIds, "branchIds" to branchIds)
        phone?.let { body["phone"] = it }
        phoneCountryCode?.let { body["phoneCountryCode"] = it }
        email?.let { body["email"] = it }
        val updated = api().updateUser(id, body).user
        val list = _users.value.toMutableList()
        val idx = list.indexOfFirst { it.id == id }
        if (idx >= 0) list[idx] = updated else list.add(updated)
        _users.value = list
    }

    suspend fun disableUser(id: String) {
        val updated = api().disableUser(id).user
        replaceUser(updated)
    }

    suspend fun resumeUser(id: String) {
        val updated = api().resumeUser(id).user
        replaceUser(updated)
    }

    suspend fun resetPasswordRequired(id: String) {
        val updated = api().resetPasswordRequired(id).user
        replaceUser(updated)
    }

    private fun replaceUser(user: User) {
        val list = _users.value.toMutableList()
        val idx = list.indexOfFirst { it.id == user.id }
        if (idx >= 0) list[idx] = user else list.add(user)
        _users.value = list
    }

    // MARK: - Inventory Actions

    suspend fun createSKU(
        warehouseId: String, branchId: String, categoryId: String, locationId: String?,
        skuNumber: String, descriptionId: String?, descriptionText: String?, serialNumber: String?
    ): SKUItem {
        val body = mutableMapOf<String, Any?>(
            "warehouseId" to warehouseId, "branchId" to branchId,
            "categoryId" to categoryId, "skuNumber" to skuNumber
        )
        locationId?.let { body["locationId"] = it }
        descriptionId?.let { body["descriptionId"] = it }
        descriptionText?.let { body["descriptionText"] = it }
        serialNumber?.let { body["serialNumber"] = it }
        val item = api().createSKU(body).sku
        upsertSKU(item)
        return item
    }

    suspend fun updateSKU(
        id: String, categoryId: String, branchId: String, locationId: String?,
        skuNumber: String?, descriptionId: String?, descriptionText: String?, serialNumber: String?
    ): SKUItem {
        val body = mutableMapOf<String, Any?>(
            "categoryId" to categoryId, "branchId" to branchId,
            "locationId" to locationId,                   // null clears it (backend uses NSNull/null)
            "descriptionId" to descriptionId
        )
        skuNumber?.let { body["skuNumber"] = it }
        if (descriptionText != null) body["descriptionText"] = descriptionText
        serialNumber?.let { body["serialNumber"] = it }
        val item = api().updateSKU(id, body).sku
        upsertSKU(item)
        return item
    }

    // MARK: - Company / Branch / Location / Category management

    suspend fun createCompany(name: String, code: String) {
        val c = api().createCompany(mapOf("name" to name, "code" to code)).warehouse
        _companies.value = _companies.value + c
    }
    suspend fun updateCompany(id: String, name: String, code: String) {
        val c = api().updateCompany(id, mapOf("name" to name, "code" to code)).warehouse
        _companies.value = _companies.value.map { if (it.id == id) c else it }
    }
    suspend fun deleteCompany(id: String) {
        api().deleteCompany(id)
        _companies.value = _companies.value.filter { it.id != id }
    }

    suspend fun addBranch(companyId: String, name: String, endorserUserId: String?) {
        val branch = api().addBranch(companyId, mapOf("name" to name, "endorserUserId" to endorserUserId)).branch
        _companies.value = _companies.value.map { c ->
            if (c.id == companyId) c.copy(branches = c.branches + branch) else c
        }
    }
    suspend fun updateBranch(companyId: String, branchId: String, name: String, endorserUserId: String?) {
        val updated = api().updateBranch(companyId, branchId, mapOf("name" to name, "endorserUserId" to endorserUserId)).branch
        _companies.value = _companies.value.map { c ->
            if (c.id == companyId) c.copy(branches = c.branches.map { if (it.id == branchId) updated else it }) else c
        }
    }
    suspend fun deleteBranch(companyId: String, branchId: String) {
        api().deleteBranch(companyId, branchId)
        _companies.value = _companies.value.map { c ->
            if (c.id == companyId) c.copy(branches = c.branches.filter { it.id != branchId }) else c
        }
    }

    suspend fun addLocation(companyId: String, branchId: String, name: String) {
        val loc = api().addLocation(companyId, branchId, mapOf("name" to name)).location
        mutateBranch(companyId, branchId) { it.copy(locations = (it.locations ?: emptyList()) + loc) }
    }
    suspend fun updateLocation(companyId: String, branchId: String, locationId: String, name: String) {
        val loc = api().updateLocation(companyId, branchId, locationId, mapOf("name" to name)).location
        mutateBranch(companyId, branchId) { b ->
            b.copy(locations = (b.locations ?: emptyList()).map { if (it.id == locationId) loc else it })
        }
    }
    suspend fun deleteLocation(companyId: String, branchId: String, locationId: String) {
        api().deleteLocation(companyId, branchId, locationId)
        mutateBranch(companyId, branchId) { b ->
            b.copy(locations = (b.locations ?: emptyList()).filter { it.id != locationId })
        }
    }

    private fun mutateBranch(companyId: String, branchId: String, transform: (Park) -> Park) {
        _companies.value = _companies.value.map { c ->
            if (c.id == companyId) c.copy(branches = c.branches.map { if (it.id == branchId) transform(it) else it }) else c
        }
    }

    suspend fun createCategory(companyId: String, code: String, branchIds: List<String>) {
        val cat = api().createCategory(companyId, mapOf("code" to code, "branchIds" to branchIds)).category
        _companies.value = _companies.value.map { c -> if (c.id == companyId) c.copy(categories = c.categories + cat) else c }
    }
    suspend fun updateCategory(companyId: String, categoryId: String, code: String, branchIds: List<String>) {
        val cat = api().updateCategory(companyId, categoryId, mapOf("code" to code, "branchIds" to branchIds)).category
        _companies.value = _companies.value.map { c ->
            if (c.id == companyId) c.copy(categories = c.categories.map { if (it.id == categoryId) cat else it }) else c
        }
    }
    suspend fun deleteCategory(companyId: String, categoryId: String) {
        api().deleteCategory(companyId, categoryId)
        _companies.value = _companies.value.map { c ->
            if (c.id == companyId) c.copy(categories = c.categories.filter { it.id != categoryId }) else c
        }
    }

    // MARK: - Asset Check Forms

    suspend fun createAssetCheckForm(companyId: String, branchId: String, acfNo: String, signaturePng: String): AssetCheckForm {
        val form = api().createAssetCheckForm(mapOf(
            "companyId" to companyId, "branchId" to branchId, "acfNo" to acfNo, "signaturePng" to signaturePng
        )).form
        try { refresh() } catch (_: Exception) {}
        return form
    }
    suspend fun getAssetCheckForm(id: String): AssetCheckForm = api().getAssetCheckForm(id).form
    suspend fun signAssetCheckForm(id: String, signaturePng: String) {
        api().signAssetCheckForm(id, mapOf("signaturePng" to signaturePng)); try { refresh() } catch (_: Exception) {}
    }
    suspend fun denyAssetCheckForm(id: String, reason: String) {
        api().denyAssetCheckForm(id, mapOf("reason" to reason)); try { refresh() } catch (_: Exception) {}
    }
    suspend fun withdrawAssetCheckForm(id: String) {
        api().withdrawAssetCheckForm(id); try { refresh() } catch (_: Exception) {}
    }
    suspend fun resubmitAssetCheckForm(id: String, companyId: String, branchId: String, acfNo: String, signaturePng: String) {
        api().resubmitAssetCheckForm(id, mapOf(
            "companyId" to companyId, "branchId" to branchId, "acfNo" to acfNo, "signaturePng" to signaturePng
        )); try { refresh() } catch (_: Exception) {}
    }
    /** Downloads the role-appropriate file; returns (bytes, filename). */
    suspend fun downloadAssetCheckForm(id: String): Pair<ByteArray, String> {
        val resp = api().downloadAssetCheckForm(id)
        val body = resp.body() ?: throw Exception("Empty download")
        val disp = resp.headers()["Content-Disposition"] ?: ""
        val m = Regex("filename=\"([^\"]+)\"").find(disp)
        val name = m?.groupValues?.get(1) ?: "AssetCheckForm"
        return Pair(body.bytes(), name)
    }

    // MARK: - SMTP / Email settings

    suspend fun fetchSMTPSettings(): SMTPSettings =
        api().getNotificationSettings().notificationSettings.smtp ?: SMTPSettings()

    suspend fun updateSMTPSettings(s: SMTPSettings): SMTPSettings {
        val body = mapOf("smtp" to mapOf(
            "enabled" to s.enabled, "host" to s.host, "port" to s.port, "secure" to s.secure,
            "username" to s.username, "password" to s.password, "fromName" to s.fromName, "fromAddress" to s.fromAddress
        ))
        return api().updateNotificationSettings(body).notificationSettings.smtp ?: s
    }
    suspend fun testSMTP(to: String?): String {
        val body = mutableMapOf<String, Any?>()
        if (!to.isNullOrEmpty()) body["to"] = to
        val r = api().testSMTP(body)
        return r.message ?: if (r.ok) "Test email sent." else "Test failed."
    }

    // MARK: - Server nodes (bundled catalog + TCP latency)

    val serverNodes: List<ServerNodeInfo> = ServerNodeCatalog.nodes
    private val _nodeLatencies = MutableStateFlow<Map<String, Int?>>(emptyMap())
    val nodeLatencies: StateFlow<Map<String, Int?>> = _nodeLatencies.asStateFlow()
    private val _selectedNodeLabel = MutableStateFlow("")
    val selectedNodeLabel: StateFlow<String> = _selectedNodeLabel.asStateFlow()
    private val _measuringNodes = MutableStateFlow(false)
    val measuringNodes: StateFlow<Boolean> = _measuringNodes.asStateFlow()

    val recommendedNodeLabel: String?
        get() = _nodeLatencies.value.entries.mapNotNull { e -> e.value?.let { e.key to it } }.minByOrNull { it.second }?.first

    // Whether the first-launch server-selection screen has been completed (null
    // until prefs load → AppNavigation shows a spinner meanwhile).
    val firstNodeChosen: StateFlow<Boolean?> =
        prefsStore.firstNodeChosenFlow.map<Boolean, Boolean?> { it }
            .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    /** Lowest-latency reachable+selectable node; falls back to first reachable,
     *  then first selectable — so there's always a recommendation. */
    fun recommendedNode(): ServerNodeInfo? {
        val selectable = serverNodes.filter { nodeSelectable(it) }
        val reachable = selectable.filter { _nodeLatencies.value[it.label] != null }
        return reachable.minByOrNull { _nodeLatencies.value[it.label] ?: Int.MAX_VALUE }
            ?: reachable.firstOrNull() ?: selectable.firstOrNull()
    }

    fun syncSelectedNodeFromBaseUrl() {
        val current = ApiClient.getBaseUrl()
        _selectedNodeLabel.value = serverNodes.firstOrNull { it.url == current }?.label ?: serverNodes.firstOrNull()?.label ?: ""
    }

    private fun selectInternal(node: ServerNodeInfo) {
        _selectedNodeLabel.value = node.label
        updateApiBaseUrl(node.url)
    }

    /** User picked the "Recommended" option → auto-use the fastest node now and
     *  on every future launch (until they pin a specific one). */
    fun chooseRecommended() {
        viewModelScope.launch {
            prefsStore.setNodeAutoRecommend(true)
            prefsStore.setFirstNodeChosen(true)
            if (_nodeLatencies.value.isEmpty()) measureNow()
            recommendedNode()?.let { selectInternal(it) }
        }
    }

    /** User pinned a specific node → fixed to it on every launch until changed. */
    fun chooseSpecificNode(label: String) {
        val node = serverNodes.firstOrNull { it.label == label } ?: return
        if (!nodeSelectable(node)) return
        viewModelScope.launch {
            prefsStore.setNodeAutoRecommend(false)
            prefsStore.setFirstNodeChosen(true)
            selectInternal(node)
        }
    }

    /** Backwards-compatible single entry used by the in-app picker: treat picking
     *  the current recommended node as "recommended/auto", anything else as a pin. */
    fun selectServerNode(label: String) {
        if (label == recommendedNodeLabel) chooseRecommended() else chooseSpecificNode(label)
    }

    /** On launch: if in auto/recommended mode, measure and switch to the fastest
     *  node. If pinned, the persisted base URL is already in effect. */
    suspend fun applyNodePreferenceOnLaunch() {
        if (!prefsStore.nodeAutoRecommendFlow.first()) return
        if (_nodeLatencies.value.isEmpty()) measureNow()
        recommendedNode()?.let { selectInternal(it) }
    }

    fun measureNodeLatencies() {
        if (_measuringNodes.value) return
        viewModelScope.launch { measureNow() }
    }

    private suspend fun measureNow() = coroutineScope {
        _measuringNodes.value = true
        // Measure all nodes in PARALLEL — sequentially, offline nodes each burn the
        // full timeout and the total runs ~8s, long enough that login happens before
        // the fastest node is picked. In parallel it finishes in ~one timeout.
        val results = serverNodes.map { node ->
            async { node.label to measureLatency(node.url) }
        }.awaitAll().toMap()
        _nodeLatencies.value = results
        _measuringNodes.value = false
    }

    // MARK: - Geolocation (logging, region gating)

    private val _nodeRestricted = MutableStateFlow(false)
    val nodeRestricted: StateFlow<Boolean> = _nodeRestricted.asStateFlow()
    /** Drives the "please enable location" nudge shown on each launch/foreground
     *  while permission isn't granted (rendered above the app lock). */
    private val _showLocationNudge = MutableStateFlow(false)
    val showLocationNudge: StateFlow<Boolean> = _showLocationNudge.asStateFlow()
    private var ipCountry: String? = null
    private var gpsLat: Double? = null
    private var gpsLng: Double? = null

    // Runs initGeo() now that the geo StateFlows above are initialized (see the
    // note in the first init block).
    init { initGeo() }

    /** The China-routed nodes (China Mobile / CTExcel) — the only ones selectable under the restriction. */
    fun isChinaNode(label: String): Boolean = label.contains("CMLink") || label.contains("CTExcel")

    // Country/region grouping for the node picker, derived from the label.
    fun nodeRegion(label: String): String = when {
        isChinaNode(label) -> "China"
        label.contains("(HKG)") -> "Hong Kong"
        label.contains("(SJC)") -> "United States"
        label.contains("(Staging)") -> "Staging"
        else -> "Other"
    }
    val nodeRegionOrder = listOf("China", "Hong Kong", "United States", "Staging", "Other")
    // Geofence removed — every node is always selectable regardless of location.
    fun nodeSelectable(node: ServerNodeInfo): Boolean = true

    fun hasLocationPermission(): Boolean {
        val ctx = getApplication<Application>()
        return ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
    }

    /** Show the nudge whenever location isn't granted. */
    fun refreshLocationNudge() { _showLocationNudge.value = !hasLocationPermission() }
    fun dismissLocationNudge() { _showLocationNudge.value = false }

    /** Read location, capture it for logging, and evaluate the nudge — on launch. */
    fun initGeo() {
        refreshLocationNudge()
        viewModelScope.launch {
            readLocation()
            refreshGeoGate()
        }
    }

    /** Called after the OS location-permission dialog resolves (allow or deny). */
    fun onLocationPermissionResult() {
        refreshLocationNudge()
        viewModelScope.launch {
            readLocation()
            refreshGeoGate()
        }
    }

    /** Actively request a fresh location fix (not just last-known, which is often
     *  null). Uses the platform LocationManager — no Google Play Services
     *  dependency, so it also works on China devices without GMS. */
    @SuppressLint("MissingPermission")
    fun readLocation() {
        if (!hasLocationPermission()) return
        val ctx = getApplication<Application>()
        val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return
        // Seed immediately with the most recent last-known fix.
        var best: Location? = null
        for (p in lm.getProviders(true)) {
            val loc = try { lm.getLastKnownLocation(p) } catch (e: SecurityException) { null } ?: continue
            if (best == null || loc.time > best!!.time) best = loc
        }
        best?.let { applyLocation(it) }
        // Then actively request one fresh fix.
        val provider = when {
            lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER) -> LocationManager.NETWORK_PROVIDER
            lm.isProviderEnabled(LocationManager.GPS_PROVIDER) -> LocationManager.GPS_PROVIDER
            else -> return
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                lm.getCurrentLocation(provider, null, ctx.mainExecutor) { loc ->
                    loc?.let { applyLocation(it); viewModelScope.launch { refreshGeoGate() } }
                }
            } else {
                @Suppress("DEPRECATION")
                lm.requestSingleUpdate(provider, object : LocationListener {
                    override fun onLocationChanged(loc: Location) { applyLocation(loc); viewModelScope.launch { refreshGeoGate() } }
                    override fun onProviderEnabled(p: String) {}
                    override fun onProviderDisabled(p: String) {}
                    @Deprecated("deprecated") override fun onStatusChanged(p: String?, s: Int, e: Bundle?) {}
                }, Looper.getMainLooper())
            }
        } catch (e: Exception) { /* keep seeded last-known */ }
    }

    private fun applyLocation(loc: Location) {
        gpsLat = loc.latitude
        gpsLng = loc.longitude
        // Capture the coordinate for per-operation logging (X-Client-Geo).
        ApiClient.setClientGeo(String.format(java.util.Locale.US, "%.5f,%.5f", loc.latitude, loc.longitude))
    }

    suspend fun refreshGeoGate() {
        // Kept for informational logging only; no longer gates node selection.
        ipCountry = try { api().geo().country } catch (e: Exception) { ipCountry }
    }

    // MARK: - Staff directory (local, for user-create autocomplete + forced match)

    private val gson = com.google.gson.Gson()
    private val _staffDirectory = MutableStateFlow<StaffDirectory?>(null)
    val staffDirectory: StateFlow<StaffDirectory?> = _staffDirectory.asStateFlow()

    private fun loadStaffDirectory() {
        viewModelScope.launch {
            prefsStore.staffDirectoryFlow.collect { json ->
                _staffDirectory.value = json?.let { try { gson.fromJson(it, StaffDirectory::class.java) } catch (e: Exception) { null } }
            }
        }
    }

    /// Parse a staff file (XLSX/CSV) into entries WITHOUT saving — for the import preview.
    suspend fun parseStaffEntries(context: Context, uri: android.net.Uri): List<StaffEntry> {
        val name = queryDisplayName(context, uri).lowercase()
        val bytes = withContext(Dispatchers.IO) { context.contentResolver.openInputStream(uri)?.use { it.readBytes() } } ?: throw Exception("Cannot read file")
        return if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
            val b64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
            api().parseStaffXLSX(mapOf("fileBase64" to b64)).entries.map { StaffEntry("", it.name, it.phone?.ifEmpty { null }, it.email?.ifEmpty { null }) }
        } else {
            parseCsv(String(bytes, Charsets.UTF_8))
        }
    }

    /// Replace the staff directory with the confirmed entries.
    fun applyStaffDirectory(entries: List<StaffEntry>) {
        val dir = StaffDirectory(entries, System.currentTimeMillis())
        _staffDirectory.value = dir
        viewModelScope.launch { prefsStore.setStaffDirectory(gson.toJson(dir)) }
    }

    /// Compare imported entries vs the current directory (matched by name).
    fun diffStaffImport(entries: List<StaffEntry>): StaffImportDiff {
        fun norm(s: String) = s.trim().lowercase()
        val existing = (_staffDirectory.value?.entries ?: emptyList()).associateBy { norm(it.name) }
        val added = mutableListOf<StaffEntry>()
        val updated = mutableListOf<StaffImportChange>()
        val unchanged = mutableListOf<StaffEntry>()
        for (e in entries) {
            val old = existing[norm(e.name)]
            if (old == null) added.add(e)
            else if ((old.phone ?: "") == (e.phone ?: "") && (old.email ?: "") == (e.email ?: "")) unchanged.add(e)
            else updated.add(StaffImportChange(old, e))
        }
        return StaffImportDiff(added, updated, unchanged, entries)
    }

    // Kept for compatibility: parse + immediately apply (no preview).
    suspend fun importStaffDirectory(context: Context, uri: android.net.Uri) {
        applyStaffDirectory(parseStaffEntries(context, uri))
    }

    fun clearStaffDirectory() {
        viewModelScope.launch { prefsStore.setStaffDirectory(null) }
        _staffDirectory.value = null
    }

    // MARK: - Inventory import (Asset Check Form)

    suspend fun importParse(context: Context, uri: android.net.Uri, companyId: String, branchId: String): ImportDiff {
        val bytes = withContext(Dispatchers.IO) { context.contentResolver.openInputStream(uri)?.use { it.readBytes() } } ?: throw Exception("Cannot read file")
        val b64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
        return api().importParse(mapOf("companyId" to companyId, "branchId" to branchId, "fileBase64" to b64))
    }

    suspend fun importApply(companyId: String, branchId: String, create: List<ImportNewItem>, update: List<ImportMismatch>, place: List<Map<String, Any>> = emptyList()): ImportApplyResult {
        val createBody = create.map { mapOf("assetId" to it.assetId, "description" to it.description, "serial" to it.serial, "location" to it.location) }
        val updateBody = update.map { mapOf("skuId" to it.skuId, "assetId" to it.assetId, "description" to it.description, "serial" to it.serial, "location" to it.location) }
        val result = api().importApply(mapOf("companyId" to companyId, "branchId" to branchId, "create" to createBody, "update" to updateBody, "place" to place))
        refresh()
        return result
    }

    private fun queryDisplayName(context: Context, uri: android.net.Uri): String {
        return try {
            context.contentResolver.query(uri, null, null, null, null)?.use { c ->
                val idx = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                if (c.moveToFirst() && idx >= 0) c.getString(idx) else uri.lastPathSegment ?: ""
            } ?: (uri.lastPathSegment ?: "")
        } catch (e: Exception) { uri.lastPathSegment ?: "" }
    }

    private fun parseCsv(raw: String): List<StaffEntry> {
        val lines = raw.split("\n", "\r\n", "\r").filter { it.isNotBlank() }
        if (lines.isEmpty()) return emptyList()
        val header = lines[0].split(",").map { it.trim().lowercase() }
        val nameIdx = header.indexOfFirst { it == "name" || it.contains("姓名") || it.contains("名字") }.let { if (it >= 0) it else 0 }
        val phoneIdx = header.indexOfFirst { it.contains("phone") || it.contains("电话") || it.contains("手机") }
        val emailIdx = header.indexOfFirst { it.contains("email") || it.contains("邮箱") || it.contains("mail") }
        return lines.drop(1).mapNotNull { line ->
            val cols = line.split(",").map { it.trim() }
            val n = cols.getOrNull(nameIdx)?.takeIf { it.isNotEmpty() } ?: return@mapNotNull null
            StaffEntry("", n, phoneIdx.takeIf { it >= 0 }?.let { cols.getOrNull(it) }?.ifEmpty { null },
                emailIdx.takeIf { it >= 0 }?.let { cols.getOrNull(it) }?.ifEmpty { null })
        }
    }

    fun lookupStaffEntry(name: String): StaffEntry? {
        val n = name.trim().lowercase()
        if (n.isEmpty()) return null
        return _staffDirectory.value?.entries?.firstOrNull { it.name.trim().lowercase() == n }
    }

    fun staffSuggestions(query: String, limit: Int = 6): List<StaffEntry> {
        val q = query.trim().lowercase()
        val entries = _staffDirectory.value?.entries ?: return emptyList()
        if (q.isEmpty()) return emptyList()
        return entries.filter { it.name.lowercase().contains(q) || (it.phone ?: "").lowercase().contains(q) }
            .sortedWith(compareByDescending<StaffEntry> { it.name.lowercase().startsWith(q) }.thenBy { it.name.length }.thenBy { it.name.lowercase() })
            .take(limit)
    }

    /** TCP connect time in ms to the URL's host:port (443 https / 80 http), or null on failure. */
    private suspend fun measureLatency(url: String): Int? = withContext(Dispatchers.IO) {
        try {
            val u = java.net.URI(url)
            val host = u.host ?: return@withContext null
            val port = if (u.port != -1) u.port else if (u.scheme == "http") 80 else 443
            val socket = java.net.Socket()
            val start = System.nanoTime()
            socket.connect(java.net.InetSocketAddress(host, port), 2500)
            val ms = ((System.nanoTime() - start) / 1_000_000).toInt()
            socket.close()
            ms
        } catch (e: Exception) { null }
    }

    suspend fun requestRepair(skuCode: String, reason: String, destination: String): SKUItem {
        val item = api().repair(mapOf("skuNumber" to skuCode, "reason" to reason, "destination" to destination)).sku
        upsertSKU(item)
        try { refresh() } catch (_: Exception) {}
        return item
    }

    suspend fun requestTransfer(skuCode: String, toBranchId: String, reason: String): SKUItem {
        val item = api().transfer(mapOf("skuNumber" to skuCode, "toBranchId" to toBranchId, "reason" to reason)).sku
        upsertSKU(item)
        try { refresh() } catch (_: Exception) {}
        return item
    }

    suspend fun requestDisposal(skuCode: String, reason: String, netBookValue: String): SKUItem {
        val item = api().disposal(mapOf("skuNumber" to skuCode, "reason" to reason, "netBookValue" to netBookValue)).sku
        upsertSKU(item)
        try { refresh() } catch (_: Exception) {}
        return item
    }

    // MARK: - Notifications

    suspend fun reviewNotification(id: String, approved: Boolean, reviewNote: String?) {
        val body = mutableMapOf<String, Any>("status" to if (approved) "approved" else "denied")
        reviewNote?.let { body["reviewNote"] = it }
        val updated = api().reviewNotification(id, body).notification
        val list = _notifications.value.toMutableList()
        val idx = list.indexOfFirst { it.id == updated.id }
        if (idx >= 0) list[idx] = updated
        _notifications.value = list
    }

    // MARK: - User Logs

    suspend fun fetchUserLogs() {
        val logs = api().getUserLogs().userLogs
        _userLogs.value = logs
    }

    // MARK: - Password

    suspend fun changePassword(currentPassword: String, newPassword: String, confirmPassword: String) {
        api().changePassword(mapOf(
            "currentPassword" to currentPassword,
            "newPassword" to newPassword,
            "confirmPassword" to confirmPassword
        ))
        _needsPasswordChange.value = false
    }

    // MARK: - Settings

    fun updateTheme(theme: ThemeOption) {
        viewModelScope.launch { prefsStore.setTheme(theme) }
    }

    fun updateLanguage(language: LanguageOption) {
        viewModelScope.launch { prefsStore.setLanguage(language) }
    }

    fun updateApiBaseUrl(url: String) {
        val trimmed = url.trim()
        if (trimmed.isEmpty()) return
        viewModelScope.launch {
            prefsStore.setApiBaseUrl(trimmed)
            ApiClient.setBaseUrl(trimmed)
        }
    }

    fun updateAppLockEnabled(enabled: Boolean) {
        viewModelScope.launch { prefsStore.setAppLockEnabled(enabled) }
    }

    fun updateAppLockDelay(delay: AppLockDelay) {
        viewModelScope.launch { prefsStore.setAppLockDelay(delay) }
    }

    fun updateBiometricEnabled(enabled: Boolean) {
        viewModelScope.launch {
            prefsStore.setBiometricEnabled(enabled)
            if (!enabled) prefsStore.setAppLockEnabled(false)
        }
    }

    fun updateNotificationsEnabled(enabled: Boolean) {
        viewModelScope.launch { prefsStore.setNotificationsEnabled(enabled) }
    }

    fun clearError() {
        _errorMessage.value = null
    }

    fun setError(msg: String) {
        _errorMessage.value = msg
    }

    // MARK: - Helpers

    private fun upsertSKU(item: SKUItem) {
        val list = _skus.value.toMutableList()
        val idx = list.indexOfFirst { it.id == item.id }
        if (idx >= 0) list[idx] = item else list.add(0, item)
        _skus.value = list
    }

    private fun parseError(e: Exception): String {
        return when (e) {
            is HttpException -> {
                try {
                    val body = e.response()?.errorBody()?.string()
                    if (body != null) {
                        val gson = com.google.gson.Gson()
                        val payload = gson.fromJson(body, APIErrorPayload::class.java)
                        payload?.error ?: "Request failed with status ${e.code()}"
                    } else "Request failed with status ${e.code()}"
                } catch (_: Exception) {
                    "Request failed with status ${e.code()}"
                }
            }
            is IOException -> "Network error: ${e.message}"
            else -> e.message ?: "An unknown error occurred"
        }
    }

    fun hasBiometricHardware(context: Context): Boolean {
        val mgr = BiometricManager.from(context)
        return mgr.canAuthenticate(BIOMETRIC_STRONG) != BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED ||
               mgr.canAuthenticate(BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS ||
               mgr.canAuthenticate(BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED
    }
}
