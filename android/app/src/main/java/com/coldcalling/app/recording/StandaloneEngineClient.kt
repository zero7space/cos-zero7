package com.coldcalling.app.recording

import android.content.Context
import android.provider.Settings
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.BufferedReader
import java.io.InputStream
import java.io.InputStreamReader
import java.io.PrintWriter
import java.net.InetSocketAddress
import java.net.Socket

object StandaloneEngineClient {
    private const val TAG = "EngineClient"
    const val HOST = "127.0.0.1"
    const val PORT = 58432

    suspend fun disableWirelessDebugging(context: Context, timeoutMs: Int = 800): Boolean = withContext(Dispatchers.IO) {
        var success = false
        try {
            Settings.Global.putInt(context.contentResolver, "adb_wifi_enabled", 0)
            success = true
            Log.i(TAG, "Disabled adb_wifi_enabled via Settings.Global")
        } catch (e: Exception) {
            Log.w(TAG, "Direct Settings.Global.putInt failed (${e.message}), trying StandaloneDaemon...")
        }

        try {
            Socket().use { socket ->
                socket.connect(InetSocketAddress(HOST, PORT), timeoutMs)
                socket.soTimeout = timeoutMs
                val writer = PrintWriter(socket.getOutputStream(), true)
                val reader = BufferedReader(InputStreamReader(socket.getInputStream()))
                writer.println("DISABLE_DEBUGGING")
                val response = reader.readLine()
                if (response == "OK") {
                    success = true
                    Log.i(TAG, "Disabled adb_wifi_enabled via StandaloneDaemon")
                }
            }
        } catch (_: Exception) {}

        return@withContext success
    }

    suspend fun isAvailable(timeoutMs: Int = 500): Boolean = withContext(Dispatchers.IO) {
        try {
            Socket().use { socket ->
                socket.connect(InetSocketAddress(HOST, PORT), timeoutMs)
                socket.soTimeout = timeoutMs
                val writer = PrintWriter(socket.getOutputStream(), true)
                val reader = BufferedReader(InputStreamReader(socket.getInputStream()))
                writer.println("PING")
                val response = reader.readLine()
                return@withContext response == "PONG"
            }
        } catch (_: Exception) {
            false
        }
    }

    suspend fun startCapture(
        audioSource: String,
        audioCodec: String,
        audioBitRate: Int,
        timeoutMs: Int = 5000
    ): ActiveCaptureSession = withContext(Dispatchers.IO) {
        Log.i(TAG, "Connecting to StandaloneDaemon on $HOST:$PORT...")
        val socket = Socket()
        socket.tcpNoDelay = true
        socket.connect(InetSocketAddress(HOST, PORT), timeoutMs)
        socket.soTimeout = timeoutMs

        val out = socket.getOutputStream()
        val rawIn = socket.getInputStream()

        // Send START command as ASCII line
        val cmd = "START $audioSource $audioCodec $audioBitRate\n"
        out.write(cmd.toByteArray(Charsets.US_ASCII))
        out.flush()

        // Read ACK line byte-by-byte from rawIn to ensure NO binary audio stream bytes are consumed!
        val ackBuilder = StringBuilder()
        while (true) {
            val b = rawIn.read()
            if (b == -1) break
            if (b == '\n'.code) break
            if (b != '\r'.code) {
                ackBuilder.append(b.toChar())
            }
        }
        val ack = ackBuilder.toString().trim()
        if (ack != "OK") {
            socket.close()
            throw IllegalStateException("Daemon rejected recording session: $ack")
        }

        // Reset soTimeout to 0 (infinite) for streaming audio
        socket.soTimeout = 0
        Log.i(TAG, "Recording stream initialized successfully via StandaloneDaemon (exact byte alignment preserved)")
        return@withContext ActiveCaptureSession(socket, rawIn)
    }

    data class ActiveCaptureSession(
        val socket: Socket,
        val inputStream: InputStream
    ) : AutoCloseable {
        override fun close() {
            runCatching {
                if (!socket.isClosed) {
                    socket.close()
                }
            }
        }
    }
}
