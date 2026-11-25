package com.coldcalling.app.recording

import android.annotation.SuppressLint
import android.content.Context
import android.util.Log
import androidx.annotation.WorkerThread
import com.coldcalling.app.BuildConfig
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.security.MessageDigest

object ServerExtractor {
    private const val TAG = "ServerExtractor"

    @WorkerThread
    fun ensureServerFile(context: Context, serverPath: String): Boolean {
        val file = File(serverPath)
        if (file.exists() && verifyServerHash(file)) {
            Log.d(TAG, "Server file already present and verified at $serverPath")
            return true
        }
        Log.d(TAG, "Extracting server file from assets to $serverPath...")
        return extractFromAssets(context, file)
    }

    private fun extractFromAssets(context: Context, destFile: File): Boolean {
        return try {
            context.assets.open(BuildConfig.SCRCPY_SERVER_ASSET_NAME).use { inputStream ->
                writeFile(destFile, inputStream)
            }
            val verified = verifyServerHash(destFile)
            if (verified) {
                Log.d(TAG, "Server extracted and verified: ${destFile.path}")
            } else {
                Log.w(TAG, "Server extraction succeeded but hash verification failed")
            }
            verified
        } catch (e: Exception) {
            Log.e(TAG, "Asset extraction failed: ${e.message}", e)
            false
        }
    }

    @SuppressLint("SetWorldReadable")
    private fun writeFile(destFile: File, input: InputStream) {
        destFile.parentFile?.mkdirs()
        FileOutputStream(destFile).use { output ->
            val buffer = ByteArray(8 * 1024)
            var bytesRead = input.read(buffer)
            while (bytesRead > 0) {
                output.write(buffer, 0, bytesRead)
                bytesRead = input.read(buffer)
            }
        }
        destFile.setReadable(true, false)
    }

    fun verifyServerHash(file: File): Boolean {
        if (!file.exists()) return false

        return try {
            val digest = MessageDigest.getInstance("SHA-256")
            file.inputStream().use { inputStream ->
                val buffer = ByteArray(8192)
                var bytesRead: Int
                while (inputStream.read(buffer).also { bytesRead = it } != -1) {
                    digest.update(buffer, 0, bytesRead)
                }
            }
            val actualHash = digest.digest().joinToString("") { "%02x".format(it) }
            val matches = actualHash.equals(ScrcpyConfig.EXPECTED_SERVER_SHA256, ignoreCase = true)
            if (!matches) {
                Log.w(TAG, "SHA-256 mismatch: expected=${ScrcpyConfig.EXPECTED_SERVER_SHA256} actual=$actualHash")
            }
            matches
        } catch (e: Exception) {
            Log.e(TAG, "Hash verification error: ${e.message}", e)
            false
        }
    }
}
