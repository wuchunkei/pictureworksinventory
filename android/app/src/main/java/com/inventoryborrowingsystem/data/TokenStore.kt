package com.inventoryborrowingsystem.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

class TokenStore(context: Context) {

    private val prefs: SharedPreferences by lazy {
        try {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            EncryptedSharedPreferences.create(
                context,
                "inventory_secure_prefs",
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        } catch (e: Exception) {
            // Fallback to regular prefs if encryption fails (e.g., on emulator)
            context.getSharedPreferences("inventory_prefs_fallback", Context.MODE_PRIVATE)
        }
    }

    companion object {
        private const val KEY_TOKEN = "auth_token"
        private const val KEY_EXPIRES_AT = "token_expires_at"
        private const val KEY_BIOMETRIC_TOKEN = "biometric_token"

        private val iso8601Format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }

        private val iso8601FormatAlt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }

        fun parseIso8601(dateStr: String): Date? {
            return try {
                iso8601Format.parse(dateStr)
            } catch (e: Exception) {
                try {
                    iso8601FormatAlt.parse(dateStr)
                } catch (e2: Exception) {
                    null
                }
            }
        }
    }

    fun saveToken(token: String) {
        prefs.edit().putString(KEY_TOKEN, token).apply()
    }

    fun readToken(): String? = prefs.getString(KEY_TOKEN, null)

    fun deleteToken() {
        prefs.edit().remove(KEY_TOKEN).apply()
    }

    fun saveExpiresAt(expiresAt: String) {
        prefs.edit().putString(KEY_EXPIRES_AT, expiresAt).apply()
    }

    fun readExpiresAt(): Date? {
        val str = prefs.getString(KEY_EXPIRES_AT, null) ?: return null
        return parseIso8601(str)
    }

    fun deleteExpiresAt() {
        prefs.edit().remove(KEY_EXPIRES_AT).apply()
    }

    fun saveBiometricToken(token: String) {
        prefs.edit().putString(KEY_BIOMETRIC_TOKEN, token).apply()
    }

    fun readBiometricToken(): String? = prefs.getString(KEY_BIOMETRIC_TOKEN, null)

    fun deleteBiometricToken() {
        prefs.edit().remove(KEY_BIOMETRIC_TOKEN).apply()
    }

    fun hasValidSession(): Boolean {
        val token = readToken() ?: return false
        if (token.isEmpty()) return false
        val expiresAt = readExpiresAt() ?: return false
        return expiresAt.after(Date())
    }
}
