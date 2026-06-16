package com.inventoryborrowingsystem.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.*
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "inventory_preferences")

class PreferencesStore(private val context: Context) {

    companion object {
        val KEY_THEME = stringPreferencesKey("theme")
        val KEY_LANGUAGE = stringPreferencesKey("language")
        val KEY_API_BASE_URL = stringPreferencesKey("api_base_url")
        val KEY_APP_LOCK_ENABLED = booleanPreferencesKey("app_lock_enabled")
        val KEY_APP_LOCK_DELAY = stringPreferencesKey("app_lock_delay")
        val KEY_BIOMETRIC_ENABLED = booleanPreferencesKey("biometric_enabled")
        val KEY_BIOMETRIC_ENROLLMENT_ASKED = booleanPreferencesKey("biometric_enrollment_asked")
        val KEY_NOTIFICATIONS_ENABLED = booleanPreferencesKey("notifications_enabled")
        val KEY_STAFF_DIRECTORY = stringPreferencesKey("staff_directory")
        // Server-node selection: whether the first-launch picker was completed, and
        // whether we auto-use the lowest-latency (recommended) node each launch
        // (true) vs. a node the user pinned (false; its URL stays in KEY_API_BASE_URL).
        val KEY_FIRST_NODE_CHOSEN = booleanPreferencesKey("first_node_chosen")
        val KEY_NODE_AUTO_RECOMMEND = booleanPreferencesKey("node_auto_recommend")

        const val DEFAULT_API_BASE_URL = "https://inventory-cloudflare.wuchunkei.com/api"
    }

    val firstNodeChosenFlow: Flow<Boolean> = context.dataStore.data.map { it[KEY_FIRST_NODE_CHOSEN] ?: false }
    suspend fun setFirstNodeChosen(v: Boolean) {
        context.dataStore.edit { prefs -> prefs[KEY_FIRST_NODE_CHOSEN] = v }
    }

    val nodeAutoRecommendFlow: Flow<Boolean> = context.dataStore.data.map { it[KEY_NODE_AUTO_RECOMMEND] ?: false }
    suspend fun setNodeAutoRecommend(v: Boolean) {
        context.dataStore.edit { prefs -> prefs[KEY_NODE_AUTO_RECOMMEND] = v }
    }

    val staffDirectoryFlow: Flow<String?> = context.dataStore.data.map { it[KEY_STAFF_DIRECTORY] }
    suspend fun setStaffDirectory(json: String?) {
        context.dataStore.edit { prefs -> if (json == null) prefs.remove(KEY_STAFF_DIRECTORY) else prefs[KEY_STAFF_DIRECTORY] = json }
    }

    val themeFlow: Flow<ThemeOption> = context.dataStore.data.map { prefs ->
        ThemeOption.fromValue(prefs[KEY_THEME] ?: ThemeOption.SYSTEM.value)
    }

    val languageFlow: Flow<LanguageOption> = context.dataStore.data.map { prefs ->
        LanguageOption.fromValue(prefs[KEY_LANGUAGE] ?: LanguageOption.ENGLISH.value)
    }

    val apiBaseUrlFlow: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[KEY_API_BASE_URL] ?: DEFAULT_API_BASE_URL
    }

    val appLockEnabledFlow: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[KEY_APP_LOCK_ENABLED] ?: false
    }

    val appLockDelayFlow: Flow<AppLockDelay> = context.dataStore.data.map { prefs ->
        AppLockDelay.fromValue(prefs[KEY_APP_LOCK_DELAY] ?: AppLockDelay.IMMEDIATELY.value)
    }

    val biometricEnabledFlow: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[KEY_BIOMETRIC_ENABLED] ?: false
    }

    val biometricEnrollmentAskedFlow: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[KEY_BIOMETRIC_ENROLLMENT_ASKED] ?: false
    }

    val notificationsEnabledFlow: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[KEY_NOTIFICATIONS_ENABLED] ?: false
    }

    suspend fun setTheme(theme: ThemeOption) {
        context.dataStore.edit { prefs -> prefs[KEY_THEME] = theme.value }
    }

    suspend fun setLanguage(language: LanguageOption) {
        context.dataStore.edit { prefs -> prefs[KEY_LANGUAGE] = language.value }
    }

    suspend fun setApiBaseUrl(url: String) {
        context.dataStore.edit { prefs -> prefs[KEY_API_BASE_URL] = url }
    }

    suspend fun setAppLockEnabled(enabled: Boolean) {
        context.dataStore.edit { prefs -> prefs[KEY_APP_LOCK_ENABLED] = enabled }
    }

    suspend fun setAppLockDelay(delay: AppLockDelay) {
        context.dataStore.edit { prefs -> prefs[KEY_APP_LOCK_DELAY] = delay.value }
    }

    suspend fun setBiometricEnabled(enabled: Boolean) {
        context.dataStore.edit { prefs -> prefs[KEY_BIOMETRIC_ENABLED] = enabled }
    }

    suspend fun setBiometricEnrollmentAsked(asked: Boolean) {
        context.dataStore.edit { prefs -> prefs[KEY_BIOMETRIC_ENROLLMENT_ASKED] = asked }
    }

    suspend fun setNotificationsEnabled(enabled: Boolean) {
        context.dataStore.edit { prefs -> prefs[KEY_NOTIFICATIONS_ENABLED] = enabled }
    }
}
