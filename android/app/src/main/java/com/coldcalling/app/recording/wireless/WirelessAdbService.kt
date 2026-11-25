package com.coldcalling.app.recording.wireless

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import android.widget.Toast
import androidx.core.app.NotificationCompat
import androidx.core.app.RemoteInput
import com.coldcalling.app.MainActivity
import com.coldcalling.app.recording.StandaloneEngineClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class WirelessAdbService : Service() {

    companion object {
        private const val TAG = "WirelessAdbService"
        private const val CHANNEL_ID = "wireless_adb_setup_channel"
        private const val NOTIFICATION_ID = 9921

        const val ACTION_START_LISTENING = "com.coldcalling.app.wireless.START_LISTENING"
        const val ACTION_STOP_LISTENING = "com.coldcalling.app.wireless.STOP_LISTENING"
        const val ACTION_REPLY_INPUT = "com.coldcalling.app.wireless.REPLY_INPUT"
        const val KEY_TEXT_REPLY = "key_text_reply"
        const val ACTION_ENGINE_STATUS_CHANGED = "com.coldcalling.app.ENGINE_STATUS_CHANGED"

        @Volatile
        var detectedConnectPort: Int = 0
            private set

        @Volatile
        var detectedPairPort: Int = 0
            private set

        fun startListening(context: Context) {
            val intent = Intent(context, WirelessAdbService::class.java).apply {
                action = ACTION_START_LISTENING
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stopListening(context: Context) {
            val intent = Intent(context, WirelessAdbService::class.java).apply {
                action = ACTION_STOP_LISTENING
            }
            context.startService(intent)
        }
    }

    private val serviceScope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var nsdManager: NsdManager? = null
    private var connectDiscoveryListener: NsdManager.DiscoveryListener? = null
    private var pairDiscoveryListener: NsdManager.DiscoveryListener? = null
    private var isConnecting = false
    private var autoStopJob: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        nsdManager = getSystemService(Context.NSD_SERVICE) as? NsdManager
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP_LISTENING -> {
                stopAllDiscovery()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_REPLY_INPUT -> {
                val results = RemoteInput.getResultsFromIntent(intent)
                val input = (results?.getCharSequence(KEY_TEXT_REPLY)?.toString()
                    ?: intent.getStringExtra(KEY_TEXT_REPLY) ?: "").trim()
                if (input.isNotEmpty()) {
                    handleUserInput(input)
                }
            }
            else -> {
                startForeground(
                    NOTIFICATION_ID,
                    buildNotification(
                        title = "Wireless Debugging Starter Active",
                        text = if (WirelessAdbManager.isPaired(this)) {
                            "Turn ON 'Wireless debugging' in Settings — Engine will start automatically!"
                        } else {
                            "In Wireless Debugging, tap 'Pair device with pairing code' to pair."
                        },
                        showReply = true
                    )
                )
                startAllDiscovery()
                scheduleAutoStop()
            }
        }
        return START_NOT_STICKY
    }

    private fun scheduleAutoStop() {
        autoStopJob?.cancel()
        autoStopJob = serviceScope.launch {
            delay(5 * 60 * 1000L) // Auto-stop after 5 minutes if unused
            stopAllDiscovery()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    private fun handleUserInput(rawInput: String) {
        serviceScope.launch {
            val parts = rawInput.split(Regex("[\\s:]+")).filter { it.isNotEmpty() }

            // Case 1: User entered "PORT CODE" (e.g., "37123 482910")
            if (parts.size >= 2) {
                val pPort = parts[0].toIntOrNull() ?: 0
                val code = parts[1]
                if (pPort in 1..65535 && code.length == 6) {
                    performPairingAndStart(pPort, code)
                    return@launch
                }
            }

            val single = parts.firstOrNull() ?: ""
            // Case 2: User entered 6-digit pairing code (e.g., "482910")
            if (single.length == 6 && single.all { it.isDigit() }) {
                var pPort = detectedPairPort
                if (pPort <= 0) {
                    updateNotification("Searching for Pairing Port...", "Detecting open pairing port via mDNS...", true)
                    pPort = WirelessAdbManager.discoverPairPort(this@WirelessAdbService, 2500)
                }
                if (pPort > 0) {
                    performPairingAndStart(pPort, single)
                } else {
                    updateNotification(
                        "⚠️ Pairing Port Not Auto-Detected",
                        "Please enter both Port and Code separated by space (e.g. 37123 $single)",
                        true
                    )
                }
                return@launch
            }

            // Case 3: User entered 5-digit Connect Port (e.g., "41235")
            val cPort = single.toIntOrNull() ?: 0
            if (cPort in 1024..65535) {
                performConnectAndStart(cPort)
                return@launch
            }

            updateNotification(
                "Invalid Input: '$rawInput'",
                "Enter 6-digit pairing code (or 'PORT CODE'), or 5-digit connect port.",
                true
            )
        }
    }

    private suspend fun performPairingAndStart(pairPort: Int, code: String) {
        updateNotification("🔑 Pairing with port $pairPort...", "Exchanging SPAKE2 keys...", false)
        val pairRes = WirelessAdbManager.pair(this, pairPort, code)
        if (!pairRes.success) {
            updateNotification("❌ Pairing Failed", pairRes.message, true)
            return
        }

        updateNotification("✅ Paired Successfully!", "Now starting Recorder Engine...", false)
        Toast.makeText(this, "✅ Device paired! Starting Recorder Engine...", Toast.LENGTH_SHORT).show()

        // Try connect port if already detected, or wait a moment for mDNS connect port
        for (attempt in 1..6) {
            val cPort = if (detectedConnectPort > 0) detectedConnectPort else WirelessAdbManager.getLastConnectPort(this)
            if (cPort > 0) {
                val startRes = WirelessAdbManager.startEngine(this, cPort)
                if (startRes.success) {
                    onEngineStartedSuccess()
                    return
                }
            }
            delay(800)
        }

        updateNotification(
            "✅ Paired! Waiting for Connect Port...",
            "Stay on Wireless Debugging screen (or enter the 5-digit port below).",
            true
        )
    }

    private suspend fun performConnectAndStart(connectPort: Int) {
        if (isConnecting) return
        isConnecting = true
        try {
            updateNotification("⚡ Starting Recorder Engine...", "Connecting to 127.0.0.1:$connectPort...", false)
            val res = WirelessAdbManager.startEngine(this, connectPort)
            if (res.success) {
                onEngineStartedSuccess()
            } else {
                updateNotification(
                    "⚠️ Could Not Start on Port $connectPort",
                    if (!WirelessAdbManager.isPaired(this)) {
                        "Device not paired yet. Tap 'Pair device with pairing code' in Settings first!"
                    } else {
                        res.message
                    },
                    true
                )
            }
        } finally {
            isConnecting = false
        }
    }

    private suspend fun onEngineStartedSuccess() {
        stopAllDiscovery()
        sendBroadcast(Intent(ACTION_ENGINE_STATUS_CHANGED).setPackage(packageName))
        withContext(Dispatchers.Main) {
            Toast.makeText(
                this@WirelessAdbService,
                "🟢 Recorder Engine ON! You can now turn off Wireless Debugging.",
                Toast.LENGTH_LONG
            ).show()
        }
        updateNotification(
            "🟢 Recorder Engine is ON!",
            "Ready for 2-way call recording! You can now turn OFF Wireless Debugging.",
            false
        )
        delay(6000)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun startAllDiscovery() {
        stopAllDiscovery()
        val nsd = nsdManager ?: return

        // 1. Discover _adb-tls-connect._tcp
        val connectListener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(regType: String) {
                Log.d(TAG, "mDNS discovery started: $regType")
            }

            override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                Log.d(TAG, "mDNS connect service found: $serviceInfo")
                @Suppress("DEPRECATION")
                nsd.resolveService(serviceInfo, object : NsdManager.ResolveListener {
                    override fun onResolveFailed(info: NsdServiceInfo?, errorCode: Int) {
                        Log.w(TAG, "mDNS connect resolve failed: $errorCode")
                    }

                    override fun onServiceResolved(resolvedInfo: NsdServiceInfo?) {
                        val port = resolvedInfo?.port ?: return
                        if (port > 0) {
                            Log.i(TAG, "mDNS resolved connect port: $port")
                            detectedConnectPort = port
                            WirelessAdbManager.setLastConnectPort(this@WirelessAdbService, port)
                            serviceScope.launch {
                                if (!StandaloneEngineClient.isAvailable()) {
                                    performConnectAndStart(port)
                                } else {
                                    onEngineStartedSuccess()
                                }
                            }
                        }
                    }
                })
            }

            override fun onServiceLost(serviceInfo: NsdServiceInfo) {}
            override fun onDiscoveryStopped(serviceType: String) {}
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {}
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
        }
        connectDiscoveryListener = connectListener
        try {
            nsd.discoverServices("_adb-tls-connect._tcp", NsdManager.PROTOCOL_DNS_SD, connectListener)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start connect discovery", e)
        }

        // 2. Discover _adb-tls-pairing._tcp
        val pairListener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(regType: String) {
                Log.d(TAG, "mDNS discovery started: $regType")
            }

            override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                Log.d(TAG, "mDNS pair service found: $serviceInfo")
                @Suppress("DEPRECATION")
                nsd.resolveService(serviceInfo, object : NsdManager.ResolveListener {
                    override fun onResolveFailed(info: NsdServiceInfo?, errorCode: Int) {
                        Log.w(TAG, "mDNS pair resolve failed: $errorCode")
                    }

                    override fun onServiceResolved(resolvedInfo: NsdServiceInfo?) {
                        val port = resolvedInfo?.port ?: return
                        if (port > 0) {
                            Log.i(TAG, "mDNS resolved pair port: $port")
                            detectedPairPort = port
                            serviceScope.launch {
                                updateNotification(
                                    "🔑 Pairing Port $port Detected!",
                                    "Tap 'Enter Code' below and type the 6-digit pairing code shown on screen.",
                                    true
                                )
                            }
                        }
                    }
                })
            }

            override fun onServiceLost(serviceInfo: NsdServiceInfo) {}
            override fun onDiscoveryStopped(serviceType: String) {}
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {}
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
        }
        pairDiscoveryListener = pairListener
        try {
            nsd.discoverServices("_adb-tls-pairing._tcp", NsdManager.PROTOCOL_DNS_SD, pairListener)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start pair discovery", e)
        }
    }

    private fun stopAllDiscovery() {
        val nsd = nsdManager ?: return
        connectDiscoveryListener?.let {
            try { nsd.stopServiceDiscovery(it) } catch (_: Exception) {}
        }
        connectDiscoveryListener = null
        pairDiscoveryListener?.let {
            try { nsd.stopServiceDiscovery(it) } catch (_: Exception) {}
        }
        pairDiscoveryListener = null
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Wireless Engine Starter",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Interactive pairing and one-tap startup for the Standalone Recorder Engine"
            }
            val nm = getSystemService(NotificationManager::class.java)
            nm?.createNotificationChannel(channel)
        }
    }

    private fun updateNotification(title: String, text: String, showReply: Boolean) {
        val nm = getSystemService(NotificationManager::class.java) ?: return
        nm.notify(NOTIFICATION_ID, buildNotification(title, text, showReply))
    }

    private fun buildNotification(title: String, text: String, showReply: Boolean) =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setGroup("wireless_adb_standalone_group")
            .setSortKey("0")
            .setOngoing(showReply)
            .apply {
                val openAppIntent = Intent(this@WirelessAdbService, MainActivity::class.java)
                val openAppPi = PendingIntent.getActivity(
                    this@WirelessAdbService,
                    0,
                    openAppIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                setContentIntent(openAppPi)

                if (showReply) {
                    val remoteInput = RemoteInput.Builder(KEY_TEXT_REPLY)
                        .setLabel(
                            if (detectedPairPort > 0) "Enter 6-digit pairing code"
                            else "Enter 6-digit code or 5-digit port"
                        )
                        .build()

                    val replyIntent = Intent(this@WirelessAdbService, WirelessAdbService::class.java).apply {
                        action = ACTION_REPLY_INPUT
                    }
                    val replyFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
                    } else {
                        PendingIntent.FLAG_UPDATE_CURRENT
                    }
                    val replyPi = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        PendingIntent.getForegroundService(this@WirelessAdbService, 1, replyIntent, replyFlags)
                    } else {
                        PendingIntent.getService(this@WirelessAdbService, 1, replyIntent, replyFlags)
                    }

                    val replyAction = NotificationCompat.Action.Builder(
                        android.R.drawable.ic_menu_send,
                        if (detectedPairPort > 0) "Enter 6-Digit Code" else "Enter Code / Port",
                        replyPi
                    ).addRemoteInput(remoteInput).build()

                    addAction(replyAction)

                    val stopIntent = Intent(this@WirelessAdbService, WirelessAdbService::class.java).apply {
                        action = ACTION_STOP_LISTENING
                    }
                    val stopPi = PendingIntent.getService(
                        this@WirelessAdbService,
                        2,
                        stopIntent,
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                    )
                    addAction(android.R.drawable.ic_menu_close_clear_cancel, "Cancel", stopPi)
                }
            }
            .build()

    override fun onDestroy() {
        stopAllDiscovery()
        serviceScope.cancel()
        super.onDestroy()
    }
}
