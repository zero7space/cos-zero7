package com.coldcalling.app.recording

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import android.os.Environment
import android.os.ParcelFileDescriptor
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class AudioRecordingEngine {

    companion object {
        private const val TAG = "AudioRecordingEngine"

        fun resolveOutputDir(context: Context): File {
            try {
                val canUsePublicDocs = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    Environment.isExternalStorageManager()
                } else {
                    true
                }
                if (canUsePublicDocs) {
                    val docsDir = File(Environment.getExternalStorageDirectory(), "Documents")
                    if (!docsDir.exists()) docsDir.mkdirs()
                    if (docsDir.exists() && docsDir.canWrite()) {
                        return docsDir
                    }
                }
            } catch (_: Exception) {}

            val appDir = File(context.getExternalFilesDir(null) ?: context.filesDir, "Recordings")
            if (!appDir.exists()) appDir.mkdirs()
            return appDir
        }
    }

    private var scrcpyClient: ScrcpyClient? = null
    private var scrcpyAudioMuxer: ScrcpyAudioMuxer? = null
    private var activeCaptureSession: StandaloneEngineClient.ActiveCaptureSession? = null
    private var outputPfd: ParcelFileDescriptor? = null
    private var mediaRecorder: MediaRecorder? = null

    var recordedFile: File? = null
        private set

    var activeMode: String = "NONE"
        private set

    private var audioPipeReadScope: CoroutineScope? = null
    private var audioPipeReadJob: Job? = null

    suspend fun startPipeline(
        context: Context,
        phone: String,
        direction: String = "out"
    ) {
        val outDir = resolveOutputDir(context)
        val timeStr = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
        val cleanPhone = phone.replace(Regex("[^0-9+]"), "").ifEmpty { "Unknown" }

        if (!StandaloneEngineClient.isAvailable()) {
            Log.i(TAG, "StandaloneDaemon not running; attempting zero-touch auto-heal...")
            com.coldcalling.app.recording.wireless.WirelessAdbManager.autoHealEngineIfNeeded(context)
        }

        if (StandaloneEngineClient.isAvailable()) {
            try {
                startEnhancedStandalonePipeline(outDir, timeStr, direction, cleanPhone)
                activeMode = "ENHANCED_2WAY"
                return
            } catch (e: Exception) {
                Log.w(TAG, "Enhanced 2-Way pipeline failed (${e.message}), falling back to direct MediaRecorder")
                cleanupEnhancedResources()
            }
        }

        startStandardMediaRecorderFallback(context, outDir, timeStr, direction, cleanPhone)
        activeMode = "STANDARD_DIRECT"
    }

    private suspend fun startEnhancedStandalonePipeline(
        outDir: File,
        timeStr: String,
        direction: String,
        cleanPhone: String
    ) {
        val fileName = "${timeStr}_${direction}_${cleanPhone}.ogg"
        val outFile = File(outDir, fileName)
        recordedFile = outFile
        RecordingForegroundService.activeRecordingPath = outFile.absolutePath

        outputPfd = ParcelFileDescriptor.open(
            outFile,
            ParcelFileDescriptor.MODE_READ_WRITE or ParcelFileDescriptor.MODE_CREATE
        )

        scrcpyAudioMuxer = ScrcpyAudioMuxer(outputPfd!!.fileDescriptor, outFile.name)

        val codec = ScrcpyAudioCodec.OPUS
        val source = ScrcpyAudioSource.VOICE_COMMUNICATION

        Log.i(TAG, "Starting StandaloneEngine session: source=${source.cliKey} codec=${codec.cliKey}")
        val session = StandaloneEngineClient.startCapture(
            source.cliKey,
            codec.cliKey,
            codec.defaultBitRate
        )
        activeCaptureSession = session

        scrcpyAudioMuxer?.initialize(codec)

        scrcpyClient = ScrcpyClient(
            inputStream = session.inputStream,
            expectedCodec = codec,
            listener = object : ScrcpyClient.AudioPacketListener {
                override fun onMetadataReceived(confirmedCodec: ScrcpyAudioCodec) {
                    Log.d(TAG, "Stream metadata confirmed: ${confirmedCodec.cliKey}")
                    scrcpyAudioMuxer?.initialize(confirmedCodec)
                }

                override fun onAudioPacket(packet: ScrcpyClient.AudioPacket) {
                    scrcpyAudioMuxer?.writePacket(packet, codec)
                }

                override fun onStreamEnd(error: String?) {
                    if (error != null) {
                        Log.w(TAG, "Audio stream ended with error: $error")
                    } else {
                        Log.d(TAG, "Audio stream ended normally")
                    }
                }
            }
        )

        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        audioPipeReadScope = scope
        audioPipeReadJob = scope.launch(Dispatchers.IO) {
            try {
                scrcpyClient?.start()
            } catch (e: Exception) {
                Log.w(TAG, "Audio reader stopped: ${e.message}")
            }
        }
    }

    private fun startStandardMediaRecorderFallback(
        context: Context,
        outDir: File,
        timeStr: String,
        direction: String,
        cleanPhone: String
    ) {
        val fileName = "${timeStr}_${direction}_${cleanPhone}.m4a"
        val outFile = File(outDir, fileName)
        recordedFile = outFile
        RecordingForegroundService.activeRecordingPath = outFile.absolutePath

        val sources = listOf(
            MediaRecorder.AudioSource.VOICE_RECOGNITION,
            MediaRecorder.AudioSource.VOICE_COMMUNICATION,
            MediaRecorder.AudioSource.MIC
        )

        var lastError: Exception? = null
        for (source in sources) {
            var mr: MediaRecorder? = null
            try {
                if (outFile.exists()) outFile.delete()
                mr = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    MediaRecorder(context)
                } else {
                    @Suppress("DEPRECATION")
                    MediaRecorder()
                }
                mr.setAudioSource(source)
                mr.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                mr.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                mr.setAudioSamplingRate(44100)
                mr.setAudioEncodingBitRate(128000)
                mr.setOutputFile(outFile.absolutePath)
                mr.prepare()
                mr.start()
                mediaRecorder = mr
                Log.i(TAG, "Standard MediaRecorder fallback started (source=$source) -> ${outFile.absolutePath}")
                return
            } catch (e: Exception) {
                lastError = e
                Log.w(TAG, "MediaRecorder source $source failed: ${e.message}")
                runCatching { mr?.reset() }
                runCatching { mr?.release() }
            }
        }
        throw IllegalStateException("All fallback audio sources failed: ${lastError?.message}")
    }

    private fun cleanupEnhancedResources() {
        runCatching { activeCaptureSession?.close() }
        runCatching { scrcpyClient?.close() }
        runCatching { scrcpyAudioMuxer?.close() }
        runCatching { outputPfd?.close() }
        runCatching {
            val f = recordedFile
            if (f != null && f.exists() && f.length() == 0L) f.delete()
        }
        activeCaptureSession = null
        scrcpyClient = null
        scrcpyAudioMuxer = null
        outputPfd = null
    }

    fun release() {
        Log.i(TAG, "Releasing audio recording pipeline (mode=$activeMode)...")

        mediaRecorder?.let { mr ->
            runCatching { mr.stop() }
            runCatching { mr.reset() }
            runCatching { mr.release() }
        }
        mediaRecorder = null

        runCatching { activeCaptureSession?.close() }

        runCatching {
            runBlocking {
                withTimeoutOrNull(2000L) {
                    audioPipeReadJob?.join()
                }
            }
        }

        runCatching { scrcpyClient?.close() }
        runCatching { scrcpyAudioMuxer?.close() }
        runCatching { outputPfd?.close() }

        scrcpyClient = null
        scrcpyAudioMuxer = null
        activeCaptureSession = null
        outputPfd = null

        val f = recordedFile
        if (f != null && f.exists() && f.length() == 0L) {
            runCatching { f.delete() }
        }
        Log.i(TAG, "Audio recording pipeline released. Output: ${recordedFile?.absolutePath} (size: ${recordedFile?.length() ?: 0} bytes)")
    }
}
