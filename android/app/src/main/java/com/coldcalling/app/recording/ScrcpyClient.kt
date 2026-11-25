package com.coldcalling.app.recording

import android.util.Log
import java.io.BufferedInputStream
import java.io.Closeable
import java.io.DataInputStream
import java.io.EOFException
import java.io.IOException
import java.io.InputStream

class ScrcpyClient(
    private val inputStream: InputStream,
    private val expectedCodec: ScrcpyAudioCodec,
    private val listener: AudioPacketListener
) : Closeable {

    companion object {
        private const val TAG = "ScrcpyClient"
        private const val MEDIA_PACKET_FLAG = 1L shl 63
        private const val PACKET_FLAG_CONFIG = 1L shl 62
        private const val PACKET_FLAG_KEY_FRAME = 1L shl 61
        private const val MAX_PACKET_SIZE = 1 * 1024 * 1024 // 1 MiB
    }

    interface AudioPacketListener {
        fun onMetadataReceived(codec: ScrcpyAudioCodec)
        fun onAudioPacket(packet: AudioPacket)
        fun onStreamEnd(error: String?)
    }

    data class AudioPacket(
        val ptsUs: Long,
        val isConfig: Boolean,
        val isKeyFrame: Boolean,
        val data: ByteArray
    ) {
        override fun equals(other: Any?): Boolean {
            if (this === other) return true
            if (other !is AudioPacket) return false
            return ptsUs == other.ptsUs && isConfig == other.isConfig &&
                   isKeyFrame == other.isKeyFrame && data.contentEquals(other.data)
        }
        override fun hashCode(): Int = data.contentHashCode()
    }

    @Volatile
    private var isRunning = false
    private var dataInputStream: DataInputStream? = null

    fun start() {
        isRunning = true
        var fatalError: String? = null

        try {
            val dis = DataInputStream(BufferedInputStream(inputStream, 64 * 1024))
            dataInputStream = dis

            // 1. Read 4-byte FourCC codec header
            val codecFourCC = dis.readInt()
            val resolvedCodec = try {
                ScrcpyAudioCodec.fromFourCC(codecFourCC)
            } catch (e: Exception) {
                Log.w(TAG, "Unknown codec FourCC: $codecFourCC, defaulting to $expectedCodec")
                expectedCodec
            }
            listener.onMetadataReceived(resolvedCodec)

            // 2. Read packets
            while (isRunning) {
                val rawPts = try {
                    dis.readLong()
                } catch (e: EOFException) {
                    break
                }

                val packetSize = dis.readInt()
                if (packetSize < 0 || packetSize > MAX_PACKET_SIZE) {
                    throw IOException("Invalid packet size: $packetSize")
                }

                val isConfig = (rawPts and PACKET_FLAG_CONFIG) != 0L
                val isKeyFrame = (rawPts and PACKET_FLAG_KEY_FRAME) != 0L
                val ptsUs = rawPts and 0x1FFFFFFFFFFFFFFFL

                val payload = ByteArray(packetSize)
                dis.readFully(payload)

                val packet = AudioPacket(
                    ptsUs = ptsUs,
                    isConfig = isConfig,
                    isKeyFrame = isKeyFrame,
                    data = payload
                )
                listener.onAudioPacket(packet)
            }
        } catch (e: EOFException) {
            Log.d(TAG, "Audio stream reached EOF")
        } catch (e: Exception) {
            if (isRunning) {
                fatalError = e.message ?: "Unknown stream error"
                Log.w(TAG, "Stream reading interrupted: $fatalError")
            }
        } finally {
            isRunning = false
            listener.onStreamEnd(fatalError)
            close()
        }
    }

    override fun close() {
        isRunning = false
        try {
            dataInputStream?.close()
        } catch (_: Exception) {}
        try {
            inputStream.close()
        } catch (_: Exception) {}
    }
}
