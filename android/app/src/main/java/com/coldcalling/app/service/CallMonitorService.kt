package com.coldcalling.app.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.telephony.PhoneStateListener
import android.telephony.TelephonyCallback
import android.telephony.TelephonyManager
import android.util.Log
import androidx.annotation.RequiresApi
import androidx.core.app.NotificationCompat
import com.coldcalling.app.MainActivity
import com.coldcalling.app.data.CallStore
import com.coldcalling.app.receiver.CallStateReceiver
import com.coldcalling.app.recording.RecordingForegroundService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

import android.Manifest
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat

class CallMonitorService : Service() {

    companion object {
        private const val TAG = "CallMonitorService"
        private const val CHANNEL_ID = "call_monitor_channel"
        private const val NOTIFICATION_ID = 5001

        fun start(context: Context) {
            runCatching {
                val intent = Intent(context, CallMonitorService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            }.onFailure { e ->
                Log.w(TAG, "Could not start CallMonitorService: ${e.message}")
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, CallMonitorService::class.java))
        }
    }

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var telephonyManager: TelephonyManager? = null
    @Suppress("DEPRECATION")
    private var phoneStateListener: PhoneStateListener? = null
    private var telephonyCallback: Any? = null // TelephonyCallback for API 31+
    private var isListenerRegistered = false

    private var lastState = TelephonyManager.CALL_STATE_IDLE
    private var callStartTime: Long = 0
    private var incomingNumber: String = ""
    private var networkCallback: android.net.ConnectivityManager.NetworkCallback? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        try {
            startForeground(NOTIFICATION_ID, buildNotification())
        } catch (e: Exception) {
            Log.w(TAG, "startForeground warning: ${e.message}")
        }
        registerCallStateListener()
        registerWifiAutoHealCallback()
        serviceScope.launch {
            com.coldcalling.app.recording.wireless.WirelessAdbManager.autoHealEngineIfNeeded(applicationContext)
        }
        Log.i(TAG, "CallMonitorService started — listening for call state changes")
    }

    private fun registerWifiAutoHealCallback() {
        try {
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? android.net.ConnectivityManager ?: return
            val req = android.net.NetworkRequest.Builder()
                .addTransportType(android.net.NetworkCapabilities.TRANSPORT_WIFI)
                .build()
            val cb = object : android.net.ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: android.net.Network) {
                    serviceScope.launch {
                        com.coldcalling.app.recording.wireless.WirelessAdbManager.autoHealEngineIfNeeded(applicationContext)
                    }
                }
            }
            cm.registerNetworkCallback(req, cb)
            networkCallback = cb
        } catch (e: Exception) {
            Log.w(TAG, "Could not register Wi-Fi auto-heal callback: ${e.message}")
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!isListenerRegistered) {
            registerCallStateListener()
        }
        serviceScope.launch {
            com.coldcalling.app.recording.wireless.WirelessAdbManager.autoHealEngineIfNeeded(applicationContext)
        }
        return START_STICKY
    }

    private fun registerCallStateListener() {
        if (isListenerRegistered) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "READ_PHONE_STATE not granted yet; deferring TelephonyCallback registration")
            return
        }

        try {
            telephonyManager = getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                registerTelephonyCallbackApi31()
            } else {
                registerPhoneStateListenerLegacy()
            }
            isListenerRegistered = true
        } catch (e: SecurityException) {
            Log.w(TAG, "SecurityException registering call state listener: ${e.message}")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to register call state listener", e)
        }
    }

    @RequiresApi(Build.VERSION_CODES.S)
    private fun registerTelephonyCallbackApi31() {
        val callback = object : TelephonyCallback(), TelephonyCallback.CallStateListener {
            override fun onCallStateChanged(state: Int) {
                handleCallStateChange(state)
            }
        }
        telephonyCallback = callback
        telephonyManager?.registerTelephonyCallback(mainExecutor, callback)
        Log.i(TAG, "Registered TelephonyCallback (API 31+)")
    }

    @Suppress("DEPRECATION")
    private fun registerPhoneStateListenerLegacy() {
        val listener = object : PhoneStateListener() {
            override fun onCallStateChanged(state: Int, phoneNumber: String?) {
                if (!phoneNumber.isNullOrBlank()) {
                    incomingNumber = phoneNumber
                    CallStateReceiver.incomingNumber = phoneNumber
                }
                handleCallStateChange(state)
            }
        }
        phoneStateListener = listener
        telephonyManager?.listen(listener, PhoneStateListener.LISTEN_CALL_STATE)
        Log.i(TAG, "Registered PhoneStateListener (legacy)")
    }

    private fun handleCallStateChange(state: Int) {
        if (state == lastState) return

        Log.i(TAG, "Call state changed: $lastState -> $state")

        when (state) {
            TelephonyManager.CALL_STATE_RINGING -> {
                Log.i(TAG, "Phone ringing — ensuring 2-Way HD Engine is running")
                serviceScope.launch {
                    com.coldcalling.app.recording.wireless.WirelessAdbManager.autoHealEngineIfNeeded(applicationContext)
                }
            }

            TelephonyManager.CALL_STATE_OFFHOOK -> {
                callStartTime = System.currentTimeMillis()
                val isIncoming = lastState == TelephonyManager.CALL_STATE_RINGING
                val resolvedIncoming = incomingNumber.ifBlank { CallStateReceiver.incomingNumber }
                val activeNumber = if (isIncoming) resolvedIncoming else CallStateReceiver.lastDialedNumber
                val direction = if (isIncoming) "in" else "out"

                Log.i(TAG, "Call connected (OFFHOOK) for: $activeNumber ($direction)")

                // Check if paused / Banking Safe mode
                if (CallStore.isRecordingPaused(this)) {
                    Log.i(TAG, "Recording is PAUSED (Banking Safe Mode). Recording skipped.")
                } else if (activeNumber.isNotBlank() && CallStore.isNumberExcluded(this, activeNumber)) {
                    Log.i(TAG, "Number $activeNumber is on Exception List. Recording skipped.")
                } else {
                    // Start RecordingForegroundService
                    runCatching {
                        val recordIntent = Intent(this, RecordingForegroundService::class.java).apply {
                            action = RecordingForegroundService.ACTION_START_RECORDING
                            putExtra(RecordingForegroundService.EXTRA_PHONE, activeNumber)
                            putExtra(RecordingForegroundService.EXTRA_DIRECTION, direction)
                        }
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                            startForegroundService(recordIntent)
                        } else {
                            startService(recordIntent)
                        }
                        Log.i(TAG, "Started RecordingForegroundService for $activeNumber")
                    }.onFailure { e ->
                        Log.w(TAG, "Could not start RecordingForegroundService: ${e.message}")
                    }
                }
            }

            TelephonyManager.CALL_STATE_IDLE -> {
                if (lastState == TelephonyManager.CALL_STATE_OFFHOOK) {
                    val durationSeconds = if (callStartTime > 0) {
                        ((System.currentTimeMillis() - callStartTime) / 1000).toInt()
                    } else 0

                    val resolvedIncoming = incomingNumber.ifBlank { CallStateReceiver.incomingNumber }
                    val dialedPhone = if (resolvedIncoming.isNotBlank()) resolvedIncoming else CallStateReceiver.lastDialedNumber
                    val startMs = callStartTime
                    Log.i(TAG, "Call Ended. Duration: ${durationSeconds}s. Stopping recording...")

                    // Stop RecordingForegroundService
                    if (RecordingForegroundService.isRecording) {
                        runCatching {
                            val stopIntent = Intent(this, RecordingForegroundService::class.java).apply {
                                action = RecordingForegroundService.ACTION_STOP_RECORDING
                            }
                            startService(stopIntent)
                        }.onFailure { e ->
                            Log.w(TAG, "Could not stop RecordingForegroundService: ${e.message}")
                        }
                    }

                    // Fallback sync
                    serviceScope.launch {
                        try {
                            RecordingSyncService.syncRecordings(
                                applicationContext,
                                phone = dialedPhone,
                                duration = durationSeconds,
                                callStart = startMs
                            )
                        } catch (e: Exception) {
                            Log.e(TAG, "Error in fallback sync", e)
                        }
                    }
                }
                incomingNumber = ""
                CallStateReceiver.incomingNumber = ""
                CallStateReceiver.lastDialedNumber = ""
            }
        }
        lastState = state
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Call Monitor",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Monitors call state for recording"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Cold Calling Pro")
            .setContentText("Call monitor active")
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    @Suppress("DEPRECATION")
    override fun onDestroy() {
        super.onDestroy()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (telephonyCallback as? TelephonyCallback)?.let {
                telephonyManager?.unregisterTelephonyCallback(it)
            }
        } else {
            phoneStateListener?.let {
                telephonyManager?.listen(it, PhoneStateListener.LISTEN_NONE)
            }
        }
        networkCallback?.let { cb ->
            runCatching {
                val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? android.net.ConnectivityManager
                cm?.unregisterNetworkCallback(cb)
            }
        }
        networkCallback = null
        Log.i(TAG, "CallMonitorService destroyed")
    }
}
