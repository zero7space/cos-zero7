package com.coldcalling.app.recording.wireless

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.util.Log
import com.coldcalling.app.recording.StandaloneEngineClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.nio.charset.StandardCharsets
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

object WirelessAdbManager {
    private const val TAG = "WirelessAdbManager"
    private const val PREFS_NAME = "wireless_adb_prefs"
    private const val KEY_IS_PAIRED = "is_paired"
    private const val KEY_LAST_PORT = "last_connect_port"

    private const val ASSET_ADB_KEY = "wireless/adbkey"
    private const val ASSET_ADB_CERT = "wireless/adbcert.pem"
    private val autoHealMutex = Mutex()
    @Volatile
    private var lastAutoHealAttemptMs: Long = 0L

    data class PairResult(val success: Boolean, val message: String)
    data class StartResult(val success: Boolean, val message: String)

    fun ensureKeys(context: Context): Pair<File, File> {
        val dir = File(context.filesDir, "wireless_adb")
        if (!dir.exists()) dir.mkdirs()
        val keyFile = File(dir, "adbkey")
        val certFile = File(dir, "adbcert.pem")

        if (!keyFile.exists() || keyFile.length() == 0L) {
            context.assets.open(ASSET_ADB_KEY).use { input ->
                FileOutputStream(keyFile).use { output -> input.copyTo(output) }
            }
        }
        if (!certFile.exists() || certFile.length() == 0L) {
            context.assets.open(ASSET_ADB_CERT).use { input ->
                FileOutputStream(certFile).use { output -> input.copyTo(output) }
            }
        }
        return Pair(keyFile, certFile)
    }

    fun isPaired(context: Context): Boolean {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getBoolean(KEY_IS_PAIRED, false)
    }

    fun setPaired(context: Context, paired: Boolean) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_IS_PAIRED, paired)
            .apply()
    }

    fun getLastConnectPort(context: Context): Int {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getInt(KEY_LAST_PORT, 0)
    }

    fun setLastConnectPort(context: Context, port: Int) {
        if (port > 0) {
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putInt(KEY_LAST_PORT, port)
                .apply()
        }
    }

    /** Discover mDNS port for connect (_adb-tls-connect) */
    suspend fun discoverConnectPort(context: Context, timeoutMs: Long = 2500): Int = withContext(Dispatchers.IO) {
        try {
            val foundPort = AtomicInteger(0)
            val latch = CountDownLatch(1)
            val nsd = context.getSystemService(Context.NSD_SERVICE) as? NsdManager ?: return@withContext 0
            val listener = object : NsdManager.DiscoveryListener {
                override fun onServiceFound(info: NsdServiceInfo) {
                    @Suppress("DEPRECATION")
                    nsd.resolveService(info, object : NsdManager.ResolveListener {
                        override fun onResolveFailed(serviceInfo: NsdServiceInfo?, errorCode: Int) {}
                        override fun onServiceResolved(resolvedInfo: NsdServiceInfo?) {
                            val p = resolvedInfo?.port ?: 0
                            if (p > 0) {
                                foundPort.set(p)
                                latch.countDown()
                            }
                        }
                    })
                }
                override fun onDiscoveryStarted(regType: String) {}
                override fun onServiceLost(info: NsdServiceInfo) {}
                override fun onStartDiscoveryFailed(regType: String, errorCode: Int) { latch.countDown() }
                override fun onStopDiscoveryFailed(regType: String, errorCode: Int) {}
                override fun onDiscoveryStopped(regType: String) {}
            }
            nsd.discoverServices("_adb-tls-connect._tcp", NsdManager.PROTOCOL_DNS_SD, listener)
            latch.await(timeoutMs, TimeUnit.MILLISECONDS)
            try { nsd.stopServiceDiscovery(listener) } catch (_: Exception) {}
            val p = foundPort.get()
            if (p > 0) setLastConnectPort(context, p)
            p
        } catch (e: Exception) {
            Log.w(TAG, "mDNS discover connect port failed: ${e.message}")
            0
        }
    }

    /** Discover mDNS port for pairing (_adb-tls-pairing) */
    suspend fun discoverPairPort(context: Context, timeoutMs: Long = 2500): Int = withContext(Dispatchers.IO) {
        try {
            val foundPort = AtomicInteger(0)
            val latch = CountDownLatch(1)
            val nsd = context.getSystemService(Context.NSD_SERVICE) as? NsdManager ?: return@withContext 0
            val listener = object : NsdManager.DiscoveryListener {
                override fun onServiceFound(info: NsdServiceInfo) {
                    @Suppress("DEPRECATION")
                    nsd.resolveService(info, object : NsdManager.ResolveListener {
                        override fun onResolveFailed(serviceInfo: NsdServiceInfo?, errorCode: Int) {}
                        override fun onServiceResolved(resolvedInfo: NsdServiceInfo?) {
                            val p = resolvedInfo?.port ?: 0
                            if (p > 0) {
                                foundPort.set(p)
                                latch.countDown()
                            }
                        }
                    })
                }
                override fun onDiscoveryStarted(regType: String) {}
                override fun onServiceLost(info: NsdServiceInfo) {}
                override fun onStartDiscoveryFailed(regType: String, errorCode: Int) { latch.countDown() }
                override fun onStopDiscoveryFailed(regType: String, errorCode: Int) {}
                override fun onDiscoveryStopped(regType: String) {}
            }
            nsd.discoverServices("_adb-tls-pairing._tcp", NsdManager.PROTOCOL_DNS_SD, listener)
            latch.await(timeoutMs, TimeUnit.MILLISECONDS)
            try { nsd.stopServiceDiscovery(listener) } catch (_: Exception) {}
            foundPort.get()
        } catch (e: Exception) {
            Log.w(TAG, "mDNS discover pair port failed: ${e.message}")
            0
        }
    }

    /** Pair using 6-digit code and pairing port */
    suspend fun pair(context: Context, pairPort: Int, code: String): PairResult = withContext(Dispatchers.IO) {
        try {
            val (keyFile, certFile) = ensureKeys(context)
            val privateKeyPem = keyFile.readText(StandardCharsets.UTF_8)
            val certPem = certFile.readText(StandardCharsets.UTF_8)
            val privateKey = AdbClient.loadKey(privateKeyPem)

            val result = AdbPairClient.pair("127.0.0.1", pairPort, code, privateKey, certPem)
            if (result.ok) {
                setPaired(context, true)
                PairResult(true, "Paired successfully! Now you can start the engine anytime.")
            } else {
                PairResult(false, result.message)
            }
        } catch (e: Exception) {
            Log.e(TAG, "pair error", e)
            PairResult(false, "Pairing error: ${e.message}")
        }
    }

    /** Connect to wireless debugging port and start StandaloneDaemon */
    suspend fun startEngine(context: Context, connectPort: Int): StartResult = withContext(Dispatchers.IO) {
        try {
            if (StandaloneEngineClient.isAvailable()) {
                return@withContext StartResult(true, "Recorder Engine is already running!")
            }

            if (connectPort <= 0 || connectPort > 65535) {
                return@withContext StartResult(false, "Please enter a valid 5-digit Wireless Debugging port")
            }

            val (keyFile, certFile) = ensureKeys(context)
            val privateKeyPem = keyFile.readText(StandardCharsets.UTF_8)
            val certPem = certFile.readText(StandardCharsets.UTF_8)
            val privateKey = AdbClient.loadKey(privateKeyPem)

            var adbClient: AdbClient? = null
            var lastError: String? = null

            for (host in listOf("127.0.0.1", "::1")) {
                val c = AdbClient()
                c.setClientCert(privateKey, certPem)
                try {
                    if (c.connect(host, connectPort, privateKey)) {
                        adbClient = c
                        break
                    }
                } catch (e: Exception) {
                    lastError = e.message
                    try { c.close() } catch (_: Exception) {}
                }
            }

            if (adbClient == null) {
                return@withContext StartResult(
                    false,
                    "Could not connect to port $connectPort (${lastError ?: "connection refused"}).\nMake sure Wireless Debugging is ON and the port matches."
                )
            }

            setLastConnectPort(context, connectPort)
            setPaired(context, true)

            val startCmd = "pm grant com.coldcalling.app android.permission.WRITE_SECURE_SETTINGS 2>/dev/null; " +
                    "APK=\$(pm path com.coldcalling.app | head -n1 | cut -d: -f2); " +
                    "export CLASSPATH=\$APK; " +
                    "setsid app_process / com.coldcalling.app.recording.StandaloneDaemon >/data/local/tmp/daemon.log 2>&1 </dev/null & " +
                    "sleep 1; " +
                    "echo STARTED"

            val output = adbClient.shell(startCmd).trim()
            Log.d(TAG, "Shell start output: $output")
            adbClient.close()

            var running = false
            for (i in 1..6) {
                if (StandaloneEngineClient.isAvailable()) {
                    running = true
                    break
                }
                delay(400)
            }

            if (running) {
                StandaloneEngineClient.disableWirelessDebugging(context)
                StartResult(true, "Recorder Engine started & Wireless Debugging auto-turned OFF for UPI!")
            } else {
                StartResult(false, "Daemon launched (PID: $output) but TCP port not ready yet. Tap Refresh in 2 seconds.")
            }
        } catch (e: Exception) {
            Log.e(TAG, "startEngine error", e)
            StartResult(false, "Error starting engine: ${e.message}")
        }
    }

    /**
     * Zero-touch self-healing: If StandaloneDaemon is not running (e.g. after a phone reboot)
     * and the user is NOT in Banking Safe Mode, uses WRITE_SECURE_SETTINGS to briefly enable
     * Wireless Debugging, discovers the port via mDNS, starts StandaloneDaemon, and immediately
     * turns Wireless Debugging back OFF so UPI apps remain unaffected.
     */
    suspend fun autoHealEngineIfNeeded(context: Context): Boolean = withContext(Dispatchers.IO) {
        autoHealMutex.withLock {
            try {
                if (StandaloneEngineClient.isAvailable()) return@withLock true
                if (com.coldcalling.app.data.CallStore.isRecordingPaused(context)) {
                    Log.d(TAG, "Auto-heal skipped: Banking Safe Mode is active")
                    return@withLock false
                }
                if (!isPaired(context)) {
                    Log.d(TAG, "Auto-heal skipped: Device not paired yet")
                    return@withLock false
                }

                // 1. Try existing mDNS port or cached port first in case Wireless Debugging is already ON
                val initialPort = discoverConnectPort(context, 900).let {
                    if (it > 0) it else getLastConnectPort(context)
                }
                if (initialPort > 0) {
                    val res = startEngine(context, initialPort)
                    if (res.success && StandaloneEngineClient.isAvailable()) {
                        notifyStatusChanged(context)
                        return@withLock true
                    }
                }

                // 2. Use WRITE_SECURE_SETTINGS to temporarily turn adb_wifi_enabled = 1 (with 60s cooldown)
                val now = System.currentTimeMillis()
                if (now - lastAutoHealAttemptMs < 60_000L) {
                    return@withLock false
                }
                lastAutoHealAttemptMs = now

                val toggledWifiAdb: Boolean
                try {
                    android.provider.Settings.Global.putInt(context.contentResolver, "adb_wifi_enabled", 1)
                    toggledWifiAdb = true
                    Log.i(TAG, "Auto-heal: Temporarily enabled adb_wifi_enabled=1 via WRITE_SECURE_SETTINGS")
                } catch (se: SecurityException) {
                    Log.w(TAG, "Auto-heal: WRITE_SECURE_SETTINGS not granted yet (${se.message})")
                    return@withLock false
                } catch (e: Exception) {
                    Log.w(TAG, "Auto-heal: Could not set adb_wifi_enabled=1 (${e.message})")
                    return@withLock false
                }

                try {
                    for (attempt in 1..3) {
                        delay(650)
                        val port = discoverConnectPort(context, 1800)
                        if (port > 0) {
                            Log.i(TAG, "Auto-heal: Discovered Wireless ADB port $port on attempt $attempt")
                            val res = startEngine(context, port)
                            if (res.success || StandaloneEngineClient.isAvailable()) {
                                Log.i(TAG, "Auto-heal succeeded! StandaloneDaemon is now active.")
                                notifyStatusChanged(context)
                                return@withLock true
                            }
                        }
                    }
                } finally {
                    if (toggledWifiAdb) {
                        runCatching {
                            android.provider.Settings.Global.putInt(context.contentResolver, "adb_wifi_enabled", 0)
                            Log.i(TAG, "Auto-heal: Restored adb_wifi_enabled=0 for UPI compatibility")
                        }
                    }
                }

                StandaloneEngineClient.isAvailable()
            } catch (e: Exception) {
                Log.w(TAG, "autoHealEngineIfNeeded error: ${e.message}")
                false
            }
        }
    }

    private fun notifyStatusChanged(context: Context) {
        runCatching {
            val intent = android.content.Intent(WirelessAdbService.ACTION_ENGINE_STATUS_CHANGED).apply {
                setPackage(context.packageName)
            }
            context.sendBroadcast(intent)
        }
    }
}
