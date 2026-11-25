package com.coldcalling.app.recording

import android.media.MediaCodec
import android.media.MediaFormat
import android.media.MediaMuxer
import android.util.Log
import java.io.Closeable
import java.io.FileDescriptor
import java.nio.ByteBuffer

class ScrcpyAudioMuxer(
    private val outputFileDescriptor: FileDescriptor,
    private val outputDisplayPath: String
) : Closeable {

    companion object {
        private const val TAG = "ScrcpyAudioMuxer"
        private const val GAP_THRESHOLD_NANOS = 400_000_000L
        private const val GAP_SLACK_NANOS = 25_000_000L
    }

    private var muxer: MediaMuxer? = null
    private var audioTrackIndex = -1
    private var isMuxerStarted = false
    private var firstPtsUs: Long = -1L
    private var firstPacketTimeNanos: Long = -1L
    private var lastWrittenPtsUs: Long = -1L

    fun initialize(codec: ScrcpyAudioCodec) {
        if (muxer != null) return
        Log.d(TAG, "Initializing muxer for ${codec.cliKey}: $outputDisplayPath")
        muxer = MediaMuxer(outputFileDescriptor, codec.outputFormat)
    }

    fun writePacket(packet: ScrcpyClient.AudioPacket, codec: ScrcpyAudioCodec) {
        val currentMuxer = muxer ?: run {
            initialize(codec)
            muxer!!
        }

        if (packet.isConfig) {
            if (audioTrackIndex != -1) {
                Log.w(TAG, "Duplicate config packet ignored")
                return
            }

            val format = MediaFormat.createAudioFormat(
                codec.mimeType,
                ScrcpyConfig.AUDIO_SAMPLE_RATE,
                ScrcpyConfig.AUDIO_CHANNELS
            )

            // CSD buffer
            val csdBuffer = ByteBuffer.wrap(packet.data)
            format.setByteBuffer("csd-0", csdBuffer)

            try {
                audioTrackIndex = currentMuxer.addTrack(format)
                currentMuxer.start()
                isMuxerStarted = true
                Log.i(TAG, "Muxer started with track index: $audioTrackIndex")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to start MediaMuxer", e)
            }
            return
        }

        if (!isMuxerStarted || audioTrackIndex == -1) {
            // Drop packets before track is configured
            return
        }

        var ptsUs: Long
        if (packet.ptsUs > 0) {
            if (firstPtsUs == -1L) {
                firstPtsUs = packet.ptsUs
                ptsUs = 0L
            } else {
                ptsUs = (packet.ptsUs - firstPtsUs).coerceAtLeast(0L)
            }
        } else {
            val nowNanos = System.nanoTime()
            if (firstPacketTimeNanos == -1L) {
                firstPacketTimeNanos = nowNanos
            }
            ptsUs = ((nowNanos - firstPacketTimeNanos) / 1000L).coerceAtLeast(0L)
        }

        // Ensure strictly increasing presentation timestamps
        if (ptsUs <= lastWrittenPtsUs) {
            ptsUs = lastWrittenPtsUs + 20_000L // 20ms standard audio frame
        }
        lastWrittenPtsUs = ptsUs

        val bufferInfo = MediaCodec.BufferInfo().apply {
            offset = 0
            size = packet.data.size
            presentationTimeUs = ptsUs
            flags = if (packet.isKeyFrame) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0
        }

        val byteBuffer = ByteBuffer.wrap(packet.data)
        try {
            currentMuxer.writeSampleData(audioTrackIndex, byteBuffer, bufferInfo)
        } catch (e: Exception) {
            Log.e(TAG, "Error writing sample data to muxer", e)
        }
    }

    override fun close() {
        val currentMuxer = muxer ?: return
        try {
            if (isMuxerStarted) {
                currentMuxer.stop()
                Log.d(TAG, "MediaMuxer stopped successfully")
            }
            currentMuxer.release()
        } catch (e: Exception) {
            Log.w(TAG, "Exception while closing MediaMuxer: ${e.message}")
        } finally {
            muxer = null
            isMuxerStarted = false
            audioTrackIndex = -1
        }
    }
}
