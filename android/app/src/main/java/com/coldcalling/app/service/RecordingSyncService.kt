package com.coldcalling.app.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Environment
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import com.coldcalling.app.MainActivity
import com.coldcalling.app.data.CallItem
import com.coldcalling.app.data.CallStore
import com.coldcalling.app.uploader.GoogleDriveUploader
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.File
import java.util.UUID
import android.provider.CallLog
import org.json.JSONObject

import com.coldcalling.app.recording.RecordingForegroundService
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class RecordingSyncService : Service() {

    companion object {
        private const val TAG = "RecordingSyncService"
        const val EXTRA_PHONE = "extra_phone"
        const val EXTRA_DURATION = "extra_duration"
        const val EXTRA_CALL_START = "extra_call_start"
        const val ACTION_CALL_SYNCED = "com.coldcalling.app.CALL_SYNCED"
        private const val NOTIFICATION_ID = 2001
        private const val CHANNEL_ID = "recording_sync_channel"
        private val syncMutex = Mutex()

        fun isAudioFile(name: String): Boolean {
            val lower = name.lowercase()
            return lower.endsWith(".oga") || lower.endsWith(".opus") ||
                   lower.endsWith(".ogg") || lower.endsWith(".m4a") ||
                   lower.endsWith(".amr") || lower.endsWith(".flac") ||
                   lower.endsWith(".wav") || lower.endsWith(".aac")
        }

        suspend fun syncRecordings(
            context: Context,
            phone: String = "",
            duration: Int = 0,
            callStart: Long = 0,
            retries: Int = if (phone.isNotBlank() || callStart > 0) 5 else 1
        ) {
            syncMutex.withLock {
                try {
                    for (attempt in 1..retries) {
                        if (attempt == 1 && (phone.isNotBlank() || callStart > 0)) {
                            delay(2500) // Give recorder time to finalize audio container
                        } else if (attempt > 1) {
                            delay(1500)
                        }

                        if (RecordingForegroundService.isRecording) {
                            Log.d(TAG, "Skipping sync pass while RecordingForegroundService is actively recording")
                            continue
                        }

                        val rawDirs = listOfNotNull(
                            context.getExternalFilesDir(null)?.let { File(it, "Recordings") },
                            File(Environment.getExternalStorageDirectory(), "Documents"),
                            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS),
                            File("/storage/emulated/0/Documents"),
                            File(Environment.getExternalStorageDirectory(), "Recordings"),
                            File(Environment.getExternalStorageDirectory(), "Music/Recordings"),
                            File("/storage/emulated/0/Recordings"),
                            File("/storage/emulated/0/Android/data/com.chiller3.bcr/files")
                        )
                        val possibleDirs = rawDirs.distinctBy {
                            try { it.canonicalPath } catch (_: Exception) { it.absolutePath }
                        }

                        val existingCalls = CallStore.getCalls(context)
                        val existingPaths = existingCalls.mapNotNull { it.audioFilePath }.toMutableSet()
                        var newlySavedCount = 0

                        for (dir in possibleDirs) {
                            if (!dir.exists() || !dir.isDirectory) continue
                            val files = dir.listFiles() ?: continue

                            // Sort newest first
                            val audioFiles = files.filter {
                                it.isFile &&
                                isAudioFile(it.name) &&
                                it.length() > 0 &&
                                it.absolutePath != RecordingForegroundService.activeRecordingPath
                            }.sortedByDescending { it.lastModified() }

                            for (audioFile in audioFiles) {
                                if (existingPaths.contains(audioFile.absolutePath)) {
                                    continue
                                }

                                // We found a new recording not yet in CallStore
                                var resolvedPhone = phone
                                var resolvedDuration = duration
                                var resolvedTimestamp = if (callStart > 0) callStart else audioFile.lastModified()

                                // Parse BCR JSON metadata if present
                                val jsonMeta = readMetadataJson(audioFile)
                                if (jsonMeta != null) {
                                    if (resolvedPhone.isBlank() || resolvedPhone == "Unknown") {
                                        resolvedPhone = jsonMeta.phoneNumber
                                    }
                                    if (resolvedDuration <= 0 && jsonMeta.durationSeconds > 0) {
                                        resolvedDuration = jsonMeta.durationSeconds
                                    }
                                    if (jsonMeta.timestampMs > 0) {
                                        resolvedTimestamp = jsonMeta.timestampMs
                                    }
                                }

                                // Fallback 1: Extract phone number from filename
                                // AudioRecordingEngine format: {yyyyMMdd}_{HHmmss}_{in|out}_{phone}.ogg/.m4a
                                // BCR format: 20260906_055809.272+0530_OUT_1991.oga
                                if (resolvedPhone.isBlank() || resolvedPhone == "Unknown") {
                                    val nameWithoutExt = audioFile.nameWithoutExtension
                                    val parts = nameWithoutExt.split("_")
                                    if (parts.size >= 4 && (parts[2].equals("in", true) || parts[2].equals("out", true))) {
                                        val potentialNumber = parts.subList(3, parts.size).joinToString("_")
                                        if (potentialNumber.any { it.isDigit() } && !potentialNumber.equals("unknown", true)) {
                                            resolvedPhone = potentialNumber
                                        }
                                    } else if (parts.size >= 3) {
                                        val potentialNumber = parts.subList(2, parts.size).joinToString("_")
                                        if (potentialNumber.any { it.isDigit() }) {
                                            resolvedPhone = potentialNumber
                                        }
                                    }
                                }

                                // Fallback 2: Check device CallLog
                                if (resolvedPhone.isBlank() || resolvedPhone == "Unknown") {
                                    val (logNumber, logDuration) = getLatestCallLogDetails(context)
                                    if (logNumber.isNotBlank()) {
                                        resolvedPhone = logNumber
                                        if (resolvedDuration <= 0) resolvedDuration = logDuration
                                    }
                                }

                                if (resolvedPhone.isBlank() || resolvedPhone == "Unknown") {
                                    resolvedPhone = "Recent Call"
                                }

                                // Fallback 3: Extract duration via MediaMetadataRetriever if 0
                                if (resolvedDuration <= 0) {
                                    try {
                                        val mmr = android.media.MediaMetadataRetriever()
                                        try {
                                            mmr.setDataSource(audioFile.absolutePath)
                                            val durStr = mmr.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION)
                                            if (!durStr.isNullOrEmpty()) {
                                                resolvedDuration = (durStr.toLong() / 1000).toInt()
                                            }
                                        } finally {
                                            mmr.release()
                                        }
                                    } catch (_: Exception) {}
                                }

                                val isExcluded = CallStore.isNumberExcluded(context, resolvedPhone)
                                val callId = UUID.randomUUID().toString()
                                val cachedLeadName = CallStore.getLeadNameForPhone(context, resolvedPhone)
                                val currentUser = com.coldcalling.app.auth.AuthManager.getCurrentUser(context)
                                val callItem = CallItem(
                                    id = callId,
                                    phone = resolvedPhone,
                                    timestamp = resolvedTimestamp,
                                    durationSeconds = resolvedDuration,
                                    audioFilePath = audioFile.absolutePath,
                                    driveUrl = null,
                                    uploadStatus = com.coldcalling.app.data.UploadStatus.NOT_UPLOADED,
                                    leadName = cachedLeadName,
                                    userId = currentUser?.id
                                )

                                CallStore.saveCall(context, callItem)
                                existingPaths.add(audioFile.absolutePath)
                                Log.i(TAG, "Saved call recording: $resolvedPhone (${resolvedDuration}s) -> ${audioFile.name} (Excluded: $isExcluded)")
                                newlySavedCount++

                                // Notify UI immediately of new local call
                                val broadcastIntent = Intent(ACTION_CALL_SYNCED).apply {
                                    setPackage(context.packageName)
                                }
                                context.sendBroadcast(broadcastIntent)

                                // Upload to CRM (or fallback to Google Drive) if configured and NOT in exception list
                                if (CallStore.isAutoUploadEnabled(context) && !isExcluded) {
                                    val isLeadOrTeam = CallStore.isLeadOrTeammate(context, resolvedPhone)
                                    if (com.coldcalling.app.auth.AuthManager.isLoggedIn(context)) {
                                        com.coldcalling.app.uploader.CrmCallUploader.uploadCallRecording(context, callItem)
                                    } else if (isLeadOrTeam) {
                                        GoogleDriveUploader.uploadCallRecording(context, callItem)
                                    } else {
                                        Log.i(TAG, "Number $resolvedPhone is neither a registered CRM lead nor a team member. Auto-upload excluded.")
                                        CallStore.updateCallDetails(
                                            context = context,
                                            id = callItem.id,
                                            status = com.coldcalling.app.data.UploadStatus.SKIPPED,
                                            driveUrl = null,
                                            leadId = null,
                                            leadName = null
                                        )
                                    }
                                    context.sendBroadcast(broadcastIntent)
                                } else if (isExcluded) {
                                    Log.i(TAG, "Number $resolvedPhone is in Exception List. Auto-upload skipped.")
                                    CallStore.updateCallDetails(
                                        context = context,
                                        id = callItem.id,
                                        status = com.coldcalling.app.data.UploadStatus.SKIPPED,
                                        driveUrl = null,
                                        leadId = null,
                                        leadName = null
                                    )
                                }
                            }
                        }

                        if (newlySavedCount > 0) {
                            Log.i(TAG, "Sync complete on attempt $attempt: saved $newlySavedCount new recordings")
                            break
                        }
                    }

                    // Also retry pending or failed calls to CRM
                    if (CallStore.isAutoUploadEnabled(context) && com.coldcalling.app.auth.AuthManager.isLoggedIn(context)) {
                        val pendingCalls = CallStore.getCalls(context).filter {
                            (it.uploadStatus == com.coldcalling.app.data.UploadStatus.NOT_UPLOADED ||
                             it.uploadStatus == com.coldcalling.app.data.UploadStatus.FAILED) &&
                            !it.audioFilePath.isNullOrBlank() &&
                            File(it.audioFilePath).exists() &&
                            !CallStore.isNumberExcluded(context, it.phone)
                        }
                        if (pendingCalls.isNotEmpty()) {
                            Log.i(TAG, "Retrying CRM upload for ${pendingCalls.size} pending calls...")
                            for (pending in pendingCalls.take(3)) {
                                com.coldcalling.app.uploader.CrmCallUploader.uploadCallRecording(context, pending)
                            }
                            val broadcastIntent = Intent(ACTION_CALL_SYNCED).apply {
                                setPackage(context.packageName)
                            }
                            context.sendBroadcast(broadcastIntent)
                        }
                    }
                    Unit
                } catch (e: Exception) {
                    Log.e(TAG, "Error during syncRecordings", e)
                }
            }
        }

        fun getLatestCallLogDetails(context: Context): Pair<String, Int> {
            try {
                val cursor = context.contentResolver.query(
                    CallLog.Calls.CONTENT_URI,
                    arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.DURATION),
                    null,
                    null,
                    "${CallLog.Calls.DATE} DESC"
                )
                if (cursor != null) {
                    try {
                        if (cursor.moveToFirst()) {
                            val number = cursor.getString(cursor.getColumnIndexOrThrow(CallLog.Calls.NUMBER)) ?: ""
                            val duration = cursor.getInt(cursor.getColumnIndexOrThrow(CallLog.Calls.DURATION))
                            return Pair(number, duration)
                        }
                    } finally {
                        cursor.close()
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "Failed to read CallLog", e)
            }
            return Pair("", 0)
        }

        private fun readMetadataJson(audioFile: File): BcrMeta? {
            try {
                val jsonFile = File(audioFile.parentFile, audioFile.nameWithoutExtension + ".json")
                if (jsonFile.exists()) {
                    val content = jsonFile.readText()
                    val root = JSONObject(content)

                    var phone = ""
                    val callsArray = root.optJSONArray("calls")
                    if (callsArray != null && callsArray.length() > 0) {
                        phone = callsArray.optJSONObject(0)?.optString("phone_number", "") ?: ""
                    }
                    if (phone.isBlank()) {
                        phone = root.optString("phone_number", "")
                    }

                    var duration = 0
                    val outputObj = root.optJSONObject("output")
                    val recObj = outputObj?.optJSONObject("recording")
                    if (recObj != null) {
                        duration = recObj.optDouble("duration_secs_total", 0.0).toInt()
                    }

                    val timestampMs = root.optLong("timestamp_unix_ms", 0L)

                    return BcrMeta(phone, duration, timestampMs)
                }
            } catch (e: Exception) {
                Log.w(TAG, "Failed to parse BCR metadata JSON", e)
            }
            return null
        }

        private data class BcrMeta(val phoneNumber: String, val durationSeconds: Int, val timestampMs: Long)
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val phone = intent?.getStringExtra(EXTRA_PHONE) ?: "Unknown"
        val duration = intent?.getIntExtra(EXTRA_DURATION, 0) ?: 0
        val callStart = intent?.getLongExtra(EXTRA_CALL_START, System.currentTimeMillis()) ?: System.currentTimeMillis()

        try {
            startForeground(NOTIFICATION_ID, buildNotification("Syncing call recording..."))
        } catch (e: Exception) {
            Log.w(TAG, "Could not start foreground notification", e)
        }

        scope.launch {
            try {
                syncRecordings(applicationContext, phone, duration, callStart)
            } finally {
                stopForeground(true)
                stopSelf()
            }
        }

        return START_NOT_STICKY
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Call Recording Upload",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Uploads call recordings to Google Drive"
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(text: String): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Cold Calling Sync")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_upload)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()
    }
}
