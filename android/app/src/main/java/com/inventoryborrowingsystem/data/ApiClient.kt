package com.inventoryborrowingsystem.data

import com.google.gson.*
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.lang.reflect.Type
import java.util.concurrent.TimeUnit

class UserRoleDeserializer : JsonDeserializer<UserRole> {
    override fun deserialize(json: JsonElement, typeOfT: Type, context: JsonDeserializationContext): UserRole {
        return UserRole.fromValue(json.asString)
    }
}

class SKUStatusDeserializer : JsonDeserializer<SKUStatus> {
    override fun deserialize(json: JsonElement, typeOfT: Type, context: JsonDeserializationContext): SKUStatus {
        return SKUStatus.fromValue(json.asString)
    }
}

class UserRoleSerializer : JsonSerializer<UserRole> {
    override fun serialize(src: UserRole, typeOfSrc: Type, context: JsonSerializationContext): JsonElement {
        return JsonPrimitive(src.value)
    }
}

class SKUStatusSerializer : JsonSerializer<SKUStatus> {
    override fun serialize(src: SKUStatus, typeOfSrc: Type, context: JsonSerializationContext): JsonElement {
        return JsonPrimitive(src.value)
    }
}

object ApiClient {
    private var currentBaseUrl: String = PreferencesStore.DEFAULT_API_BASE_URL
    private var authToken: String? = null

    // "<lat>,<lng>" attached as X-Client-Geo to every request once the user has
    // consented and a fix is available. Read live by the interceptor, so changing
    // it does not require rebuilding the Retrofit service.
    @Volatile
    private var clientGeo: String? = null

    private val gson: Gson = GsonBuilder()
        .registerTypeAdapter(UserRole::class.java, UserRoleDeserializer())
        .registerTypeAdapter(UserRole::class.java, UserRoleSerializer())
        .registerTypeAdapter(SKUStatus::class.java, SKUStatusDeserializer())
        .registerTypeAdapter(SKUStatus::class.java, SKUStatusSerializer())
        .create()

    @Volatile
    private var _service: ApiService? = null

    private fun buildNormalizedUrl(base: String): String {
        val trimmed = base.trim()
        return if (trimmed.endsWith("/")) trimmed else "$trimmed/"
    }

    private fun createService(baseUrl: String, token: String?): ApiService {
        val loggingInterceptor = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BODY
        }

        val client = OkHttpClient.Builder()
            .addInterceptor(loggingInterceptor)
            .addInterceptor { chain ->
                val requestBuilder = chain.request().newBuilder()
                    .header("Content-Type", "application/json")
                    .header("Accept", "application/json")
                token?.let { requestBuilder.header("Authorization", "Bearer $it") }
                clientGeo?.let { requestBuilder.header("X-Client-Geo", it) }
                chain.proceed(requestBuilder.build())
            }
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build()

        return Retrofit.Builder()
            .baseUrl(buildNormalizedUrl(baseUrl))
            .client(client)
            .addConverterFactory(GsonConverterFactory.create(gson))
            .build()
            .create(ApiService::class.java)
    }

    fun getService(): ApiService {
        return _service ?: synchronized(this) {
            _service ?: createService(currentBaseUrl, authToken).also { _service = it }
        }
    }

    fun setBaseUrl(url: String) {
        if (url != currentBaseUrl) {
            currentBaseUrl = url
            _service = null
        }
    }

    fun setClientGeo(value: String?) {
        clientGeo = value
    }

    fun setToken(token: String?) {
        if (token != authToken) {
            authToken = token
            _service = null
        }
    }

    fun getBaseUrl(): String = currentBaseUrl
}
