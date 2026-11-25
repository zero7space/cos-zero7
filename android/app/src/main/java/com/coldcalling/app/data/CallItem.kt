package com.coldcalling.app.data

data class CallItem(
    val id: String,
    val phone: String,
    val timestamp: Long,
    val durationSeconds: Int,
    var audioFilePath: String?,
    var driveUrl: String?,
    var uploadStatus: UploadStatus = UploadStatus.NOT_UPLOADED,
    var leadId: String? = null,
    var leadName: String? = null,
    var userId: String? = null,
    var outcome: String = "Connected"
)

enum class UploadStatus {
    NOT_UPLOADED,
    UPLOADING,
    UPLOADED,
    FAILED,
    SKIPPED
}
