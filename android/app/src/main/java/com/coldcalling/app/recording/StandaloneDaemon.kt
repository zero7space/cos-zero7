package com.coldcalling.app.recording

import android.net.LocalServerSocket
import android.net.LocalSocket
import java.io.BufferedReader
import java.io.File
import java.io.InputStream
import java.io.InputStreamReader
import java.io.OutputStream
import java.io.PrintWriter
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.atomic.AtomicBoolean
import java.util.zip.ZipFile
import kotlin.system.exitProcess

object StandaloneDaemon {
    const val PORT = 58432
    private const val TAG = "StandaloneDaemon"
    private const val SCRCPY_JAR_PATH = "/data/local/tmp/scrcpy-server"

    @Volatile
    private var activeSessionThread: Thread? = null

    @Volatile
    private var activeProcess: Process? = null

    @Volatile
    private var activeLocalServerSocket: LocalServerSocket? = null

    @Volatile
    private var activeScrcpySocket: LocalSocket? = null

    private val isRecording = AtomicBoolean(false)

    @JvmStatic
    fun main(args: Array<String>) {
        println("==================================================")
        println("Cold Calling Pro Standalone Daemon")
        println("UID: ${android.os.Process.myUid()} (Shell)")
        println("Listening on 127.0.0.1:$PORT")
        println("==================================================")

        ensureScrcpyServerExtracted()
        grantWriteSecureSettingsAndAutoDisableWifiAdb()

        try {
            val serverSocket = ServerSocket(PORT, 10, InetAddress.getByName("127.0.0.1"))
            println("DAEMON_READY_ON_PORT:$PORT")

            while (true) {
                val client = serverSocket.accept()
                Thread {
                    handleClient(client)
                }.start()
            }
        } catch (e: Exception) {
            System.err.println("Fatal daemon error: ${e.message}")
            e.printStackTrace()
            exitProcess(1)
        }
    }

    private fun grantWriteSecureSettingsAndAutoDisableWifiAdb() {
        Thread {
            try {
                Runtime.getRuntime().exec(
                    arrayOf(
                        "sh", "-c",
                        "pm grant com.coldcalling.app android.permission.WRITE_SECURE_SETTINGS 2>/dev/null; " +
                        "settings put global settings_enable_monitor_phantom_procs false 2>/dev/null; " +
                        "device_config set_sync_disabled_for_tests persistent 2>/dev/null; " +
                        "device_config put activity_manager max_phantom_processes 2147483647 2>/dev/null"
                    )
                ).waitFor()
                Thread.sleep(1500)
                Runtime.getRuntime().exec(
                    arrayOf("sh", "-c", "settings put global adb_wifi_enabled 0 2>/dev/null")
                ).waitFor()
                println("Granted WRITE_SECURE_SETTINGS, disabled phantom process killer, and auto-disabled Wireless Debugging (adb_wifi_enabled=0)")
            } catch (e: Exception) {
                System.err.println("Failed to auto-disable wireless debugging: ${e.message}")
            }
        }.start()
    }

    private fun ensureScrcpyServerExtracted() {
        val target = File(SCRCPY_JAR_PATH)
        if (target.exists() && target.length() > 100000) {
            println("scrcpy-server present at $SCRCPY_JAR_PATH (${target.length()} bytes)")
            return
        }

        // Try to extract from our APK
        try {
            val apkPath = getApkPath()
            if (apkPath != null && File(apkPath).exists()) {
                println("Extracting scrcpy-server from $apkPath...")
                ZipFile(apkPath).use { zip ->
                    val entry = zip.getEntry("assets/scrcpy-server")
                    if (entry != null) {
                        zip.getInputStream(entry).use { input ->
                            target.outputStream().use { output ->
                                input.copyTo(output)
                            }
                        }
                        target.setReadable(true, false)
                        target.setExecutable(true, false)
                        println("Extracted scrcpy-server successfully (${target.length()} bytes)")
                        return
                    }
                }
            }
        } catch (e: Exception) {
            System.err.println("Failed to extract scrcpy-server: ${e.message}")
        }
    }

    private fun getApkPath(): String? {
        val classpath = System.getenv("CLASSPATH")
        if (!classpath.isNullOrBlank()) {
            val parts = classpath.split(":")
            for (p in parts) {
                if (p.contains("com.coldcalling.app")) return p
            }
        }

        return try {
            val p = Runtime.getRuntime().exec(arrayOf("sh", "-c", "pm path com.coldcalling.app | head -n1 | cut -d: -f2"))
            val reader = BufferedReader(InputStreamReader(p.inputStream))
            val line = reader.readLine()?.trim()
            p.waitFor()
            if (!line.isNullOrBlank() && File(line).exists()) line else null
        } catch (_: Exception) {
            null
        }
    }

    private fun handleClient(socket: Socket) {
        var writer: PrintWriter? = null
        try {
            socket.tcpNoDelay = true
            val reader = BufferedReader(InputStreamReader(socket.getInputStream()))
            writer = PrintWriter(socket.getOutputStream(), true)

            val line = reader.readLine() ?: return
            val parts = line.trim().split(" ")
            val cmd = parts[0].uppercase()

            when (cmd) {
                "PING" -> {
                    writer.println("PONG")
                    socket.close()
                }

                "STATUS" -> {
                    writer.println(if (isRecording.get()) "RECORDING" else "IDLE")
                    socket.close()
                }

                "STOP" -> {
                    stopCurrentRecording()
                    writer.println("STOPPED")
                    socket.close()
                }

                "DISABLE_DEBUGGING" -> {
                    try {
                        Runtime.getRuntime().exec(
                            arrayOf("sh", "-c", "settings put global adb_wifi_enabled 0 2>/dev/null")
                        ).waitFor()
                        writer.println("OK")
                    } catch (e: Exception) {
                        writer.println("ERROR ${e.message}")
                    }
                    socket.close()
                }

                "START" -> {
                    // Syntax: START <audioSource> <audioCodec> <bitRate>
                    val audioSource = if (parts.size > 1) parts[1] else "mic-voice-communication"
                    val audioCodec = if (parts.size > 2) parts[2] else "opus"
                    val bitRate = if (parts.size > 3) parts[3].toIntOrNull() ?: 128000 else 128000

                    handleRecordSession(socket, writer, audioSource, audioCodec, bitRate)
                }

                else -> {
                    writer.println("ERROR Unknown command: $cmd")
                    socket.close()
                }
            }
        } catch (e: Exception) {
            System.err.println("handleClient error: ${e.message}")
            runCatching { socket.close() }
        }
    }

    private fun handleRecordSession(
        clientSocket: Socket,
        writer: PrintWriter,
        audioSource: String,
        audioCodec: String,
        bitRate: Int
    ) {
        if (!isRecording.compareAndSet(false, true)) {
            writer.println("ERROR Session already active")
            clientSocket.close()
            return
        }

        println("Starting recording session: source=$audioSource codec=$audioCodec bitrate=$bitRate")
        ensureScrcpyServerExtracted()

        val scid = "%08x".format((Math.random() * 0x7FFFFFFF).toInt())
        val socketName = "scrcpy_$scid"

        var localServer: LocalServerSocket? = null
        var scrcpyProc: Process? = null
        var scrcpySock: LocalSocket? = null

        try {
            localServer = LocalServerSocket(socketName)
            activeLocalServerSocket = localServer
            println("LocalServerSocket opened: $socketName")

            val cmd = mutableListOf(
                "app_process", "/", "com.genymobile.scrcpy.Server",
                "4.0",
                "log_level=info",
                "video=false",
                "audio=true",
                "control=false",
                "tunnel_forward=false",
                "send_dummy_byte=false",
                "scid=$scid",
                "audio_source=$audioSource",
                "audio_codec=$audioCodec",
                "audio_bit_rate=$bitRate",
                "send_device_meta=false",
                "send_frame_meta=true",
                "send_stream_meta=true"
            )

            val builder = ProcessBuilder(cmd)
            builder.environment()["CLASSPATH"] = SCRCPY_JAR_PATH
            builder.redirectErrorStream(true)
            scrcpyProc = builder.start()
            activeProcess = scrcpyProc
            println("scrcpy-server process started (PID: ${getProcessPid(scrcpyProc)})")

            // Pipe scrcpy-server logs to stderr
            Thread {
                try {
                    val logReader = BufferedReader(InputStreamReader(scrcpyProc.inputStream))
                    while (true) {
                        val l = logReader.readLine() ?: break
                        println("[scrcpy-server] $l")
                    }
                } catch (_: Exception) {}
            }.start()

            // Wait for scrcpy-server to connect
            scrcpySock = localServer.accept()
            activeScrcpySocket = scrcpySock
            println("scrcpy-server connected to local socket")

            // Send OK line to client, then switch clientSocket to binary streaming
            writer.println("OK")
            writer.flush()

            val scrcpyIn: InputStream = scrcpySock.inputStream
            val clientOut: OutputStream = clientSocket.getOutputStream()
            val buffer = ByteArray(32 * 1024)

            while (isRecording.get()) {
                val read = scrcpyIn.read(buffer)
                if (read == -1) break
                clientOut.write(buffer, 0, read)
                clientOut.flush()
            }
            println("Recording stream relay finished cleanly")
        } catch (e: Exception) {
            println("Relay exception: ${e.message}")
        } finally {
            isRecording.set(false)
            runCatching { scrcpySock?.close() }
            runCatching { localServer?.close() }
            runCatching { scrcpyProc?.destroy() }
            runCatching { clientSocket.close() }
            activeScrcpySocket = null
            activeLocalServerSocket = null
            activeProcess = null
            println("Recording session cleaned up completely")
        }
    }

    private fun stopCurrentRecording() {
        if (isRecording.compareAndSet(true, false)) {
            println("stopCurrentRecording requested")
            runCatching { activeScrcpySocket?.close() }
            runCatching { activeLocalServerSocket?.close() }
            runCatching { activeProcess?.destroy() }
            activeScrcpySocket = null
            activeLocalServerSocket = null
            activeProcess = null
        }
    }

    private fun getProcessPid(p: Process): Long {
        return try {
            val field = p.javaClass.getDeclaredField("pid")
            field.isAccessible = true
            field.getLong(p)
        } catch (_: Exception) {
            -1L
        }
    }
}
