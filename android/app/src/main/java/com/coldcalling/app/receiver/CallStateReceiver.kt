package com.coldcalling.app.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.telephony.TelephonyManager
import android.util.Log
import com.coldcalling.app.data.CallStore
import com.coldcalling.app.recording.RecordingForegroundService
import com.coldcalling.app.service.RecordingSyncService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class CallStateReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "CallStateReceiver"
        private var lastState = TelephonyManager.CALL_STATE_IDLE
        private var callStartTime: Long = 0
        @Volatile
        var lastDialedNumber: String = ""
        @Volatile
        var incomingNumber: String = ""
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return

        if (action == Intent.ACTION_NEW_OUTGOING_CALL) {
            val number = intent.getStringExtra(Intent.EXTRA_PHONE_NUMBER) ?: ""
            if (number.isNotBlank()) {
                lastDialedNumber = number
            }
            Log.i(TAG, "Outgoing call initiated to: $number")
            return
        }

        if (action == TelephonyManager.ACTION_PHONE_STATE_CHANGED) {
            val stateStr = intent.getStringExtra(TelephonyManager.EXTRA_STATE) ?: return
            val extraIncomingNumber = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER)
            if (!extraIncomingNumber.isNullOrBlank()) {
                incomingNumber = extraIncomingNumber
            }

            val state = when (stateStr) {
                TelephonyManager.EXTRA_STATE_RINGING -> TelephonyManager.CALL_STATE_RINGING
                TelephonyManager.EXTRA_STATE_OFFHOOK -> TelephonyManager.CALL_STATE_OFFHOOK
                TelephonyManager.EXTRA_STATE_IDLE -> TelephonyManager.CALL_STATE_IDLE
                else -> return
            }

            if (state == lastState) return

            when (state) {
                TelephonyManager.CALL_STATE_RINGING -> {
                    Log.i(TAG, "Call Ringing: $incomingNumber")
                }

                TelephonyManager.CALL_STATE_OFFHOOK -> {
                    callStartTime = System.currentTimeMillis()
                    val isIncoming = lastState == TelephonyManager.CALL_STATE_RINGING
                    val activeNumber = if (isIncoming) incomingNumber else lastDialedNumber
                    val direction = if (isIncoming) "in" else "out"

                    Log.i(TAG, "Call Connected (OFFHOOK) for: $activeNumber ($direction)")

                    // Check if paused / Banking Safe mode
                    if (CallStore.isRecordingPaused(context)) {
                        Log.i(TAG, "Recording is PAUSED (Banking Safe Mode). Recording skipped.")
                    } else if (activeNumber.isNotBlank() && CallStore.isNumberExcluded(context, activeNumber)) {
                        Log.i(TAG, "Number $activeNumber is on Exception List. Recording skipped.")
                    } else {
                        // Start native RecordingForegroundService
                        runCatching {
                            val recordIntent = Intent(context, RecordingForegroundService::class.java).apply {
                                this.action = RecordingForegroundService.ACTION_START_RECORDING
                                putExtra(RecordingForegroundService.EXTRA_PHONE, activeNumber)
                                putExtra(RecordingForegroundService.EXTRA_DIRECTION, direction)
                            }
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                                context.startForegroundService(recordIntent)
                            } else {
                                context.startService(recordIntent)
                            }
                        }.onFailure { e ->
                            Log.w(TAG, "Could not start RecordingForegroundService from receiver: ${e.message}")
                        }
                    }
                }

                TelephonyManager.CALL_STATE_IDLE -> {
                    if (lastState == TelephonyManager.CALL_STATE_OFFHOOK) {
                        val durationSeconds = if (callStartTime > 0) {
                            ((System.currentTimeMillis() - callStartTime) / 1000).toInt()
                        } else 0

                        val dialedPhone = if (incomingNumber.isNotBlank()) incomingNumber else lastDialedNumber
                        val startMs = callStartTime
                        Log.i(TAG, "Call Ended. Duration: ${durationSeconds}s. Stopping recording...")

                        // Stop RecordingForegroundService safely
                        if (RecordingForegroundService.isRecording) {
                            runCatching {
                                val stopIntent = Intent(context, RecordingForegroundService::class.java).apply {
                                    this.action = RecordingForegroundService.ACTION_STOP_RECORDING
                                }
                                context.startService(stopIntent)
                            }.onFailure { e ->
                                Log.w(TAG, "Could not send stop intent: ${e.message}")
                            }
                        }

                        // Fallback sync to catch any recordings in storage
                        val pendingResult = goAsync()
                        CoroutineScope(Dispatchers.IO).launch {
                            try {
                                RecordingSyncService.syncRecordings(
                                    context.applicationContext,
                                    phone = dialedPhone,
                                    duration = durationSeconds,
                                    callStart = startMs
                                )
                            } catch (e: Exception) {
                                Log.e(TAG, "Error in fallback sync", e)
                            } finally {
                                pendingResult.finish()
                            }
                        }
                    }
                    incomingNumber = ""
                    lastDialedNumber = ""
                }
            }
            lastState = state
        }
    }
}
