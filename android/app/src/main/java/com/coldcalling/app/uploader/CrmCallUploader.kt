package com.coldcalling.app.uploader

import android.content.Context
import android.util.Log
import com.coldcalling.app.auth.AuthManager
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
import java.io.File
import java.util.concurrent.TimeUnit

object CrmCallUploader {
    private const val TAG = "CrmCallUploader"

    private val client = OkHttpClient.Builder()
        .connectTimeout(60, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .build()

    suspend fun uploadCallRecording(context: Context, callItem: CallItem): Result<String> = withContext(Dispatchers.IO) {
        val token = AuthManager.getToken(context)
        val serverUrl = AuthManager.getServerUrl(context)

        val rawPhone = callItem.phone.trim()
        val fileName = callItem.audioFilePath?.let { File(it).name } ?: ""
        val isIncoming = rawPhone.startsWith("in_", ignoreCase = true) || fileName.contains("_in_", ignoreCase = true)
        val cleanPhone = rawPhone
            .removePrefix("in_")
            .removePrefix("IN_")
            .removePrefix("out_")
            .removePrefix("OUT_")
            .ifBlank { rawPhone }
        val direction = if (isIncoming) "in" else "out"

        if (token.isNullOrBlank()) {
            val msg = "CRM authentication token missing. Please sign in to CRM."
            Log.w(TAG, msg)
            return@withContext if (CallStore.isLeadOrTeammate(context, cleanPhone)) {
                GoogleDriveUploader.uploadCallRecording(context, callItem)
            } else {
                CallStore.updateCallDetails(
                    context = context,
                    id = callItem.id,
                    status = UploadStatus.SKIPPED,
                    driveUrl = null,
                    leadId = null,
                    leadName = null
                )
                Result.success("Skipped: Number is not a CRM lead or team member")
            }
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

        // Reject blank or unresolved numbers immediately
        if (cleanPhone.isBlank() || cleanPhone.equals("Unknown", ignoreCase = true) || cleanPhone.equals("Recent Call", ignoreCase = true)) {
            Log.i(TAG, "Unresolved phone number '$cleanPhone'. Skipping audio upload.")
            CallStore.updateCallDetails(
                context = context,
                id = callItem.id,
                status = UploadStatus.SKIPPED,
                driveUrl = null,
                leadId = null,
                leadName = null
            )
            return@withContext Result.success("Skipped: Unresolved phone number")
        }

        // 1. Pre-flight lead check: don't upload audio for non-CRM numbers
        var cachedLeadName = CallStore.getLeadNameForPhone(context, cleanPhone)
        var verifiedLeadOrTeam = cachedLeadName != null
        if (!verifiedLeadOrTeam) {
            try {
                val encodedPhone = java.net.URLEncoder.encode(cleanPhone, "UTF-8")
                val checkReq = Request.Builder()
                    .url("$serverUrl/api/crm/leads/check-phone?phone=$encodedPhone")
                    .header("Authorization", "Bearer $token")
                    .get()
                    .build()
                val checkResp = client.newCall(checkReq).execute()
                if (checkResp.isSuccessful) {
                    val checkBody = checkResp.body?.string() ?: ""
                    val checkJson = JsonParser.parseString(checkBody).asJsonObject
                    val isLead = checkJson.has("is_lead") && !checkJson.get("is_lead").isJsonNull && checkJson.get("is_lead").asBoolean
                    val isTeammate = checkJson.has("is_teammate") && !checkJson.get("is_teammate").isJsonNull && checkJson.get("is_teammate").asBoolean

                    if (isTeammate && checkJson.has("teammate_name") && !checkJson.get("teammate_name").isJsonNull) {
                        cachedLeadName = "Team: " + checkJson.get("teammate_name").asString
                        verifiedLeadOrTeam = true
                    } else if (checkJson.has("lead_name") && !checkJson.get("lead_name").isJsonNull) {
                        cachedLeadName = checkJson.get("lead_name").asString
                        verifiedLeadOrTeam = true
                    } else if (isLead || isTeammate) {
                        verifiedLeadOrTeam = true
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "Pre-flight lead check exception: ${e.message}")
            }
        }

        if (!verifiedLeadOrTeam) {
            Log.i(TAG, "Number $cleanPhone is neither a registered CRM lead nor a team member. Skipping audio upload.")
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

        CallStore.updateCallStatus(context, callItem.id, UploadStatus.UPLOADING, null)

        try {
            val mimeType = getMimeType(file.name)
            val fileBody = file.asRequestBody(mimeType.toMediaType())

            val multipartBuilder = MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart("phone", cleanPhone)
                .addFormDataPart("duration_seconds", callItem.durationSeconds.toString())
                .addFormDataPart("called_at", callItem.timestamp.toString())
                .addFormDataPart("direction", direction)
                .addFormDataPart("outcome", callItem.outcome)
                .addFormDataPart("notes", "Recorded call via Zero7 Mobile App (${direction.uppercase()})")
                .addFormDataPart("recording", file.name, fileBody)

            val currentUser = AuthManager.getCurrentUser(context)
            if (currentUser != null) {
                multipartBuilder.addFormDataPart("user_id", currentUser.id)
                multipartBuilder.addFormDataPart("caller_name", currentUser.name)
                multipartBuilder.addFormDataPart("caller_email", currentUser.email)
                if (!currentUser.phone.isNullOrBlank()) {
                    multipartBuilder.addFormDataPart("caller_phone", currentUser.phone)
                }
            }

            val request = Request.Builder()
                .url("$serverUrl/api/crm/calls/mobile-sync")
                .header("Authorization", "Bearer $token")
                .post(multipartBuilder.build())
                .build()

            val response = client.newCall(request).execute()
            val responseBody = response.body?.string() ?: ""

            if (!response.isSuccessful) {
                val error = "CRM sync failed (HTTP ${response.code}): $responseBody"
                Log.e(TAG, error)
                CallStore.updateCallStatus(context, callItem.id, UploadStatus.FAILED, null)
                return@withContext Result.failure(Exception(error))
            }

            var driveUrl: String? = null
            var leadId: String? = null
            var leadName: String? = cachedLeadName

            try {
                val json = JsonParser.parseString(responseBody).asJsonObject
                val statusStr = if (json.has("status") && !json.get("status").isJsonNull) json.get("status").asString else ""
                val isLead = if (json.has("is_lead") && !json.get("is_lead").isJsonNull) json.get("is_lead").asBoolean else true
                val isInternal = if (json.has("is_internal") && !json.get("is_internal").isJsonNull) json.get("is_internal").asBoolean else false

                if (statusStr.equals("skipped", ignoreCase = true) || (!isLead && !isInternal)) {
                    Log.i(TAG, "Server skipped upload: $cleanPhone is not a CRM lead or team member.")
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

                if (isInternal && json.has("teammate_name") && !json.get("teammate_name").isJsonNull) {
                    leadName = "Team: " + json.get("teammate_name").asString
                }


                if (json.has("drive_url") && !json.get("drive_url").isJsonNull) {
                    driveUrl = json.get("drive_url").asString
                }
                if (json.has("lead_id") && !json.get("lead_id").isJsonNull) {
                    leadId = json.get("lead_id").asString
                }
                if (json.has("lead_name") && !json.get("lead_name").isJsonNull) {
                    leadName = json.get("lead_name").asString
                }
            } catch (e: Exception) {
                Log.w(TAG, "Could not parse JSON response from CRM: $responseBody", e)
            }

            CallStore.updateCallDetails(
                context = context,
                id = callItem.id,
                status = UploadStatus.UPLOADED,
                driveUrl = driveUrl,
                leadId = leadId,
                leadName = leadName
            )

            Log.i(TAG, "Successfully synced call to CRM: ${file.name} (Lead: $leadName, Drive: $driveUrl)")
            Result.success(driveUrl ?: "Synced with CRM")
        } catch (e: Exception) {
            Log.e(TAG, "Exception during CRM call upload", e)
            CallStore.updateCallStatus(context, callItem.id, UploadStatus.FAILED, null)
            Result.failure(e)
        }
    }

    suspend fun testConnection(context: Context): Result<String> = withContext(Dispatchers.IO) {
        val serverUrl = AuthManager.getServerUrl(context)
        val token = AuthManager.getToken(context)

        try {
            val requestBuilder = Request.Builder()
                .url("$serverUrl/api/health")
                .get()

            if (!token.isNullOrBlank()) {
                requestBuilder.header("Authorization", "Bearer $token")
            }

            val response = client.newCall(requestBuilder.build()).execute()
            val respStr = response.body?.string() ?: ""

            if (response.isSuccessful) {
                Result.success("Connected to CRM server! Status: $respStr")
            } else {
                Result.failure(Exception("HTTP ${response.code}: $respStr"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    private fun getMimeType(fileName: String): String {
        return when {
            fileName.endsWith(".ogg", true) || fileName.endsWith(".opus", true) || fileName.endsWith(".oga", true) -> "audio/ogg"
            fileName.endsWith(".m4a", true) || fileName.endsWith(".aac", true) -> "audio/mp4"
            fileName.endsWith(".mp3", true) -> "audio/mpeg"
            fileName.endsWith(".amr", true) -> "audio/amr"
            fileName.endsWith(".flac", true) -> "audio/flac"
            fileName.endsWith(".wav", true) -> "audio/wav"
            else -> "audio/ogg"
        }
    }
}
