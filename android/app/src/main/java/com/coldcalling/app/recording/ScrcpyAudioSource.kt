package com.coldcalling.app.recording

enum class ScrcpyAudioSource(
    val cliKey: String
) {
    VOICE_CALL("voice-call"),
    VOICE_COMMUNICATION("mic-voice-communication"),
    PLAYBACK("playback"),
    MIC("mic");

    companion object {
        fun fromKey(key: String): ScrcpyAudioSource =
            entries.firstOrNull { it.cliKey == key } ?: VOICE_CALL
    }
}
