package com.coldcalling.app.auth

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

data class UserProfile(
    val id: String,
    val name: String,
    val email: String,
    val role: String,
    val phone: String? = null
)

object AuthManager {
    private const val TAG = "AuthManager"
    private const val PREFS_AUTH = "crm_auth_prefs"
    private const val KEY_TOKEN = "jwt_token"
    private const val KEY_USER_ID = "user_id"
    private const val KEY_USER_NAME = "user_name"
    private const val KEY_USER_EMAIL = "user_email"
    private const val KEY_USER_ROLE = "user_role"
    private const val KEY_USER_PHONE = "user_phone"
    private const val KEY_SERVER_URL = "crm_server_url"

    const val DEFAULT_SERVER_URL = "https://cos.zero7.space"

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    private fun getPrefs(context: Context): SharedPreferences {
        return context.getSharedPreferences(PREFS_AUTH, Context.MODE_PRIVATE)
    }

    fun isLoggedIn(context: Context): Boolean {
        val token = getToken(context)
        return !token.isNullOrBlank()
    }

    fun getToken(context: Context): String? {
        return getPrefs(context).getString(KEY_TOKEN, null)
    }

    fun getServerUrl(context: Context): String {
        val url = getPrefs(context).getString(KEY_SERVER_URL, null)
        return if (url.isNullOrBlank()) DEFAULT_SERVER_URL else url.trim().trimEnd('/')
    }

    fun setServerUrl(context: Context, url: String) {
        val clean = url.trim().trimEnd('/')
        getPrefs(context).edit().putString(KEY_SERVER_URL, clean).apply()
    }

    fun getCurrentUser(context: Context): UserProfile? {
        val prefs = getPrefs(context)
        val id = prefs.getString(KEY_USER_ID, null) ?: return null
        val name = prefs.getString(KEY_USER_NAME, "Agent") ?: "Agent"
        val email = prefs.getString(KEY_USER_EMAIL, "") ?: ""
        val role = prefs.getString(KEY_USER_ROLE, "member") ?: "member"
        val phone = prefs.getString(KEY_USER_PHONE, null)
        return UserProfile(id, name, email, role, phone)
    }

    fun saveSession(
        context: Context,
        token: String,
        id: String,
        name: String,
        email: String,
        role: String,
        serverUrl: String,
        phone: String? = null
    ) {
        val editor = getPrefs(context).edit()
            .putString(KEY_TOKEN, token)
            .putString(KEY_USER_ID, id)
            .putString(KEY_USER_NAME, name)
            .putString(KEY_USER_EMAIL, email)
            .putString(KEY_USER_ROLE, role)
            .putString(KEY_SERVER_URL, serverUrl.trim().trimEnd('/'))
        if (!phone.isNullOrBlank()) {
            editor.putString(KEY_USER_PHONE, phone.trim())
        } else {
            editor.remove(KEY_USER_PHONE)
        }
        editor.apply()
        Log.i(TAG, "Saved CRM session for $name ($role, phone: ${phone ?: "none"})")
    }

    fun logout(context: Context) {
        getPrefs(context).edit()
            .remove(KEY_TOKEN)
            .remove(KEY_USER_ID)
            .remove(KEY_USER_NAME)
            .remove(KEY_USER_EMAIL)
            .remove(KEY_USER_ROLE)
            .remove(KEY_USER_PHONE)
            .apply()
        Log.i(TAG, "Cleared user session")
    }

    suspend fun login(
        context: Context,
        emailInput: String,
        passwordInput: String,
        serverUrlInput: String
    ): Result<UserProfile> = withContext(Dispatchers.IO) {
        val serverUrl = if (serverUrlInput.isBlank()) DEFAULT_SERVER_URL else serverUrlInput.trim().trimEnd('/')
        val endpoint = "$serverUrl/api/auth/login"

        try {
            val jsonPayload = JsonObject().apply {
                addProperty("email", emailInput.trim())
                addProperty("password", passwordInput.trim())
            }

            val body = jsonPayload.toString().toRequestBody("application/json; charset=utf-8".toMediaType())
            val request = Request.Builder()
                .url(endpoint)
                .post(body)
                .build()

            val response = client.newCall(request).execute()
            val respStr = response.body?.string() ?: ""

            if (!response.isSuccessful) {
                val errorMsg = if (response.code == 401) {
                    "Invalid email or password. Please verify your credentials."
                } else {
                    "Server error (${response.code}): $respStr"
                }
                return@withContext Result.failure(Exception(errorMsg))
            }

            val root = JsonParser.parseString(respStr).asJsonObject
            val token = root.get("access_token")?.asString
                ?: root.get("token")?.asString
                ?: throw Exception("No access token returned from server")

            val userObj = root.getAsJsonObject("user")
            val id = userObj?.get("id")?.asString ?: "usr_unknown"
            val name = userObj?.get("name")?.asString ?: emailInput.substringBefore("@")
            val email = userObj?.get("email")?.asString ?: emailInput.trim()
            val role = userObj?.get("role")?.asString ?: "member"
            val phone = if (userObj?.has("phone") == true && !userObj.get("phone").isJsonNull) {
                userObj.get("phone").asString
            } else null

            val profile = UserProfile(id, name, email, role, phone)
            saveSession(context, token, id, name, email, role, serverUrl, phone)

            Result.success(profile)
        } catch (e: Exception) {
            Log.e(TAG, "Login exception: ${e.message}", e)
            Result.failure(e)
        }
    }
}
