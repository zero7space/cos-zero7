package com.coldcalling.app.service

import android.graphics.drawable.Icon
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import android.widget.Toast
import com.coldcalling.app.data.CallStore
import com.coldcalling.app.recording.StandaloneEngineClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class BankingModeTileService : TileService() {

    override fun onStartListening() {
        super.onStartListening()
        updateTileState()
    }

    override fun onClick() {
        super.onClick()
        val isPaused = CallStore.isRecordingPaused(this)
        val newPaused = !isPaused
        CallStore.setRecordingPaused(this, newPaused)

        if (newPaused) {
            CoroutineScope(Dispatchers.IO).launch {
                StandaloneEngineClient.disableWirelessDebugging(applicationContext)
            }
        }

        updateTileState()

        val msg = if (newPaused) {
            "🛡️ Banking Safe Mode (Recording Paused & Wireless Debugging OFF)"
        } else {
            "🟢 Calling Mode Active (Auto-Recording Enabled)"
        }
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
    }

    private fun updateTileState() {
        val tile = qsTile ?: return
        val isPaused = CallStore.isRecordingPaused(this)

        if (isPaused) {
            tile.state = Tile.STATE_INACTIVE
            tile.label = "Banking Safe"
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                tile.subtitle = "Safe for UPI"
            }
            tile.icon = Icon.createWithResource(this, android.R.drawable.ic_lock_lock)
        } else {
            tile.state = Tile.STATE_ACTIVE
            tile.label = "Calling Mode"
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                tile.subtitle = "Recording ON"
            }
            tile.icon = Icon.createWithResource(this, android.R.drawable.ic_btn_speak_now)
        }
        tile.updateTile()
    }
}
