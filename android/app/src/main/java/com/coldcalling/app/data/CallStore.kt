package com.coldcalling.app.data

import android.content.Context
import android.content.SharedPreferences
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken

object CallStore {
    private const val PREFS_NAME = "cold_calling_calls_db"
    private const val KEY_CALLS = "calls_list"
    private const val KEY_DRIVE_WEBHOOK = "drive_webhook_url"
    private const val KEY_FOLDER_ID = "drive_folder_id"
    private const val KEY_AUTO_UPLOAD = "auto_upload_enabled"
    private const val KEY_LEAD_MAP = "crm_lead_phone_map"

    private const val KEY_EXCEPTION_LIST = "exception_phone_numbers"
    private const val KEY_RECORDING_PAUSED = "recording_paused_banking_mode"
    const val DEFAULT_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbyCDb9IWz05Ie9_qF_OeLCgQiwBXn5oDbHP4WWp71q6i-K-n4sLPTFYpl7rBdJFc2eS/exec"

    private val gson = Gson()

    @Synchronized
    fun getCalls(context: Context): MutableList<CallItem> {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val json = prefs.getString(KEY_CALLS, null) ?: return mutableListOf()
        val type = object : TypeToken<MutableList<CallItem>>() {}.type
        return try {
            val raw: MutableList<CallItem> = gson.fromJson(json, type) ?: mutableListOf()
            raw.distinctBy { it.audioFilePath?.ifBlank { null } ?: it.id }.toMutableList()
        } catch (e: Exception) {
            mutableListOf()
        }
    }

    @Synchronized
    fun saveCall(context: Context, item: CallItem): CallItem {
        val list = getCalls(context)
        val existingIndex = list.indexOfFirst {
            it.id == item.id || (!item.audioFilePath.isNullOrBlank() && it.audioFilePath == item.audioFilePath)
        }
        val savedItem = if (existingIndex >= 0) {
            val prev = list[existingIndex]
            val status = when {
                item.uploadStatus == UploadStatus.SKIPPED -> UploadStatus.SKIPPED
                prev.uploadStatus == UploadStatus.SKIPPED && item.uploadStatus != UploadStatus.UPLOADED -> UploadStatus.SKIPPED
                prev.uploadStatus == UploadStatus.UPLOADED -> UploadStatus.UPLOADED
                else -> item.uploadStatus
            }
            val merged = item.copy(
                id = prev.id,
                driveUrl = if (status == UploadStatus.SKIPPED) null else (item.driveUrl ?: prev.driveUrl),
                uploadStatus = status,
                leadId = if (status == UploadStatus.SKIPPED) null else (item.leadId ?: prev.leadId),
                leadName = item.leadName ?: prev.leadName,
                userId = item.userId ?: prev.userId,
                outcome = if (item.outcome.isNotBlank() && item.outcome != "Connected") item.outcome else prev.outcome
            )
            list[existingIndex] = merged
            merged
        } else {
            list.add(0, item)
            item
        }
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_CALLS, gson.toJson(list)).apply()
        return savedItem
    }

    @Synchronized
    fun updateCallStatus(context: Context, id: String, status: UploadStatus, driveUrl: String?) {
        val list = getCalls(context)
        val item = list.find { it.id == id } ?: return
        item.uploadStatus = status
        if (driveUrl != null) {
            item.driveUrl = driveUrl
        }
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_CALLS, gson.toJson(list)).apply()
    }

    @Synchronized
    fun updateCallDetails(
        context: Context,
        id: String,
        status: UploadStatus,
        driveUrl: String?,
        leadId: String?,
        leadName: String?
    ) {
        val list = getCalls(context)
        val item = list.find { it.id == id } ?: return
        item.uploadStatus = status
        if (driveUrl != null) item.driveUrl = driveUrl
        if (leadId != null) item.leadId = leadId
        if (leadName != null) item.leadName = leadName
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_CALLS, gson.toJson(list)).apply()
    }

    fun saveLeadPhoneMap(context: Context, map: Map<String, String>) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_LEAD_MAP, gson.toJson(map)).apply()
    }

    fun getLeadMap(context: Context): Map<String, String> {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val json = prefs.getString(KEY_LEAD_MAP, null) ?: return emptyMap()
        val type = object : TypeToken<Map<String, String>>() {}.type
        return try {
            gson.fromJson(json, type) ?: emptyMap()
        } catch (e: Exception) {
            emptyMap()
        }
    }

    fun getLeadNameForPhone(context: Context, rawNumber: String): String? {
        val map = getLeadMap(context)
        if (map.isEmpty()) return null
        val digits = rawNumber.filter { it.isDigit() }
        val norm10 = if (digits.length >= 10) digits.takeLast(10) else digits
        if (map.containsKey(norm10)) return map[norm10]
        if (map.containsKey(digits)) return map[digits]
        for ((key, value) in map) {
            if (digits.endsWith(key) || key.endsWith(digits)) return value
        }
        return null
    }

    fun isLeadOrTeammate(context: Context, rawNumber: String): Boolean {
        val trimmed = rawNumber.trim()
            .removePrefix("in_").removePrefix("IN_")
            .removePrefix("out_").removePrefix("OUT_")
        if (trimmed.isBlank() ||
            trimmed.equals("Unknown", ignoreCase = true) ||
            trimmed.equals("Recent Call", ignoreCase = true)
        ) {
            return false
        }
        return getLeadNameForPhone(context, trimmed) != null
    }

    fun getDriveWebhookUrl(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val url = prefs.getString(KEY_DRIVE_WEBHOOK, "") ?: ""
        return if (url.isBlank()) DEFAULT_WEBHOOK_URL else url
    }

    fun setDriveWebhookUrl(context: Context, url: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_DRIVE_WEBHOOK, url.trim()).apply()
    }

    fun getDriveFolderId(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_FOLDER_ID, "") ?: ""
    }

    fun setDriveFolderId(context: Context, folderId: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_FOLDER_ID, folderId.trim()).apply()
    }

    fun isAutoUploadEnabled(context: Context): Boolean {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getBoolean(KEY_AUTO_UPLOAD, true)
    }

    fun setAutoUploadEnabled(context: Context, enabled: Boolean) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putBoolean(KEY_AUTO_UPLOAD, enabled).apply()
    }

    fun isRecordingPaused(context: Context): Boolean {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getBoolean(KEY_RECORDING_PAUSED, false)
    }

    fun setRecordingPaused(context: Context, paused: Boolean) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putBoolean(KEY_RECORDING_PAUSED, paused).apply()
    }

    fun getExceptionList(context: Context): Set<String> {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getStringSet(KEY_EXCEPTION_LIST, emptySet()) ?: emptySet()
    }

    fun addExceptionNumber(context: Context, number: String) {
        val cleanNumber = number.trim()
        if (cleanNumber.isEmpty()) return
        val current = getExceptionList(context).toMutableSet()
        current.add(cleanNumber)
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putStringSet(KEY_EXCEPTION_LIST, current).apply()
    }

    fun removeExceptionNumber(context: Context, number: String) {
        val current = getExceptionList(context).toMutableSet()
        current.remove(number.trim())
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putStringSet(KEY_EXCEPTION_LIST, current).apply()
    }

    fun isNumberExcluded(context: Context, rawNumber: String): Boolean {
        val list = getExceptionList(context)
        if (list.isEmpty()) return false
        val digitsOnly = rawNumber.filter { it.isDigit() }
        for (item in list) {
            val itemDigits = item.filter { it.isDigit() }
            if (itemDigits.isNotEmpty() && digitsOnly.isNotEmpty()) {
                if (digitsOnly == itemDigits) {
                    return true
                }
                if (digitsOnly.length >= 7 && itemDigits.length >= 7) {
                    if (digitsOnly.endsWith(itemDigits) || itemDigits.endsWith(digitsOnly)) {
                        return true
                    }
                }
            } else if (rawNumber.equals(item, ignoreCase = true)) {
                return true
            }
        }
        return false
    }
}
