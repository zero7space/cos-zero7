package com.coldcalling.app.recording

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import com.coldcalling.app.MainActivity
import com.coldcalling.app.data.CallItem
import com.coldcalling.app.data.CallStore
import com.coldcalling.app.data.UploadStatus
import com.coldcalling.app.uploader.GoogleDriveUploader
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.UUID

class RecordingForegroundService : Service() {

    companion object {
        private const val TAG = "RecordingFgService"
        const val CHANNEL_ID = "cold_calling_recording_channel"
        const val NOTIFICATION_ID = 4001

        const val ACTION_START_RECORDING = "com.coldcalling.app.START_RECORDING"
        const val ACTION_STOP_RECORDING = "com.coldcalling.app.STOP_RECORDING"
        const val EXTRA_PHONE = "extra_phone"
        const val EXTRA_DIRECTION = "extra_direction"

        @Volatile
        var isRecording = false
            private set

        @Volatile
        var activeRecordingPath: String? = null
    }

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var recordingEngine: AudioRecordingEngine? = null

    private var currentPhone: String = "Unknown"
    private var currentDirection: String = "out"
    private var callStartTime: Long = 0L

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action ?: return START_NOT_STICKY

        when (action) {
            ACTION_START_RECORDING -> {
                val phone = intent.getStringExtra(EXTRA_PHONE) ?: "Unknown"
                val direction = intent.getStringExtra(EXTRA_DIRECTION) ?: "out"

                // Check paused / banking safe mode before recording
                if (CallStore.isRecordingPaused(this)) {
                    Log.i(TAG, "Recording is PAUSED (Banking Safe Mode). Skipping recording entirely.")
                    if (!isRecording) stopSelf()
                    return START_NOT_STICKY
                }

                // Check exception list before recording
                if (CallStore.isNumberExcluded(this, phone)) {
                    Log.i(TAG, "Number $phone is in Exception List. Skipping recording entirely.")
                    if (!isRecording) stopSelf()
                    return START_NOT_STICKY
                }

                if (isRecording) {
                    if ((currentPhone.isBlank() || currentPhone == "Unknown") && phone.isNotBlank() && phone != "Unknown") {
                        currentPhone = phone
                        currentDirection = direction
                        Log.i(TAG, "Updated active recording phone number to $phone ($direction)")
                    } else {
                        Log.w(TAG, "Recording already active, ignoring duplicate start request")
                    }
                    return START_NOT_STICKY
                }

                currentPhone = phone
                currentDirection = direction
                callStartTime = System.currentTimeMillis()

                val displayPhone = if (phone.isBlank() || phone == "Unknown") "Active Call" else phone
                try {
                    startForeground(NOTIFICATION_ID, buildNotification("Recording call: $displayPhone"))
                } catch (e: Exception) {
                    Log.w(TAG, "startForeground warning: ${e.message}")
                }
                startRecordingSession(phone, direction)
            }

            ACTION_STOP_RECORDING -> {
                stopRecordingSession()
            }
        }

        return START_NOT_STICKY
    }

    private fun startRecordingSession(phone: String, direction: String) {
        isRecording = true
        serviceScope.launch(Dispatchers.IO) {
            try {
                val engine = AudioRecordingEngine()
                recordingEngine = engine
                engine.startPipeline(applicationContext, phone, direction)
                Log.i(TAG, "Call recording pipeline active for $phone (mode=${engine.activeMode})")

                val displayPhone = if (currentPhone.isBlank() || currentPhone == "Unknown") "Active Call" else currentPhone
                val statusText = if (engine.activeMode == "ENHANCED_2WAY") {
                    "🎙️ 2-Way HD Recording: $displayPhone"
                } else {
                    "⚠️ 2-Way Engine OFF (Call Muted!) — Tap to Fix"
                }
                runCatching {
                    val manager = getSystemService(NotificationManager::class.java)
                    manager?.notify(NOTIFICATION_ID, buildNotification(statusText))
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to start recording session", e)
                stopRecordingSession()
            }
        }
    }

    private fun stopRecordingSession() {
        if (!isRecording) {
            runCatching { stopForeground(STOP_FOREGROUND_REMOVE) }
            stopSelf()
            return
        }

        isRecording = false
        val durationSec = if (callStartTime > 0) ((System.currentTimeMillis() - callStartTime) / 1000).toInt() else 0
        var phone = currentPhone
        val capturedStartTime = callStartTime
        val engine = recordingEngine
        recordingEngine = null

        serviceScope.launch(Dispatchers.IO) {
            try {
                engine?.release()
                val recordedFile = engine?.recordedFile

                if (recordedFile != null && recordedFile.exists() && recordedFile.length() > 0) {
                    if (phone.isBlank() || phone == "Unknown") {
                        delay(800)
                        val (logNumber, _) = com.coldcalling.app.service.RecordingSyncService.getLatestCallLogDetails(applicationContext)
                        if (logNumber.isNotBlank()) {
                            phone = logNumber
                        }
                    }

                    if (phone.isBlank() || phone == "Unknown") {
                        phone = "Recent Call"
                    }

                    // Check Exception List with resolved phone number
                    if (CallStore.isNumberExcluded(applicationContext, phone)) {
                        Log.i(TAG, "Number $phone is in Exception List. Deleting recording and skipping upload.")
                        activeRecordingPath = null
                        try {
                            recordedFile.delete()
                        } catch (_: Exception) {}
                        return@launch
                    }

                    val callItem = CallItem(
                        id = UUID.randomUUID().toString(),
                        phone = phone,
                        timestamp = capturedStartTime,
                        durationSeconds = durationSec,
                        audioFilePath = recordedFile.absolutePath,
                        driveUrl = null,
                        uploadStatus = UploadStatus.NOT_UPLOADED
                    )

                    CallStore.saveCall(applicationContext, callItem)
                    activeRecordingPath = null
                    Log.i(TAG, "Call recording saved locally: ${recordedFile.name} (${durationSec}s)")

                    // Broadcast immediate local save to UI
                    sendBroadcast(Intent("com.coldcalling.app.CALL_SYNCED").apply {
                        setPackage(packageName)
                    })
                } else {
                    activeRecordingPath = null
                }
            } catch (e: Exception) {
                activeRecordingPath = null
                Log.e(TAG, "Error while stopping recording session", e)
            } finally {
                if (!isRecording) {
                    runCatching { stopForeground(STOP_FOREGROUND_REMOVE) }
                    stopSelf()
                }
            }
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Cold Calling Recorder",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows ongoing call recording status"
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
            .setContentTitle("Cold Calling Pro")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()
    }

    override fun onDestroy() {
        super.onDestroy()
        isRecording = false
        activeRecordingPath = null
        recordingEngine?.release()
    }
}
