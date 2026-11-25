package com.coldcalling.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.Switch
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.coldcalling.app.data.CallItem
import com.coldcalling.app.data.CallStore
import com.coldcalling.app.data.UploadStatus
import com.coldcalling.app.databinding.ActivityMainBinding
import com.coldcalling.app.databinding.ItemCallRecordBinding
import com.coldcalling.app.receiver.CallStateReceiver
import com.coldcalling.app.uploader.GoogleDriveUploader
import kotlinx.coroutines.launch
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

import com.coldcalling.app.service.RecordingSyncService
import android.content.BroadcastReceiver
import android.content.Context
import android.content.IntentFilter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import com.coldcalling.app.recording.StandaloneEngineClient
import com.coldcalling.app.recording.wireless.WirelessAdbManager
import com.coldcalling.app.recording.wireless.WirelessAdbService

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private val callAdapter = CallAdapter()
    private var mediaPlayer: MediaPlayer? = null
    private var playingCallId: String? = null
    private var playingProgressText: String? = null
    private var playbackProgressJob: kotlinx.coroutines.Job? = null
    private var isDialerTabSelected: Boolean = true
    private var currentSearchQuery: String = ""
    private var currentFilterMode: Int = 0 // 0 = All, 1 = Synced, 2 = Pending
    private val numberBuilder = StringBuilder()

    companion object {
        private const val PERMISSION_REQUEST_CODE = 101
    }

    private fun makePillDrawable(fillColor: Int, radiusDp: Float = 20f, strokeColor: Int = 0, strokeWidthDp: Float = 0f): android.graphics.drawable.GradientDrawable {
        val d = resources.displayMetrics.density
        return android.graphics.drawable.GradientDrawable().apply {
            shape = android.graphics.drawable.GradientDrawable.RECTANGLE
            cornerRadius = radiusDp * d
            setColor(fillColor)
            if (strokeWidthDp > 0f && strokeColor != 0) {
                setStroke((strokeWidthDp * d).toInt(), strokeColor)
            }
        }
    }

    private val callSyncedReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == WirelessAdbService.ACTION_ENGINE_STATUS_CHANGED) {
                updateEngineStatusUI()
            } else {
                refreshCallList()
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Ensure user is logged into CRM
        if (!com.coldcalling.app.auth.AuthManager.isLoggedIn(this)) {
            startActivity(Intent(this, com.coldcalling.app.auth.LoginActivity::class.java))
            finish()
            return
        }

        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupFluidSurfaces()
        setupKeypad()
        setupRecyclerView()
        setupActions()
        setupNavigationAndFilters()
        checkAndRequestPermissions()
        refreshCallList()
        updateExceptionBanner()
        updateEngineStatusUI()
        updateModeToggleUI()

        // Start the call monitor service for programmatic call state detection
        com.coldcalling.app.service.CallMonitorService.start(this)
    }

    private fun setupFluidSurfaces() {
        val currentUser = com.coldcalling.app.auth.AuthManager.getCurrentUser(this)
        if (currentUser != null) {
            val phoneInfo = if (!currentUser.phone.isNullOrBlank()) " • ${currentUser.phone}" else ""
            binding.tvUserSession.text = "👤 ${currentUser.name} (${currentUser.role.uppercase()})$phoneInfo • COS Theta CRM"
        }

        binding.bannerExceptionInfo.background = makePillDrawable(
            android.graphics.Color.parseColor("#121215"),
            8f,
            android.graphics.Color.parseColor("#27272A"),
            1f
        )
        binding.tvNavRecordingsBadge.background = makePillDrawable(
            android.graphics.Color.parseColor("#18181B"),
            8f,
            android.graphics.Color.parseColor("#27272A"),
            1f
        )
        binding.tvNavRecordingsBadge.setTextColor(android.graphics.Color.parseColor("#A1A1AA"))
    }

    private fun syncCrmLeadsInBackground() {
        val token = com.coldcalling.app.auth.AuthManager.getToken(this) ?: return
        val serverUrl = com.coldcalling.app.auth.AuthManager.getServerUrl(this)
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val client = okhttp3.OkHttpClient()
                val leadMap = mutableMapOf<String, String>()

                // 1. Fetch CRM Leads
                try {
                    val req = okhttp3.Request.Builder()
                        .url("$serverUrl/api/leads")
                        .header("Authorization", "Bearer $token")
                        .get()
                        .build()
                    val resp = client.newCall(req).execute()
                    if (resp.isSuccessful) {
                        val jsonStr = resp.body?.string() ?: ""
                        val leadsArray = com.google.gson.JsonParser.parseString(jsonStr).asJsonArray
                        for (elem in leadsArray) {
                            val obj = elem.asJsonObject
                            val name = if (obj.has("name") && !obj.get("name").isJsonNull) obj.get("name").asString else ""
                            val biz = if (obj.has("business_name") && !obj.get("business_name").isJsonNull) obj.get("business_name").asString else ""
                            val phone = if (obj.has("phone") && !obj.get("phone").isJsonNull) obj.get("phone").asString else ""
                            val norm = if (obj.has("phone_normalized") && !obj.get("phone_normalized").isJsonNull) obj.get("phone_normalized").asString else ""
                            val label = if (biz.isNotBlank() && biz != name) "$name ($biz)" else name
                            if (norm.isNotBlank()) {
                                leadMap[norm] = label
                                val normDigits = norm.filter { it.isDigit() }
                                if (normDigits.length >= 10) leadMap[normDigits.takeLast(10)] = label
                            }
                            val digits = phone.filter { it.isDigit() }
                            if (digits.isNotBlank()) {
                                leadMap[digits] = label
                                if (digits.length >= 10) leadMap[digits.takeLast(10)] = label
                            }
                        }
                    }
                } catch (e: Exception) {
                    android.util.Log.w("MainActivity", "Failed to fetch leads: ${e.message}")
                }

                // 2. Fetch Team Members
                try {
                    val userReq = okhttp3.Request.Builder()
                        .url("$serverUrl/api/users")
                        .header("Authorization", "Bearer $token")
                        .get()
                        .build()
                    val userResp = client.newCall(userReq).execute()
                    if (userResp.isSuccessful) {
                        val usersStr = userResp.body?.string() ?: ""
                        val usersArray = com.google.gson.JsonParser.parseString(usersStr).asJsonArray
                        for (elem in usersArray) {
                            val obj = elem.asJsonObject
                            val name = if (obj.has("name") && !obj.get("name").isJsonNull) obj.get("name").asString else "Teammate"
                            val phone = if (obj.has("phone") && !obj.get("phone").isJsonNull) obj.get("phone").asString else ""
                            val digits = phone.filter { it.isDigit() }
                            if (digits.isNotBlank()) {
                                leadMap[digits] = "Team: $name"
                                if (digits.length >= 10) leadMap[digits.takeLast(10)] = "Team: $name"
                            }
                        }
                    }
                } catch (e: Exception) {
                    android.util.Log.w("MainActivity", "Failed to fetch team members: ${e.message}")
                }

                if (leadMap.isNotEmpty()) {
                    CallStore.saveLeadPhoneMap(applicationContext, leadMap)
                    withContext(Dispatchers.Main) {
                        refreshCallList()
                    }
                }
            } catch (e: Exception) {
                android.util.Log.w("MainActivity", "Failed to sync CRM directory: ${e.message}")
            }
        }
    }

    override fun onResume() {
        super.onResume()
        try {
            val filter = IntentFilter().apply {
                addAction(RecordingSyncService.ACTION_CALL_SYNCED)
                addAction(WirelessAdbService.ACTION_ENGINE_STATUS_CHANGED)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(callSyncedReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                registerReceiver(callSyncedReceiver, filter)
            }
        } catch (_: Exception) {}

        val currentUser = com.coldcalling.app.auth.AuthManager.getCurrentUser(this)
        if (currentUser != null) {
            binding.tvUserSession.text = "👤 ${currentUser.name} (${currentUser.role.uppercase()})"
        }

        refreshCallList()
        updateExceptionBanner()
        updateEngineStatusUI()
        updateModeToggleUI()
        syncCrmLeadsInBackground()

        lifecycleScope.launch(Dispatchers.IO) {
            RecordingSyncService.syncRecordings(applicationContext)
            withContext(Dispatchers.Main) {
                refreshCallList()
                updateExceptionBanner()
            }
        }
    }

    override fun onPause() {
        super.onPause()
        try {
            unregisterReceiver(callSyncedReceiver)
        } catch (_: Exception) {}
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        refreshCallList()
        updateExceptionBanner()
        lifecycleScope.launch(Dispatchers.IO) {
            RecordingSyncService.syncRecordings(applicationContext)
            withContext(Dispatchers.Main) {
                refreshCallList()
                updateExceptionBanner()
            }
        }
    }

    private fun setupKeypad() {
        fun appendDigit(digit: String) {
            numberBuilder.clear()
            numberBuilder.append(binding.etPhoneNumber.text.toString())
            numberBuilder.append(digit)
            binding.etPhoneNumber.setText(numberBuilder.toString())
            binding.etPhoneNumber.setSelection(numberBuilder.length)
        }

        binding.btn0.setOnClickListener { appendDigit("0") }
        binding.btn0.setOnLongClickListener { appendDigit("+"); true }
        binding.btn1.setOnClickListener { appendDigit("1") }
        binding.btn2.setOnClickListener { appendDigit("2") }
        binding.btn3.setOnClickListener { appendDigit("3") }
        binding.btn4.setOnClickListener { appendDigit("4") }
        binding.btn5.setOnClickListener { appendDigit("5") }
        binding.btn6.setOnClickListener { appendDigit("6") }
        binding.btn7.setOnClickListener { appendDigit("7") }
        binding.btn8.setOnClickListener { appendDigit("8") }
        binding.btn9.setOnClickListener { appendDigit("9") }
        binding.btnStar.setOnClickListener { appendDigit("*") }
        binding.btnHash.setOnClickListener { appendDigit("#") }

        binding.btnBackspace.setOnClickListener {
            val current = binding.etPhoneNumber.text.toString()
            if (current.isNotEmpty()) {
                val updated = current.dropLast(1)
                numberBuilder.clear()
                numberBuilder.append(updated)
                binding.etPhoneNumber.setText(updated)
                binding.etPhoneNumber.setSelection(updated.length)
            }
        }

        binding.btnBackspace.setOnLongClickListener {
            numberBuilder.clear()
            binding.etPhoneNumber.setText("")
            true
        }

        binding.btnCall.setOnClickListener {
            val phone = binding.etPhoneNumber.text.toString().trim()
            if (phone.isNotEmpty()) {
                initiateCall(phone)
            } else {
                Toast.makeText(this, "Please enter a phone number", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun setupRecyclerView() {
        binding.rvCalls.layoutManager = LinearLayoutManager(this)
        binding.rvCalls.adapter = callAdapter
    }

    private fun setupNavigationAndFilters() {
        binding.navTabDialer.setOnClickListener {
            switchTab(true)
        }
        binding.navTabRecordings.setOnClickListener {
            switchTab(false)
        }
        switchTab(true)

        binding.etSearchCalls.addTextChangedListener(object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                currentSearchQuery = s?.toString()?.trim().orEmpty()
                refreshCallList()
            }
            override fun afterTextChanged(s: android.text.Editable?) {}
        })

        binding.chipFilterAll.setOnClickListener {
            currentFilterMode = 0
            updateFilterChipsUI()
            refreshCallList()
        }
        binding.chipFilterUploaded.setOnClickListener {
            currentFilterMode = 1
            updateFilterChipsUI()
            refreshCallList()
        }
        binding.chipFilterPending.setOnClickListener {
            currentFilterMode = 2
            updateFilterChipsUI()
            refreshCallList()
        }
        updateFilterChipsUI()
    }

    private fun switchTab(showDialer: Boolean) {
        isDialerTabSelected = showDialer
        binding.tabContainerDialer.visibility = if (showDialer) View.VISIBLE else View.GONE
        binding.tabContainerRecordings.visibility = if (showDialer) View.GONE else View.VISIBLE

        val activeBg = makePillDrawable(android.graphics.Color.parseColor("#18181B"), 8f, android.graphics.Color.parseColor("#27272A"), 1f)
        val inactiveBg = makePillDrawable(android.graphics.Color.TRANSPARENT, 8f)
        val activeColor = android.graphics.Color.parseColor("#FAFAFA")
        val inactiveColor = android.graphics.Color.parseColor("#71717A")

        if (showDialer) {
            binding.navTabDialer.background = activeBg
            binding.ivNavDialer.setColorFilter(activeColor)
            binding.tvNavDialer.setTextColor(activeColor)

            binding.navTabRecordings.background = inactiveBg
            binding.ivNavRecordings.setColorFilter(inactiveColor)
            binding.tvNavRecordings.setTextColor(inactiveColor)
        } else {
            binding.navTabDialer.background = inactiveBg
            binding.ivNavDialer.setColorFilter(inactiveColor)
            binding.tvNavDialer.setTextColor(inactiveColor)

            binding.navTabRecordings.background = activeBg
            binding.ivNavRecordings.setColorFilter(activeColor)
            binding.tvNavRecordings.setTextColor(activeColor)
            refreshCallList()
        }
    }

    private fun updateFilterChipsUI() {
        val activeBg = makePillDrawable(android.graphics.Color.parseColor("#18181B"), 6f, android.graphics.Color.parseColor("#3F3F46"), 1f)
        val inactiveBg = makePillDrawable(android.graphics.Color.TRANSPARENT, 6f)
        val activeText = android.graphics.Color.parseColor("#FAFAFA")
        val inactiveText = android.graphics.Color.parseColor("#71717A")

        val chips = listOf(binding.chipFilterAll, binding.chipFilterUploaded, binding.chipFilterPending)
        chips.forEachIndexed { index, tv ->
            if (index == currentFilterMode) {
                tv.background = activeBg
                tv.setTextColor(activeText)
            } else {
                tv.background = inactiveBg
                tv.setTextColor(inactiveText)
            }
        }
    }

    private fun setupActions() {
        binding.btnSettings.setOnClickListener {
            showSettingsDialog()
        }
        binding.btnExceptionList.setOnClickListener {
            showExceptionListDialog()
        }
        binding.bannerExceptionInfo.setOnClickListener {
            showExceptionListDialog()
        }
        val toggleAction = View.OnClickListener {
            val isPaused = CallStore.isRecordingPaused(this)
            val newPaused = !isPaused
            CallStore.setRecordingPaused(this, newPaused)
            updateModeToggleUI()
            updateEngineStatusUI()
            if (newPaused) {
                lifecycleScope.launch(Dispatchers.IO) {
                    StandaloneEngineClient.disableWirelessDebugging(applicationContext)
                }
            } else {
                lifecycleScope.launch(Dispatchers.IO) {
                    WirelessAdbManager.autoHealEngineIfNeeded(applicationContext)
                }
            }
            val msg = if (newPaused) {
                "🛡️ Banking Safe Mode Active — Recording paused & Wireless Debugging OFF for UPI"
            } else {
                "🟢 Calling Mode Active — 2-Way Auto-Recording Enabled"
            }
            Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
        }
        binding.cardModeToggle.setOnClickListener(toggleAction)
        binding.layoutModeToggle.setOnClickListener(toggleAction)
        binding.btnModeAction.setOnClickListener(toggleAction)
    }

    private fun updateModeToggleUI() {
        val isPaused = CallStore.isRecordingPaused(this)
        if (isPaused) {
            lifecycleScope.launch(Dispatchers.IO) {
                StandaloneEngineClient.disableWirelessDebugging(applicationContext)
            }
            binding.layoutModeToggle.setBackgroundColor(android.graphics.Color.parseColor("#121215"))
            binding.tvModeIcon.text = "🛡️"
            binding.tvModeTitle.text = "BANKING SAFE MODE (PAUSED)"
            binding.tvModeTitle.setTextColor(android.graphics.Color.parseColor("#F59E0B"))
            binding.tvModeSubtitle.text = "Recording paused • Safe for banking apps"
            binding.tvModeSubtitle.setTextColor(android.graphics.Color.parseColor("#71717A"))
            binding.btnModeAction.text = "RESUME"
            binding.btnModeAction.background = makePillDrawable(android.graphics.Color.parseColor("#22C55E"), 6f)
            binding.btnModeAction.setTextColor(android.graphics.Color.parseColor("#09090B"))
        } else {
            binding.layoutModeToggle.setBackgroundColor(android.graphics.Color.parseColor("#121215"))
            binding.tvModeIcon.text = "🟢"
            binding.tvModeTitle.text = "CALLING MODE ACTIVE"
            binding.tvModeTitle.setTextColor(android.graphics.Color.parseColor("#FAFAFA"))
            binding.tvModeSubtitle.text = "Auto-recording calls & syncing to CRM."
            binding.tvModeSubtitle.setTextColor(android.graphics.Color.parseColor("#71717A"))
            binding.btnModeAction.text = "PAUSE"
            binding.btnModeAction.background = makePillDrawable(android.graphics.Color.parseColor("#18181B"), 6f, android.graphics.Color.parseColor("#27272A"), 1f)
            binding.btnModeAction.setTextColor(android.graphics.Color.parseColor("#A1A1AA"))
        }
    }

    private fun updateExceptionBanner() {
        val count = CallStore.getExceptionList(this).size
        binding.tvExceptionCount.text = "🚫 Exception List: $count excluded"
    }

    private fun initiateCall(phone: String) {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CALL_PHONE) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.CALL_PHONE), PERMISSION_REQUEST_CODE)
            return
        }

        if (CallStore.isNumberExcluded(this, phone)) {
            Toast.makeText(this, "Calling $phone (EXCLUDED from recording & sync)", Toast.LENGTH_LONG).show()
        } else if (!CallStore.isRecordingPaused(this)) {
            lifecycleScope.launch(Dispatchers.IO) {
                WirelessAdbManager.autoHealEngineIfNeeded(applicationContext)
            }
        }

        CallStateReceiver.lastDialedNumber = phone
        val callIntent = Intent(Intent.ACTION_CALL).apply {
            data = Uri.parse("tel:$phone")
        }
        startActivity(callIntent)
    }

    private fun formatTotalDuration(totalSecs: Int): String {
        val mins = totalSecs / 60
        val secs = totalSecs % 60
        return if (mins >= 60) {
            val hrs = mins / 60
            val remMins = mins % 60
            "${hrs}h ${remMins}m"
        } else {
            "${mins}m ${secs}s"
        }
    }

    private fun refreshCallList() {
        val calls = CallStore.getCalls(this)

        // Update Fluid Stats Banner & Bottom Nav Badge
        val uploadedCount = calls.count { it.uploadStatus == UploadStatus.UPLOADED }
        val totalSecs = calls.sumOf { it.durationSeconds }
        binding.tvStatTotalCalls.text = calls.size.toString()
        binding.tvStatUploaded.text = uploadedCount.toString()
        binding.tvStatDuration.text = formatTotalDuration(totalSecs)
        binding.tvNavRecordingsBadge.text = calls.size.toString()

        // Apply Search & Filter
        val filtered = calls.filter { item ->
            val matchesQuery = currentSearchQuery.isEmpty() || item.phone.contains(currentSearchQuery, ignoreCase = true)
            val matchesFilter = when (currentFilterMode) {
                1 -> item.uploadStatus == UploadStatus.UPLOADED
                2 -> item.uploadStatus == UploadStatus.NOT_UPLOADED || item.uploadStatus == UploadStatus.FAILED
                else -> true
            }
            matchesQuery && matchesFilter
        }

        callAdapter.submitList(filtered)
        binding.tvCallCount.text = "${filtered.size} calls"
        binding.emptyStateRecordings.visibility = if (filtered.isEmpty()) View.VISIBLE else View.GONE
        binding.rvCalls.visibility = if (filtered.isEmpty()) View.GONE else View.VISIBLE
    }

    private fun showExceptionListDialog() {
        val dialogView = layoutInflater.inflate(R.layout.dialog_exception_list, null, false)
        val etNew = dialogView.findViewById<EditText>(R.id.etNewExceptionNumber)
        val btnAdd = dialogView.findViewById<android.widget.Button>(R.id.btnAddException)
        val rvExceptions = dialogView.findViewById<RecyclerView>(R.id.rvExceptions)
        val tvNone = dialogView.findViewById<android.widget.TextView>(R.id.tvNoExceptions)
        val tvHeader = dialogView.findViewById<android.widget.TextView>(R.id.tvExceptionsHeader)
        val btnOpenEngine = dialogView.findViewById<android.widget.Button>(R.id.btnOpenRecorderEngine)

        var excludedList = CallStore.getExceptionList(this).toList().sorted()

        lateinit var exceptionAdapter: RecyclerView.Adapter<*>

        fun refreshExceptions() {
            excludedList = CallStore.getExceptionList(this).toList().sorted()
            tvHeader.text = "Current Excluded Numbers (${excludedList.size}):"
            tvNone.visibility = if (excludedList.isEmpty()) View.VISIBLE else View.GONE
            rvExceptions.visibility = if (excludedList.isEmpty()) View.GONE else View.VISIBLE
            exceptionAdapter.notifyDataSetChanged()
            updateExceptionBanner()
        }

        class ExViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
            val tvNum: android.widget.TextView = itemView.findViewById(R.id.tvExceptionNumber)
            val btnDel: android.widget.ImageButton = itemView.findViewById(R.id.btnDeleteException)
        }

        exceptionAdapter = object : RecyclerView.Adapter<ExViewHolder>() {
            override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ExViewHolder {
                val v = layoutInflater.inflate(R.layout.item_exception_number, parent, false)
                return ExViewHolder(v)
            }

            override fun onBindViewHolder(holder: ExViewHolder, position: Int) {
                val num = excludedList[position]
                holder.tvNum.text = num
                holder.btnDel.setOnClickListener {
                    CallStore.removeExceptionNumber(this@MainActivity, num)
                    refreshExceptions()
                }
            }

            override fun getItemCount(): Int = excludedList.size
        }

        rvExceptions.layoutManager = LinearLayoutManager(this)
        rvExceptions.adapter = exceptionAdapter

        btnAdd.setOnClickListener {
            val input = etNew.text.toString().trim()
            if (input.isNotEmpty()) {
                CallStore.addExceptionNumber(this, input)
                etNew.setText("")
                refreshExceptions()
                Toast.makeText(this, "Added $input to Exception List", Toast.LENGTH_SHORT).show()
            }
        }

        btnOpenEngine.setOnClickListener {
            showEngineHelpDialog()
        }

        refreshExceptions()

        AlertDialog.Builder(this)
            .setTitle("🚫 Exception List (Excluded Numbers)")
            .setView(dialogView)
            .setPositiveButton("Done") { _, _ -> updateExceptionBanner() }
            .show()
    }

    private fun showSettingsDialog() {
        val dialogView = layoutInflater.inflate(R.layout.dialog_settings, null, false)
        val tvUserName = dialogView.findViewById<android.widget.TextView>(R.id.tvSettingUserName)
        val tvUserEmail = dialogView.findViewById<android.widget.TextView>(R.id.tvSettingUserEmail)
        val etServerUrl = dialogView.findViewById<EditText>(R.id.etServerUrlSetting)
        val switchAuto = dialogView.findViewById<Switch>(R.id.switchAutoUpload)
        val btnSignOut = dialogView.findViewById<android.widget.Button>(R.id.btnSignOut)

        val currentUser = com.coldcalling.app.auth.AuthManager.getCurrentUser(this)
        tvUserName.text = currentUser?.name ?: "Agent"
        val phoneInfo = if (!currentUser?.phone.isNullOrBlank()) " • Phone: ${currentUser?.phone}" else ""
        tvUserEmail.text = "${currentUser?.email ?: ""} • ${currentUser?.role?.uppercase() ?: "MEMBER"}$phoneInfo"
        etServerUrl.setText(com.coldcalling.app.auth.AuthManager.getServerUrl(this))
        switchAuto.isChecked = CallStore.isAutoUploadEnabled(this)

        var dialog: AlertDialog? = null

        btnSignOut.setOnClickListener {
            dialog?.dismiss()
            com.coldcalling.app.auth.AuthManager.logout(this)
            Toast.makeText(this, "Signed out of CRM", Toast.LENGTH_SHORT).show()
            startActivity(Intent(this, com.coldcalling.app.auth.LoginActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            })
            finish()
        }

        dialog = AlertDialog.Builder(this)
            .setTitle("CRM Sync Settings")
            .setView(dialogView)
            .setPositiveButton("Save") { _, _ ->
                val serverUrl = etServerUrl.text.toString().trim()
                if (serverUrl.isNotEmpty()) {
                    com.coldcalling.app.auth.AuthManager.setServerUrl(this, serverUrl)
                }
                CallStore.setAutoUploadEnabled(this, switchAuto.isChecked)
                Toast.makeText(this, "Settings saved", Toast.LENGTH_SHORT).show()
            }
            .setNeutralButton("Test CRM") { _, _ ->
                lifecycleScope.launch {
                    val res = com.coldcalling.app.uploader.CrmCallUploader.testConnection(this@MainActivity)
                    if (res.isSuccess) {
                        Toast.makeText(this@MainActivity, res.getOrNull(), Toast.LENGTH_LONG).show()
                    } else {
                        Toast.makeText(this@MainActivity, "Connection failed: ${res.exceptionOrNull()?.message}", Toast.LENGTH_LONG).show()
                    }
                }
            }
            .setNegativeButton("Cancel", null)
            .create()

        dialog.show()
    }

    private fun checkAndRequestPermissions() {
        val permissions = mutableListOf(
            Manifest.permission.CALL_PHONE,
            Manifest.permission.READ_PHONE_STATE,
            Manifest.permission.READ_CALL_LOG,
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.READ_CONTACTS
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions.add(Manifest.permission.POST_NOTIFICATIONS)
            permissions.add(Manifest.permission.READ_MEDIA_AUDIO)
        } else if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.Q) {
            permissions.add(Manifest.permission.WRITE_EXTERNAL_STORAGE)
            permissions.add(Manifest.permission.READ_EXTERNAL_STORAGE)
        }

        val needed = permissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (needed.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, needed.toTypedArray(), PERMISSION_REQUEST_CODE)
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == PERMISSION_REQUEST_CODE) {
            com.coldcalling.app.service.CallMonitorService.start(this)
            updateEngineStatusUI()
            refreshCallList()
        }
    }

    private fun playAudio(callItem: CallItem) {
        val path = callItem.audioFilePath
        if (path.isNullOrEmpty() || !File(path).exists()) {
            Toast.makeText(this, "Recording file not found on device", Toast.LENGTH_SHORT).show()
            return
        }

        val file = File(path)
        if (file.length() == 0L) {
            Toast.makeText(this, "Recording file is empty (0 bytes)", Toast.LENGTH_SHORT).show()
            return
        }

        if (playingCallId == callItem.id && mediaPlayer?.isPlaying == true) {
            playbackProgressJob?.cancel()
            playingProgressText = null
            mediaPlayer?.stop()
            mediaPlayer?.release()
            mediaPlayer = null
            playingCallId = null
            callAdapter.notifyDataSetChanged()
            return
        }

        try {
            // Ensure media volume is audible so playback is clearly heard
            runCatching {
                val am = getSystemService(Context.AUDIO_SERVICE) as? android.media.AudioManager
                if (am != null) {
                    val maxVol = am.getStreamMaxVolume(android.media.AudioManager.STREAM_MUSIC)
                    val curVol = am.getStreamVolume(android.media.AudioManager.STREAM_MUSIC)
                    if (maxVol > 0 && curVol < (maxVol * 0.35).toInt()) {
                        am.setStreamVolume(android.media.AudioManager.STREAM_MUSIC, (maxVol * 0.7).toInt(), 0)
                    }
                }
            }

            playbackProgressJob?.cancel()
            playingProgressText = null
            mediaPlayer?.release()
            mediaPlayer = MediaPlayer().apply {
                setAudioAttributes(
                    android.media.AudioAttributes.Builder()
                        .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH)
                        .setUsage(android.media.AudioAttributes.USAGE_MEDIA)
                        .build()
                )
                setOnErrorListener { _, what, extra ->
                    android.util.Log.e("MainActivity", "MediaPlayer error: what=$what extra=$extra")
                    playbackProgressJob?.cancel()
                    playingProgressText = null
                    playingCallId = null
                    callAdapter.notifyDataSetChanged()
                    Toast.makeText(this@MainActivity, "Audio playback error ($what). Long-press to open in external player.", Toast.LENGTH_LONG).show()
                    true
                }
                setOnCompletionListener {
                    playbackProgressJob?.cancel()
                    playingProgressText = null
                    playingCallId = null
                    callAdapter.notifyDataSetChanged()
                }
                java.io.FileInputStream(file).use { fis ->
                    setDataSource(fis.fd, 0, file.length())
                    prepare()
                }
                start()
            }
            playingCallId = callItem.id
            val totalSecs = ((mediaPlayer?.duration ?: 0) / 1000).coerceAtLeast(callItem.durationSeconds)
            playingProgressText = "⏸ 0s/${totalSecs}s"
            callAdapter.notifyDataSetChanged()

            playbackProgressJob = lifecycleScope.launch {
                while (playingCallId == callItem.id && mediaPlayer?.isPlaying == true) {
                    val curSec = (mediaPlayer?.currentPosition ?: 0) / 1000
                    val totSec = ((mediaPlayer?.duration ?: 0) / 1000).let { if (it > 0) it else callItem.durationSeconds }
                    playingProgressText = "⏸ ${curSec}s/${totSec}s"
                    callAdapter.notifyDataSetChanged()
                    kotlinx.coroutines.delay(500)
                }
            }

            if (file.name.endsWith(".m4a", ignoreCase = true)) {
                Toast.makeText(
                    this,
                    "⚠️ Fallback recording (${file.name}): recorded while 2-Way Engine was OFF (Android 13 mutes mic without 2-Way Engine).",
                    Toast.LENGTH_LONG
                ).show()
            } else {
                Toast.makeText(this, "🔊 Playing 2-Way HD recording (${file.name})", Toast.LENGTH_SHORT).show()
            }
        } catch (e: Exception) {
            android.util.Log.e("MainActivity", "Error playing audio: ${e.message}", e)
            Toast.makeText(this, "Error playing audio: ${e.message}", Toast.LENGTH_SHORT).show()
            playbackProgressJob?.cancel()
            playingProgressText = null
            playingCallId = null
            callAdapter.notifyDataSetChanged()
        }
    }

    private fun openAudioWithExternalApp(callItem: CallItem) {
        val path = callItem.audioFilePath ?: return
        val file = File(path)
        if (!file.exists()) {
            Toast.makeText(this, "Recording file not found", Toast.LENGTH_SHORT).show()
            return
        }
        try {
            val uri = androidx.core.content.FileProvider.getUriForFile(
                this,
                "$packageName.fileprovider",
                file
            )
            val mimeType = if (path.endsWith(".m4a", true)) "audio/mp4" else "audio/ogg"
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, mimeType)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            startActivity(Intent.createChooser(intent, "Play recording with..."))
        } catch (e: Exception) {
            Toast.makeText(this, "Could not open external player: ${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    private fun updateEngineStatusUI() {
        lifecycleScope.launch {
            val isPaused = CallStore.isRecordingPaused(this@MainActivity)
            var isRunning = StandaloneEngineClient.isAvailable()
            withContext(Dispatchers.Main) {
                if (isRunning) {
                    binding.tvRecorderStatus.text = "● 2-Way Ready"
                    binding.tvRecorderStatus.setTextColor(android.graphics.Color.parseColor("#22C55E"))
                    binding.tvRecorderStatus.setOnClickListener {
                        Toast.makeText(this@MainActivity, "2-Way HD Recorder Engine is active & ready!", Toast.LENGTH_SHORT).show()
                    }
                } else if (isPaused) {
                    binding.tvRecorderStatus.text = "● Paused"
                    binding.tvRecorderStatus.setTextColor(android.graphics.Color.parseColor("#F59E0B"))
                    binding.tvRecorderStatus.setOnClickListener {
                        Toast.makeText(this@MainActivity, "Banking Safe Mode is ON. Tap RESUME to re-enable recording.", Toast.LENGTH_SHORT).show()
                    }
                } else {
                    binding.tvRecorderStatus.text = "○ Engine OFF"
                    binding.tvRecorderStatus.setTextColor(android.graphics.Color.parseColor("#71717A"))
                    binding.tvRecorderStatus.setOnClickListener {
                        showEngineHelpDialog()
                    }
                }
            }

            if (!isRunning && !isPaused) {
                val healed = WirelessAdbManager.autoHealEngineIfNeeded(applicationContext)
                isRunning = healed || StandaloneEngineClient.isAvailable()
                withContext(Dispatchers.Main) {
                    if (isRunning) {
                        binding.tvRecorderStatus.text = "● 2-Way Ready"
                        binding.tvRecorderStatus.setTextColor(android.graphics.Color.parseColor("#22C55E"))
                        binding.tvRecorderStatus.setOnClickListener {
                            Toast.makeText(this@MainActivity, "2-Way HD Recorder Engine is active & ready!", Toast.LENGTH_SHORT).show()
                        }
                    } else {
                        binding.tvRecorderStatus.text = "○ Engine OFF"
                        binding.tvRecorderStatus.setTextColor(android.graphics.Color.parseColor("#71717A"))
                        binding.tvRecorderStatus.setOnClickListener {
                            showEngineHelpDialog()
                        }
                    }
                }
            }
        }
    }

    private fun showEngineHelpDialog() {
        val isPaired = WirelessAdbManager.isPaired(this)
        val cachedPort = if (WirelessAdbService.detectedConnectPort > 0) {
            WirelessAdbService.detectedConnectPort
        } else {
            WirelessAdbManager.getLastConnectPort(this)
        }

        val container = android.widget.ScrollView(this)
        val layout = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            val pad = (20 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad / 2, pad, pad / 2)
        }
        container.addView(layout)

        // Status Header
        val tvStatus = android.widget.TextView(this).apply {
            text = if (isPaired) {
                "✅ Standard Auto-Recording is ACTIVE!\n\n⚡ Device Paired for 2-Way HD Engine:\n1. Tap 'Open Developer Options' below.\n2. Toggle 'Wireless debugging' ON.\n3. The 2-Way HD Engine starts in 2s & auto-disables Wireless Debugging for UPI apps!"
            } else {
                "✅ Standard Auto-Recording & Drive Sync work out-of-the-box!\n\n⚡ Optional 2-Way HD Boost (No PC Needed):\n1. Tap 'Open Developer Options' below.\n2. Turn ON 'Wireless debugging' → Tap 'Pair device with pairing code'.\n3. Enter the 6-digit code in the notification at the top of your screen!"
            }
            textSize = 14f
            setPadding(0, 0, 0, (12 * resources.displayMetrics.density).toInt())
        }
        layout.addView(tvStatus)

        // Primary Button: Open Developer Options & Start Auto-Listener
        val btnOpenDev = android.widget.Button(this).apply {
            text = "⚡ Open Developer Options (Auto-Start)"
            isAllCaps = false
            setBackgroundColor(android.graphics.Color.parseColor("#1976D2"))
            setTextColor(android.graphics.Color.WHITE)
        }
        layout.addView(btnOpenDev)

        // Divider / Manual Connect Section
        val tvManualHeader = android.widget.TextView(this).apply {
            text = "\n— Or Connect Manually via Port —"
            textSize = 13f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setPadding(0, (8 * resources.displayMetrics.density).toInt(), 0, (4 * resources.displayMetrics.density).toInt())
        }
        layout.addView(tvManualHeader)

        val etConnectPort = EditText(this).apply {
            hint = "Wireless Debugging Port (e.g. 41235)"
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            if (cachedPort > 0) setText(cachedPort.toString())
        }
        layout.addView(etConnectPort)

        val btnStartManual = android.widget.Button(this).apply {
            text = "🚀 Connect & Start Engine"
            isAllCaps = false
        }
        layout.addView(btnStartManual)

        // Manual Pairing Section (for split-screen or manual port+code)
        val tvPairToggle = android.widget.TextView(this).apply {
            text = "\n🔑 Need to Pair Manually? (Tap to expand)"
            textSize = 13f
            setTextColor(android.graphics.Color.parseColor("#1976D2"))
            setPadding(0, (8 * resources.displayMetrics.density).toInt(), 0, (4 * resources.displayMetrics.density).toInt())
        }
        layout.addView(tvPairToggle)

        val pairLayout = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            visibility = if (isPaired) View.GONE else View.VISIBLE
        }
        val etPairPort = EditText(this).apply {
            hint = "Pairing Port (e.g. 37123)"
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            if (WirelessAdbService.detectedPairPort > 0) {
                setText(WirelessAdbService.detectedPairPort.toString())
            }
        }
        val etPairCode = EditText(this).apply {
            hint = "6-Digit Pairing Code (e.g. 482910)"
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
        }
        val btnPairNow = android.widget.Button(this).apply {
            text = "Pair Device"
            isAllCaps = false
        }
        pairLayout.addView(etPairPort)
        pairLayout.addView(etPairCode)
        pairLayout.addView(btnPairNow)
        layout.addView(pairLayout)

        tvPairToggle.setOnClickListener {
            pairLayout.visibility = if (pairLayout.visibility == View.VISIBLE) View.GONE else View.VISIBLE
        }

        val dialog = AlertDialog.Builder(this)
            .setTitle("Start Recorder Engine")
            .setView(container)
            .setPositiveButton("Close", null)
            .setNeutralButton("Refresh Status") { _, _ ->
                updateEngineStatusUI()
            }
            .create()

        // Auto-discover connect port in background while dialog is open
        lifecycleScope.launch {
            val foundPort = WirelessAdbManager.discoverConnectPort(this@MainActivity, 2000)
            if (foundPort > 0 && etConnectPort.text.isNullOrEmpty()) {
                etConnectPort.setText(foundPort.toString())
            }
        }

        btnOpenDev.setOnClickListener {
            WirelessAdbService.startListening(this)
            Toast.makeText(
                this,
                if (isPaired) "Turn ON Wireless Debugging — Engine will start automatically!"
                else "Go to Wireless Debugging → Pair with code, then enter the 6-digit code in the notification!",
                Toast.LENGTH_LONG
            ).show()
            try {
                startActivity(Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            } catch (_: Exception) {
                startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            dialog.dismiss()
        }

        btnStartManual.setOnClickListener {
            val portStr = etConnectPort.text.toString().trim()
            val port = portStr.toIntOrNull() ?: 0
            if (port <= 0) {
                Toast.makeText(this, "Please enter the 5-digit Wireless Debugging port", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            btnStartManual.isEnabled = false
            btnStartManual.text = "Starting Engine..."
            lifecycleScope.launch {
                val res = WirelessAdbManager.startEngine(this@MainActivity, port)
                btnStartManual.isEnabled = true
                btnStartManual.text = "🚀 Connect & Start Engine"
                Toast.makeText(this@MainActivity, res.message, Toast.LENGTH_LONG).show()
                if (res.success) {
                    updateEngineStatusUI()
                    dialog.dismiss()
                }
            }
        }

        btnPairNow.setOnClickListener {
            val pPort = etPairPort.text.toString().trim().toIntOrNull() ?: 0
            val code = etPairCode.text.toString().trim()
            if (pPort <= 0 || code.length != 6) {
                Toast.makeText(this, "Enter valid Pairing Port and 6-digit Code", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            btnPairNow.isEnabled = false
            btnPairNow.text = "Pairing..."
            lifecycleScope.launch {
                val res = WirelessAdbManager.pair(this@MainActivity, pPort, code)
                btnPairNow.isEnabled = true
                btnPairNow.text = "Pair Device"
                Toast.makeText(this@MainActivity, res.message, Toast.LENGTH_LONG).show()
                if (res.success) {
                    tvStatus.text = "✅ Device Paired! Now enter the Connect Port above or tap 'Open Developer Options'."
                    pairLayout.visibility = View.GONE
                }
            }
        }

        dialog.show()
    }

    override fun onDestroy() {
        playbackProgressJob?.cancel()
        playingProgressText = null
        mediaPlayer?.release()
        mediaPlayer = null
        super.onDestroy()
    }

    inner class CallAdapter : RecyclerView.Adapter<CallAdapter.ViewHolder>() {
        private var list = listOf<CallItem>()

        fun submitList(newList: List<CallItem>) {
            list = newList
            notifyDataSetChanged()
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
            val binding = ItemCallRecordBinding.inflate(LayoutInflater.from(parent.context), parent, false)
            return ViewHolder(binding)
        }

        override fun onBindViewHolder(holder: ViewHolder, position: Int) {
            holder.bind(list[position])
        }

        override fun getItemCount() = list.size

        inner class ViewHolder(private val b: ItemCallRecordBinding) : RecyclerView.ViewHolder(b.root) {
            fun bind(item: CallItem) {
                val rawPhone = item.phone.trim()
                val fileName = item.audioFilePath?.substringAfterLast('/') ?: ""
                val isIncoming = rawPhone.startsWith("in_", ignoreCase = true) || fileName.contains("_in_", ignoreCase = true)
                val cleanPhone = rawPhone
                    .removePrefix("in_")
                    .removePrefix("IN_")
                    .removePrefix("out_")
                    .removePrefix("OUT_")
                    .ifBlank { rawPhone }

                val cachedLeadName = item.leadName ?: CallStore.getLeadNameForPhone(this@MainActivity, cleanPhone)
                if (!cachedLeadName.isNullOrBlank()) {
                    b.tvItemLeadName.visibility = View.VISIBLE
                    b.tvItemLeadName.text = cachedLeadName
                    b.tvItemPhone.text = cleanPhone
                } else {
                    b.tvItemLeadName.visibility = View.GONE
                    b.tvItemPhone.text = cleanPhone
                }
                b.tvCallDirectionBadge.text = if (isIncoming) "↙ IN" else "↗ OUT"
                b.tvCallDirectionBadge.background = makePillDrawable(
                    ContextCompat.getColor(this@MainActivity, R.color.primary_soft),
                    8f
                )

                val dateFormat = SimpleDateFormat("MMM dd, hh:mm a", Locale.getDefault()).format(Date(item.timestamp))
                val modeTag = when {
                    fileName.endsWith(".ogg", true) || fileName.endsWith(".opus", true) || fileName.endsWith(".oga", true) -> " • 🎙️ 2-Way HD"
                    fileName.endsWith(".m4a", true) -> " • ⚠️ Engine Was OFF"
                    else -> ""
                }
                b.tvItemDate.text = "$dateFormat • ${item.durationSeconds}s$modeTag"

                val loadIntoDialer = View.OnClickListener {
                    numberBuilder.clear()
                    numberBuilder.append(cleanPhone)
                    binding.etPhoneNumber.setText(cleanPhone)
                    binding.etPhoneNumber.setSelection(cleanPhone.length)
                    switchTab(true)
                    Toast.makeText(this@MainActivity, "Loaded $cleanPhone in Dialer", Toast.LENGTH_SHORT).show()
                }
                b.btnQuickRedial.setOnClickListener(loadIntoDialer)
                b.tvItemPhone.setOnClickListener(loadIntoDialer)

                // Play Audio Button
                val isPlaying = playingCallId == item.id
                b.btnPlayAudio.text = if (isPlaying) (playingProgressText ?: "⏸ Stop") else "▶ Play"
                b.btnPlayAudio.setOnClickListener {
                    playAudio(item)
                }
                b.btnPlayAudio.setOnLongClickListener {
                    openAudioWithExternalApp(item)
                    true
                }

                // Drive & CRM status
                when (item.uploadStatus) {
                    UploadStatus.UPLOADED -> {
                        b.tvDriveStatus.text = "☁️ Synced to CRM & Drive ✅"
                        b.tvDriveStatus.setTextColor(ContextCompat.getColor(this@MainActivity, R.color.call_green))
                        b.btnOpenDrive.visibility = if (!item.driveUrl.isNullOrEmpty()) View.VISIBLE else View.GONE
                        b.btnRetryUpload.visibility = View.GONE
                        b.btnOpenDrive.setOnClickListener {
                            val browserIntent = Intent(Intent.ACTION_VIEW, Uri.parse(item.driveUrl))
                            startActivity(browserIntent)
                        }
                    }
                    UploadStatus.UPLOADING -> {
                        b.tvDriveStatus.text = "☁️ Syncing to CRM... ⏳"
                        b.tvDriveStatus.setTextColor(ContextCompat.getColor(this@MainActivity, R.color.drive_blue))
                        b.btnOpenDrive.visibility = View.GONE
                        b.btnRetryUpload.visibility = View.GONE
                    }
                    UploadStatus.SKIPPED -> {
                        b.tvDriveStatus.text = "🚫 Non-Lead (Drive Upload Excluded)"
                        b.tvDriveStatus.setTextColor(ContextCompat.getColor(this@MainActivity, R.color.text_secondary))
                        b.btnOpenDrive.visibility = View.GONE
                        b.btnRetryUpload.visibility = View.GONE
                    }
                    UploadStatus.FAILED -> {
                        b.tvDriveStatus.text = "☁️ CRM Sync Failed ❌"
                        b.tvDriveStatus.setTextColor(ContextCompat.getColor(this@MainActivity, R.color.call_red))
                        b.btnOpenDrive.visibility = View.GONE
                        b.btnRetryUpload.visibility = View.VISIBLE
                        b.btnRetryUpload.setOnClickListener {
                            lifecycleScope.launch {
                                if (com.coldcalling.app.auth.AuthManager.isLoggedIn(this@MainActivity)) {
                                    com.coldcalling.app.uploader.CrmCallUploader.uploadCallRecording(this@MainActivity, item)
                                } else {
                                    GoogleDriveUploader.uploadCallRecording(this@MainActivity, item)
                                }
                                refreshCallList()
                            }
                        }
                    }
                    UploadStatus.NOT_UPLOADED -> {
                        b.tvDriveStatus.text = "☁️ Not Synced"
                        b.tvDriveStatus.setTextColor(ContextCompat.getColor(this@MainActivity, R.color.text_secondary))
                        b.btnOpenDrive.visibility = View.GONE
                        b.btnRetryUpload.visibility = View.VISIBLE
                        b.btnRetryUpload.setOnClickListener {
                            lifecycleScope.launch {
                                if (com.coldcalling.app.auth.AuthManager.isLoggedIn(this@MainActivity)) {
                                    com.coldcalling.app.uploader.CrmCallUploader.uploadCallRecording(this@MainActivity, item)
                                } else {
                                    GoogleDriveUploader.uploadCallRecording(this@MainActivity, item)
                                }
                                refreshCallList()
                            }
                        }
                    }
                }
            }
        }
    }
}
