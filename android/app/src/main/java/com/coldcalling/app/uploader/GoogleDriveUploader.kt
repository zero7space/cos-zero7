package com.coldcalling.app.uploader

import android.content.Context
import android.util.Base64
import android.util.Log
import com.coldcalling.app.data.CallItem
import com.coldcalling.app.data.CallStore
import com.coldcalling.app.data.UploadStatus
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.util.concurrent.TimeUnit

object GoogleDriveUploader {
    private const val TAG = "GoogleDriveUploader"

    private val client = OkHttpClient.Builder()
        .connectTimeout(60, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

    suspend fun uploadCallRecording(context: Context, callItem: CallItem): Result<String> = withContext(Dispatchers.IO) {
        val rawPhone = callItem.phone.trim()
        val cleanPhone = rawPhone
            .removePrefix("in_").removePrefix("IN_")
            .removePrefix("out_").removePrefix("OUT_")
            .ifBlank { rawPhone }

        // Strict Lead / Teammate Guard: Never upload non-leads or personal calls to Drive
        val isLeadOrTeammate = CallStore.isLeadOrTeammate(context, cleanPhone)
        if (!isLeadOrTeammate) {
            Log.i(TAG, "Number $cleanPhone is neither a registered CRM lead nor a team member. Google Drive upload excluded.")
            CallStore.updateCallDetails(
                context = context,
                id = callItem.id,
                status = UploadStatus.SKIPPED,
                driveUrl = null,
                leadId = null,
                leadName = null
            )
            return@withContext Result.success("Skipped: Number is not a CRM lead or team member")
        }

        val webhookUrl = CallStore.getDriveWebhookUrl(context)
        if (webhookUrl.isBlank()) {
            val msg = "Google Drive Webhook URL not configured. Configure it in Settings."
            Log.w(TAG, msg)
            CallStore.updateCallStatus(context, callItem.id, UploadStatus.FAILED, null)
            return@withContext Result.failure(Exception(msg))
        }

        val filePath = callItem.audioFilePath
        if (filePath.isNullOrEmpty()) {
            val msg = "No audio recording file available to upload."
            Log.w(TAG, msg)
            CallStore.updateCallStatus(context, callItem.id, UploadStatus.FAILED, null)
            return@withContext Result.failure(Exception(msg))
        }

        val file = File(filePath)
        if (!file.exists() || file.length() == 0L) {
            val msg = "Audio file not found or empty: $filePath"
            Log.e(TAG, msg)
            CallStore.updateCallStatus(context, callItem.id, UploadStatus.FAILED, null)
            return@withContext Result.failure(Exception(msg))
        }

        CallStore.updateCallStatus(context, callItem.id, UploadStatus.UPLOADING, null)

        try {
            val bytes = file.readBytes()
            val base64Data = Base64.encodeToString(bytes, Base64.NO_WRAP)
            val folderId = CallStore.getDriveFolderId(context)

            val jsonPayload = JsonObject().apply {
                addProperty("filename", file.name)
                addProperty("phone", callItem.phone)
                addProperty("duration", callItem.durationSeconds)
                addProperty("timestamp", callItem.timestamp)
                addProperty("folderId", folderId)
                addProperty("mimeType", getMimeType(file.name))
                addProperty("data", base64Data)
            }

            val requestBody = jsonPayload.toString().toRequestBody("application/json; charset=utf-8".toMediaType())
            val request = Request.Builder()
                .url(webhookUrl)
                .post(requestBody)
                .build()

            val response = client.newCall(request).execute()
            val responseBody = response.body?.string() ?: ""

            if (!response.isSuccessful) {
                val error = "Upload failed with HTTP ${response.code}: $responseBody"
                Log.e(TAG, error)
                CallStore.updateCallStatus(context, callItem.id, UploadStatus.FAILED, null)
                return@withContext Result.failure(Exception(error))
            }

            var driveFileUrl: String? = null
            try {
                val json = JsonParser.parseString(responseBody).asJsonObject
                if (json.has("fileUrl")) {
                    driveFileUrl = json.get("fileUrl").asString
                } else if (json.has("url")) {
                    driveFileUrl = json.get("url").asString
                } else if (json.has("link")) {
                    driveFileUrl = json.get("link").asString
                }
            } catch (e: Exception) {
                Log.w(TAG, "Could not parse JSON response, using fallback: $responseBody", e)
            }

            CallStore.updateCallStatus(context, callItem.id, UploadStatus.UPLOADED, driveFileUrl)
            Log.i(TAG, "Uploaded recording to Google Drive: ${file.name} -> $driveFileUrl")
            Result.success(driveFileUrl ?: "Uploaded")
        } catch (e: Exception) {
            Log.e(TAG, "Exception uploading to Google Drive", e)
            CallStore.updateCallStatus(context, callItem.id, UploadStatus.FAILED, null)
            Result.failure(e)
        }
    }

    suspend fun testConnection(webhookUrl: String): Result<String> = withContext(Dispatchers.IO) {
        try {
            val jsonPayload = JsonObject().apply {
                addProperty("test", true)
            }
            val body = jsonPayload.toString().toRequestBody("application/json; charset=utf-8".toMediaType())
            val request = Request.Builder()
                .url(webhookUrl)
                .post(body)
                .build()

            val response = client.newCall(request).execute()
            val respStr = response.body?.string() ?: ""
            if (response.isSuccessful) {
                Result.success("Connection successful! Server responded: $respStr")
            } else {
                Result.failure(Exception("HTTP ${response.code}: $respStr"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    private fun getMimeType(fileName: String): String {
        return when {
            fileName.endsWith(".opus", true) -> "audio/opus"
            fileName.endsWith(".ogg", true) || fileName.endsWith(".oga", true) -> "audio/ogg"
            fileName.endsWith(".m4a", true) || fileName.endsWith(".aac", true) -> "audio/mp4"
            fileName.endsWith(".amr", true) -> "audio/amr"
            fileName.endsWith(".flac", true) -> "audio/flac"
            fileName.endsWith(".wav", true) -> "audio/wav"
            else -> "audio/*"
        }
    }
}
