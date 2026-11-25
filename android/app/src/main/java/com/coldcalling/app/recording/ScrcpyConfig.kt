package com.coldcalling.app.recording

import android.content.Context
import android.os.Build
import com.coldcalling.app.BuildConfig
import java.security.SecureRandom

object ScrcpyConfig {
    const val SCRCPY_VERSION: String = BuildConfig.SCRCPY_VERSION
    const val EXPECTED_SERVER_SHA256: String = BuildConfig.SCRCPY_SERVER_SHA256
    const val SERVER_MAIN_CLASS = "com.genymobile.scrcpy.Server"
    const val SERVER_SOCKET_NAME_PREFIX = "scrcpy_"
    const val AUDIO_SAMPLE_RATE = 48000
    const val AUDIO_CHANNELS = 2

    fun getServerPath(context: Context): String {
        val folder = context.getExternalFilesDir(null)
            ?: context.externalCacheDir
            ?: throw IllegalStateException("Shared storage unavailable.")
        return folder.absolutePath + "/scrcpy-${SCRCPY_VERSION}-server.jar"
    }

    fun buildServerArgs(
        socketName: String,
        audioSource: ScrcpyAudioSource,
        audioCodec: ScrcpyAudioCodec,
        audioBitRate: Int
    ): List<String> {
        val args = mutableListOf(
            SCRCPY_VERSION,
            "log_level=info",
            "video=false",
            "audio=true",
            "control=false",
            "tunnel_forward=false",
            "send_dummy_byte=false",
            "scid=$socketName",
            "audio_source=${audioSource.cliKey}",
            "audio_codec=${audioCodec.cliKey}",
            "send_device_meta=false",
            "send_frame_meta=true",
            "send_stream_meta=true"
        )
        if (audioBitRate > 0) {
            args.add("audio_bit_rate=$audioBitRate")
        }
        if (audioSource == ScrcpyAudioSource.PLAYBACK && Build.VERSION.SDK_INT >= 33) {
            args.add("audio_dup=true")
        }
        return args
    }

    fun getRandomSocketName(): String {
        return SecureRandom().nextInt(Int.MAX_VALUE).toString(16).padStart(8, '0')
    }
}
