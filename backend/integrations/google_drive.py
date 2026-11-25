"""
Google Drive integration for call recording uploads.
Uses Service Account authentication for headless server-to-server access.
"""
import os
import io
import logging
from typing import Optional

logger = logging.getLogger(__name__)

ROOT_FOLDER_ID = "105mtdVl4j4VR9TAqM73eVaRhc0ul0KK3"
CREDENTIALS_PATH = os.environ.get(
    "GOOGLE_DRIVE_CREDENTIALS",
    os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "google_drive_credentials.json")
)

_service = None

def _get_service():
    """Lazy-init the Drive API service."""
    global _service
    if _service:
        return _service
    if not os.path.exists(CREDENTIALS_PATH):
        logger.warning(f"Google Drive credentials not found at {CREDENTIALS_PATH}")
        return None
    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
        credentials = service_account.Credentials.from_service_account_file(
            CREDENTIALS_PATH,
            scopes=["https://www.googleapis.com/auth/drive"]
        )
        _service = build("drive", "v3", credentials=credentials)
        logger.info("Google Drive service initialized")
        return _service
    except Exception as e:
        logger.error(f"Failed to init Drive service: {e}")
        return None


def _find_or_create_folder(name: str, parent_id: str) -> Optional[str]:
    """Find existing folder by name under parent, or create one."""
    service = _get_service()
    if not service:
        return None
    try:
        query = f"name='{name}' and '{parent_id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false"
        results = service.files().list(
            q=query,
            fields="files(id)",
            pageSize=1,
            supportsAllDrives=True,
            includeItemsFromAllDrives=True
        ).execute()
        files = results.get("files", [])
        if files:
            return files[0]["id"]
        # Create folder
        metadata = {
            "name": name,
            "mimeType": "application/vnd.google-apps.folder",
            "parents": [parent_id]
        }
        folder = service.files().create(body=metadata, fields="id", supportsAllDrives=True).execute()
        logger.info(f"Created Drive folder: {name} ({folder['id']})")
        return folder["id"]
    except Exception as e:
        logger.error(f"Drive folder error: {e}")
        return None



CLIENT_SUBFOLDERS = {
    "calls": "01_Call_Recordings",
    "whatsapp": "02_WhatsApp_Media",
    "proposals": "03_Proposals_and_SOW",
    "creatives": "04_Marketing_and_Ads",
    "deliverables": "05_Deliverables_and_Demos"
}

def ensure_client_drive_hierarchy(client_slug: str, client_name: str, business_name: str = "") -> dict:
    """
    Provisions root client directory under ROOT_FOLDER_ID/Clients and the 5 standardized subfolders.
    Returns dictionary with client_folder_id, client_folder_url, and subfolder IDs.
    """
    service = _get_service()
    if not service:
        logger.warning("Drive service not available for client hierarchy provisioning")
        return {}
    
    try:
        clients_root_id = _find_or_create_folder("Clients", ROOT_FOLDER_ID)
        effective_name = (business_name or client_name or client_slug).strip()
        folder_name = f"{client_slug} - {effective_name}".replace("/", "-").replace("\\", "-")[:100]
        client_folder_id = _find_or_create_folder(folder_name, clients_root_id or ROOT_FOLDER_ID)
        
        subfolder_ids = {}
        for key, name in CLIENT_SUBFOLDERS.items():
            sf_id = _find_or_create_folder(name, client_folder_id)
            subfolder_ids[key] = sf_id
            
        # Create nested subfolders for whatsapp media: voice_notes, documents, images
        if subfolder_ids.get("whatsapp"):
            wa_parent = subfolder_ids["whatsapp"]
            subfolder_ids["whatsapp_voice_notes"] = _find_or_create_folder("voice_notes", wa_parent)
            subfolder_ids["whatsapp_documents"] = _find_or_create_folder("documents", wa_parent)
            subfolder_ids["whatsapp_images"] = _find_or_create_folder("images", wa_parent)
            
        # Ensure public link read permission for seamless CRM previews
        try:
            service.permissions().create(
                fileId=client_folder_id,
                body={"type": "anyone", "role": "reader"},
                fields="id",
                supportsAllDrives=True
            ).execute()
        except Exception:
            pass

        return {
            "client_folder_id": client_folder_id,
            "client_folder_url": f"https://drive.google.com/drive/folders/{client_folder_id}",
            "subfolders": subfolder_ids
        }
    except Exception as e:
        logger.error(f"Failed to ensure client drive hierarchy: {e}")
        return {}


def upload_client_asset(
    client_slug: str,
    client_name: str,
    category: str,
    file_bytes: bytes,
    filename: str,
    mime_type: str,
    business_name: str = ""
) -> Optional[dict]:
    """
    Uploads a file directly into the standardized subfolder for this client.
    Categories: 'calls', 'whatsapp', 'whatsapp_voice_notes', 'whatsapp_documents',
                'whatsapp_images', 'proposals', 'creatives', 'deliverables'.
    """
    service = _get_service()
    if not service:
        logger.warning("Drive service not available, skipping asset upload")
        return None

    try:
        hierarchy = ensure_client_drive_hierarchy(client_slug, client_name, business_name)
        subfolders = hierarchy.get("subfolders", {})
        
        target_folder_id = subfolders.get(category) or hierarchy.get("client_folder_id") or ROOT_FOLDER_ID
        
        file_id = None
        web_view_link = ""
        web_content_link = ""
        
        try:
            from googleapiclient.http import MediaInMemoryUpload
            file_metadata = {
                "name": filename,
                "parents": [target_folder_id]
            }
            media = MediaInMemoryUpload(file_bytes, mimetype=mime_type, resumable=True)
            uploaded = service.files().create(
                body=file_metadata,
                media_body=media,
                fields="id,webViewLink,webContentLink,size",
                supportsAllDrives=True
            ).execute()

            file_id = uploaded.get("id")
            web_view_link = uploaded.get("webViewLink", "")
            web_content_link = uploaded.get("webContentLink", "")
        except Exception as upload_err:
            logger.warning(f"Native Service Account upload failed ({upload_err}). Routing into client folder '{target_folder_id}' via authenticated Drive bridge...")
            import base64
            import time
            import requests as req
            gas_url = os.environ.get(
                "DRIVE_WEBHOOK_URL",
                "https://script.google.com/macros/s/AKfycbyCDb9IWz05Ie9_qF_OeLCgQiwBXn5oDbHP4WWp71q6i-K-n4sLPTFYpl7rBdJFc2eS/exec"
            )
            gas_payload = {
                "filename": filename,
                "folderId": target_folder_id,
                "mimeType": mime_type,
                "timestamp": int(time.time() * 1000),
                "data": base64.b64encode(file_bytes).decode('utf-8')
            }
            gas_resp = req.post(gas_url, json=gas_payload, timeout=90)
            if gas_resp.status_code == 200:
                gas_data = gas_resp.json()
                file_url = gas_data.get("fileUrl") or gas_data.get("url") or gas_data.get("link")
                import re
                fid_match = re.search(r'/d/([a-zA-Z0-9_-]+)', file_url or '')
                file_id = fid_match.group(1) if fid_match else None
                if not file_id:
                    raise Exception(f"Failed to extract file ID from Drive bridge response: {gas_data}")
                web_view_link = file_url
                web_content_link = f"https://drive.google.com/uc?id={file_id}&export=download"
            else:
                raise Exception(f"Drive bridge failed with status {gas_resp.status_code}: {gas_resp.text}")

        try:
            service.permissions().create(
                fileId=file_id,
                body={"type": "anyone", "role": "reader"},
                fields="id",
                supportsAllDrives=True
            ).execute()
        except Exception:
            pass

        embed_link = f"https://drive.google.com/file/d/{file_id}/preview"
        logger.info(f"Uploaded asset to Drive [{category}]: {filename} -> {file_id} (Folder: {target_folder_id})")
        return {
            "file_id": file_id,
            "web_view_link": web_view_link or f"https://drive.google.com/file/d/{file_id}/view",
            "embed_link": embed_link,
            "web_content_link": web_content_link,
            "folder_id": target_folder_id,
            "category": category,
            "client_folder_id": hierarchy.get("client_folder_id"),
            "client_folder_url": hierarchy.get("client_folder_url")
        }
    except Exception as e:
        logger.error(f"Asset upload to Drive failed: {e}")
        return None


INTERNAL_SUBFOLDERS = {
    "calls": "01_Call_Recordings",
    "transcripts": "02_Transcripts",
    "notes": "03_Notes_and_Strategy",
}

def ensure_internal_discussion_drive_hierarchy(teammate_name: str, phone: str = "", caller_name: Optional[str] = None) -> dict:
    """
    Provisions internal discussion root directory under ROOT_FOLDER_ID/Internal_Discussions
    and standardized subfolders for this teammate pair or member.
    If caller_name and teammate_name are provided, creates a canonical bidirectional pair folder:
    'Team_Syncs - {Name1} & {Name2}' (sorted alphabetically) so calls from either party land in one thread.
    """
    service = _get_service()
    if not service:
        logger.warning("Drive service not available for internal discussion hierarchy")
        return {}

    try:
        internal_root_id = _find_or_create_folder("Internal_Discussions", ROOT_FOLDER_ID)
        
        # Check if we can pair caller and teammate into a unified thread
        names = []
        if caller_name and caller_name.strip():
            names.append(caller_name.strip())
        if teammate_name and teammate_name.strip():
            names.append(teammate_name.strip())
        
        # Clean names of roles or prefixes
        clean_names = []
        for n in names:
            c = n.split("(")[0].strip()
            if c and c not in clean_names:
                clean_names.append(c)
        clean_names.sort()

        if len(clean_names) >= 2:
            folder_name = f"Team_Syncs - {' & '.join(clean_names)}"
        else:
            effective_name = teammate_name.strip() or "Teammate"
            folder_name = f"{effective_name} ({phone})".strip() if phone else effective_name

        member_folder_id = _find_or_create_folder(folder_name, internal_root_id or ROOT_FOLDER_ID)

        subfolder_ids = {}
        for key, name in INTERNAL_SUBFOLDERS.items():
            sf_id = _find_or_create_folder(name, member_folder_id)
            subfolder_ids[key] = sf_id

        try:
            service.permissions().create(
                fileId=member_folder_id,
                body={"type": "anyone", "role": "reader"},
                fields="id",
                supportsAllDrives=True
            ).execute()
        except Exception:
            pass

        return {
            "member_folder_id": member_folder_id,
            "member_folder_url": f"https://drive.google.com/drive/folders/{member_folder_id}",
            "subfolders": subfolder_ids
        }
    except Exception as e:
        logger.error(f"Failed to ensure internal discussion drive hierarchy: {e}")
        return {}


def upload_internal_discussion_asset(
    teammate_name: str,
    phone: str,
    category: str,
    file_bytes: bytes,
    filename: str,
    mime_type: str,
    caller_name: Optional[str] = None,
) -> Optional[dict]:
    """
    Uploads an internal recording or transcript to the teammate's internal discussion folder.
    Categories: 'calls', 'transcripts', 'notes'
    """
    service = _get_service()
    if not service:
        logger.warning("Drive service not available, skipping internal asset upload")
        return None

    try:
        hierarchy = ensure_internal_discussion_drive_hierarchy(teammate_name, phone, caller_name=caller_name)
        subfolders = hierarchy.get("subfolders", {})
        target_folder_id = subfolders.get(category) or hierarchy.get("member_folder_id") or ROOT_FOLDER_ID

        file_id = None
        web_view_link = ""
        web_content_link = ""

        try:
            from googleapiclient.http import MediaInMemoryUpload
            file_metadata = {
                "name": filename,
                "parents": [target_folder_id]
            }
            media = MediaInMemoryUpload(file_bytes, mimetype=mime_type, resumable=True)
            uploaded = service.files().create(
                body=file_metadata,
                media_body=media,
                fields="id,webViewLink,webContentLink,size",
                supportsAllDrives=True
            ).execute()

            file_id = uploaded.get("id")
            web_view_link = uploaded.get("webViewLink", "")
            web_content_link = uploaded.get("webContentLink", "")
        except Exception as upload_err:
            logger.warning(f"Native Service Account upload failed ({upload_err}). Routing via Drive bridge...")
            import base64
            import time
            import requests as req
            gas_url = os.environ.get(
                "DRIVE_WEBHOOK_URL",
                "https://script.google.com/macros/s/AKfycbyCDb9IWz05Ie9_qF_OeLCgQiwBXn5oDbHP4WWp71q6i-K-n4sLPTFYpl7rBdJFc2eS/exec"
            )
            gas_payload = {
                "filename": filename,
                "folderId": target_folder_id,
                "mimeType": mime_type,
                "timestamp": int(time.time() * 1000),
                "data": base64.b64encode(file_bytes).decode('utf-8')
            }
            gas_resp = req.post(gas_url, json=gas_payload, timeout=90)
            if gas_resp.status_code == 200:
                gas_data = gas_resp.json()
                file_url = gas_data.get("fileUrl") or gas_data.get("url") or gas_data.get("link")
                import re
                fid_match = re.search(r'/d/([a-zA-Z0-9_-]+)', file_url or '')
                file_id = fid_match.group(1) if fid_match else None
                if not file_id:
                    raise Exception(f"Failed to extract file ID from Drive bridge response: {gas_data}")
                web_view_link = file_url
                web_content_link = f"https://drive.google.com/uc?id={file_id}&export=download"
            else:
                raise Exception(f"Drive bridge failed with status {gas_resp.status_code}: {gas_resp.text}")

        try:
            service.permissions().create(
                fileId=file_id,
                body={"type": "anyone", "role": "reader"},
                fields="id",
                supportsAllDrives=True
            ).execute()
        except Exception:
            pass

        embed_link = f"https://drive.google.com/file/d/{file_id}/preview"
        logger.info(f"Uploaded internal discussion asset [{category}]: {filename} -> {file_id} (Folder: {target_folder_id})")
        return {
            "file_id": file_id,
            "web_view_link": web_view_link or f"https://drive.google.com/file/d/{file_id}/view",
            "embed_link": embed_link,
            "web_content_link": web_content_link,
            "folder_id": target_folder_id,
            "member_folder_id": hierarchy.get("member_folder_id"),
            "member_folder_url": hierarchy.get("member_folder_url"),
        }
    except Exception as e:
        logger.error(f"Failed to upload internal discussion asset {filename}: {e}")
        return None


def create_client_internal_sync_shortcut(
    client_slug: str,
    client_name: str,
    target_drive_file_id: str,
    shortcut_name: str,
    business_name: str = ""
) -> Optional[dict]:
    """
    Creates a Google Drive shortcut in the client's 01_Call_Recordings folder pointing to
    the internal discussion recording so it appears seamlessly in the client's asset vault.
    """
    service = _get_service()
    if not service or not target_drive_file_id:
        return None
    try:
        hierarchy = ensure_client_drive_hierarchy(client_slug, client_name, business_name)
        calls_folder_id = hierarchy.get("subfolders", {}).get("calls") or hierarchy.get("client_folder_id")
        if not calls_folder_id:
            return None

        # Check if shortcut already exists
        q = f"'{calls_folder_id}' in parents and trashed=false"
        existing = service.files().list(q=q, fields="files(id, name, mimeType)", supportsAllDrives=True).execute().get("files", [])
        for f in existing:
            if f.get("name") == shortcut_name:
                return {"id": f.get("id"), "shortcut": True, "existing": True}

        shortcut_metadata = {
            "name": shortcut_name,
            "mimeType": "application/vnd.google-apps.shortcut",
            "parents": [calls_folder_id],
            "shortcutDetails": {
                "targetId": target_drive_file_id
            }
        }
        res = service.files().create(body=shortcut_metadata, fields="id, name, webViewLink", supportsAllDrives=True).execute()
        logger.info(f"Created internal sync shortcut in client folder ({client_slug}): {shortcut_name} -> {res.get('id')}")
        return res
    except Exception as e:
        logger.error(f"Failed to create client internal sync shortcut: {e}")
        return None


def upload_recording(
    file_bytes: bytes,
    filename: str,
    mime_type: str,
    lead_name: str,
    business_name: str = ""
) -> Optional[dict]:
    """
    Upload a recording file to Google Drive under the client's 01_Call_Recordings subfolder.
    Returns dict with file_id, web_view_link, embed_link or None on failure.
    """
    service = _get_service()
    if not service:
        logger.warning("Drive service not available, skipping upload")
        return None
    
    try:
        # Generate safe slug for client folder
        client_label = business_name.strip() or lead_name.strip() or "client"
        import re
        client_slug = re.sub(r'[^a-zA-Z0-9_\-]', '', client_label.lower().replace(' ', '-')).strip('-') or "client"
        
        res = upload_client_asset(
            client_slug=client_slug,
            client_name=lead_name,
            category="calls",
            file_bytes=file_bytes,
            filename=filename,
            mime_type=mime_type,
            business_name=business_name
        )
        if res:
            is_vid = (mime_type or '').startswith('video/') or any(filename.lower().endswith(ext) for ext in ['.mp4', '.webm', '.mov', '.mkv', '.avi'])
            res['is_video'] = is_vid
            res['filename'] = filename
            res['mime_type'] = mime_type
        return res
    except Exception as e:
        logger.error(f"Drive upload failed: {e}")
        return None


def attach_drive_meeting_by_id_or_url(
    client_slug: str,
    client_name: str,
    drive_file_id_or_url: str,
    title: str = "",
    business_name: str = ""
) -> Optional[dict]:
    """
    Extracts Google Drive file ID from a URL or raw ID, inspects metadata,
    ensures public reader permissions, and returns structured meeting recording metadata.
    """
    import re
    if not drive_file_id_or_url or not str(drive_file_id_or_url).strip():
        return None

    raw_input = str(drive_file_id_or_url).strip()
    
    # Extract file ID using regex (Drive file IDs are alphanumeric with dashes/underscores, 25+ chars)
    file_id = None
    id_match = re.search(r'(?:/d/|id=)([-\w]{25,})', raw_input)
    if id_match:
        file_id = id_match.group(1)
    else:
        raw_match = re.search(r'([-\w]{25,})', raw_input)
        if raw_match:
            file_id = raw_match.group(1)

    if not file_id:
        file_id = raw_input

    service = _get_service()
    meta = {}
    if service:
        try:
            meta = service.files().get(
                fileId=file_id,
                fields="id,name,mimeType,size,webViewLink,webContentLink,createdTime",
                supportsAllDrives=True
            ).execute()
            # Set public read permission so CRM preview iframe works
            try:
                service.permissions().create(
                    fileId=file_id,
                    body={"type": "anyone", "role": "reader"},
                    fields="id",
                    supportsAllDrives=True
                ).execute()
            except Exception:
                pass
        except Exception as e:
            logger.warning(f"Could not fetch Drive metadata for {file_id}: {e}")

    filename = meta.get("name") or (f"{title}.mp4" if title else f"meeting_recording_{file_id[:8]}.mp4")
    mime_type = meta.get("mimeType") or "video/mp4"
    is_video = mime_type.startswith("video/") or any(filename.lower().endswith(ext) for ext in ['.mp4', '.webm', '.mov', '.mkv', '.avi']) or "meet" in raw_input.lower()
    
    web_view_link = meta.get("webViewLink") or f"https://drive.google.com/file/d/{file_id}/view"
    preview_link = f"https://drive.google.com/file/d/{file_id}/preview"
    stream_url = f"/api/recordings/drive/{file_id}"
    size = int(meta.get("size") or 0)

    return {
        "file_id": file_id,
        "filename": filename,
        "mime_type": mime_type,
        "is_video": is_video,
        "title": title or filename,
        "web_view_link": web_view_link,
        "preview_link": preview_link,
        "stream_url": stream_url,
        "size_bytes": size,
        "source": "google_drive"
    }


def get_file_stream(file_id: str) -> Optional[tuple]:
    """Download file bytes from Drive. Returns (bytes, mime_type) or None."""
    service = _get_service()
    if not service:
        return None
    try:
        meta = service.files().get(fileId=file_id, fields="mimeType,name", supportsAllDrives=True).execute()
        request = service.files().get_media(fileId=file_id, supportsAllDrives=True)
        buffer = io.BytesIO()
        from googleapiclient.http import MediaIoBaseDownload
        downloader = MediaIoBaseDownload(buffer, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()
        buffer.seek(0)
        return buffer.read(), meta.get("mimeType", "application/octet-stream")
    except Exception as e:
        logger.error(f"Drive download failed: {e}")
        return None


def is_available() -> bool:
    """Check if Drive integration is configured and working."""
    return _get_service() is not None


# Backwards compatibility aliases
drive_upload = upload_recording
drive_get_stream = get_file_stream


# ─── Ad Creative Asset Storage in Google Drive ───────────────────────

CREATIVES_FOLDER_ID = os.environ.get(
    "GOOGLE_DRIVE_CREATIVES_FOLDER_ID",
    "1dwX-XZ9QqH5IXKVKhn9_NCvbiDqTUNjj"
)

def set_creatives_folder_id(new_id: str):
    """Dynamically update the creatives folder ID."""
    global CREATIVES_FOLDER_ID
    CREATIVES_FOLDER_ID = new_id.strip()
    return CREATIVES_FOLDER_ID

def get_or_create_creatives_folder() -> Optional[dict]:
    """Ensure the 'Meta Ad Creatives' folder exists and return its metadata."""
    service = _get_service()
    if not service:
        return None
    try:
        # Check by known ID first
        if CREATIVES_FOLDER_ID:
            try:
                f = service.files().get(fileId=CREATIVES_FOLDER_ID, fields="id,name,webViewLink", supportsAllDrives=True).execute()
                return f
            except Exception:
                pass
        
        folder_id = _find_or_create_folder("Meta Ad Creatives", ROOT_FOLDER_ID)
        if folder_id:
            try:
                service.permissions().create(
                    fileId=folder_id,
                    body={"type": "anyone", "role": "reader"},
                    fields="id",
                    supportsAllDrives=True
                ).execute()
            except Exception:
                pass
            return service.files().get(fileId=folder_id, fields="id,name,webViewLink", supportsAllDrives=True).execute()
        return None
    except Exception as e:
        logger.error(f"Error getting creatives folder: {e}")
        return None


LOCAL_CREATIVES_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "static", "assets", "creatives"
)
os.makedirs(LOCAL_CREATIVES_DIR, exist_ok=True)


_creatives_files_cache = {"files": [], "timestamp": 0}

def list_creative_files(force_refresh: bool = False) -> list:
    """List all creative files stored in Drive and local assets directory with 30s cache."""
    import time
    global _creatives_files_cache
    if not force_refresh and _creatives_files_cache["files"] and (time.time() - _creatives_files_cache["timestamp"] < 30):
        return _creatives_files_cache["files"]

    all_files = []
    
    # 1. Drive files
    service = _get_service()
    if service:
        try:
            folder = get_or_create_creatives_folder()
            folder_id = folder["id"] if folder else CREATIVES_FOLDER_ID
            query = f"'{folder_id}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'"
            results = service.files().list(
                q=query,
                fields="files(id, name, mimeType, webViewLink, webContentLink, thumbnailLink, size, createdTime)",
                pageSize=100,
                supportsAllDrives=True,
                includeItemsFromAllDrives=True
            ).execute()
            for f in results.get("files", []):
                all_files.append({
                    "file_id": f["id"],
                    "filename": f["name"],
                    "mime_type": f.get("mimeType", ""),
                    "is_video": f.get("mimeType", "").startswith("video/"),
                    "thumbnail_url": f.get("thumbnailLink") or f"/api/creatives/thumbnail/{f['id']}",
                    "stream_url": f"/api/creatives/stream/{f['id']}",
                    "preview_link": f"https://drive.google.com/file/d/{f['id']}/preview",
                    "web_view_link": f.get("webViewLink") or f"https://drive.google.com/file/d/{f['id']}/view",
                    "size": f.get("size"),
                    "source": "google_drive"
                })
        except Exception as e:
            logger.warning(f"Error listing Drive creative files: {e}")


    # 2. Local files fallback/supplement
    if os.path.exists(LOCAL_CREATIVES_DIR):
        import urllib.parse
        for fname in os.listdir(LOCAL_CREATIVES_DIR):
            if fname.startswith("."):
                continue
            ext = os.path.splitext(fname)[1].lower()
            if ext not in [".png", ".jpg", ".jpeg", ".webp", ".mp4", ".mov", ".webm"]:
                continue
            
            # Avoid duplicate if already in Drive
            if any(f["filename"] == fname for f in all_files):
                continue
            
            encoded_fname = urllib.parse.quote(fname)
            is_video = ext in [".mp4", ".mov", ".webm"]
            fpath = os.path.join(LOCAL_CREATIVES_DIR, fname)
            all_files.append({
                "file_id": "local_" + fname,
                "filename": fname,
                "mime_type": "video/mp4" if is_video else "image/png",
                "is_video": is_video,
                "thumbnail_url": f"/static/assets/creatives/{encoded_fname}",
                "stream_url": f"/static/assets/creatives/{encoded_fname}",
                "preview_link": f"/static/assets/creatives/{encoded_fname}",
                "web_view_link": f"https://drive.google.com/drive/folders/{CREATIVES_FOLDER_ID}",
                "size": os.path.getsize(fpath),
                "source": "local_storage"
            })

    _creatives_files_cache["files"] = all_files
    _creatives_files_cache["timestamp"] = time.time()
    return all_files


def find_creative_in_drive(ad_name: str = "", ad_id: str = "", cached_files: list = None) -> Optional[dict]:
    """
    Search Google Drive and local creatives directory for an ad creative matching ad_name or ad_id.
    Uses scored token matching with strict ad number validation.
    """
    import re
    try:
        files = cached_files if cached_files is not None else list_creative_files()
        if not files:
            return None

        best_match = None
        best_score = 0

        ad_num = None
        ad_lower = (ad_name or "").lower().strip()
        if ad_name:
            num_match = re.search(r"ad\s*(\d+)", ad_name, re.IGNORECASE)
            if num_match:
                ad_num = num_match.group(1)

        for f in files:
            score = 0
            fname = f["filename"].lower()
            
            # 1. Ad ID match
            if ad_id and ad_id.lower() in fname:
                score += 100

            # 2. Ad number match (with conflict rejection)
            file_num_match = re.search(r"ad\s*(\d+)", fname, re.IGNORECASE)
            if ad_num:
                if file_num_match:
                    if file_num_match.group(1) == ad_num:
                        score += 50
                    else:
                        # Explicitly conflicting ad number, skip
                        continue
                elif f"ad{ad_num}" in fname or f"ad {ad_num}" in fname:
                    score += 50
            
            # 3. High-confidence distinctive keywords
            if "iitian" in ad_lower and "iitian" in fname:
                score += 40
            if "excel" in ad_lower and "excel" in fname:
                score += 40
            if "different" in ad_lower and "different" in fname:
                score += 40
            if "thinking" in ad_lower and "thinking" in fname:
                score += 20

            if score > best_score:
                best_score = score
                best_match = f

        if best_match and best_score > 0:
            res = dict(best_match)
            res["title"] = ad_name or best_match["filename"]
            return res

        # Fallback if only 1 file exists
        if len(files) == 1:
            res = dict(files[0])
            res["title"] = ad_name or files[0]["filename"]
            return res

        return None
    except Exception as e:
        logger.error(f"Error finding creative in Drive: {e}")
        return None



def upload_ad_creative(
    file_bytes: bytes,
    filename: str,
    mime_type: str,
    ad_name: str = ""
) -> Optional[dict]:
    """
    Save ad creative locally in static/assets/creatives and sync to Google Drive.
    Always succeeds even if Google Drive quota is exceeded.
    """
    import urllib.parse
    os.makedirs(LOCAL_CREATIVES_DIR, exist_ok=True)
    local_path = os.path.join(LOCAL_CREATIVES_DIR, filename)
    
    # 1. Save locally
    with open(local_path, "wb") as f:
        f.write(file_bytes)
    
    is_video = mime_type.startswith("video/") or os.path.splitext(filename)[1].lower() in [".mp4", ".mov", ".webm"]
    encoded_fname = urllib.parse.quote(filename)
    
    local_result = {
        "file_id": "local_" + filename,
        "filename": filename,
        "mime_type": mime_type,
        "is_video": is_video,
        "thumbnail_url": f"/static/assets/creatives/{encoded_fname}",
        "stream_url": f"/static/assets/creatives/{encoded_fname}",
        "preview_link": f"/static/assets/creatives/{encoded_fname}",
        "web_view_link": f"https://drive.google.com/drive/folders/{CREATIVES_FOLDER_ID}",
        "title": ad_name or filename,
        "source": "local_storage"
    }

    # 2. Attempt Drive upload
    service = _get_service()
    if service:
        try:
            folder = get_or_create_creatives_folder()
            folder_id = folder["id"] if folder else CREATIVES_FOLDER_ID

            from googleapiclient.http import MediaInMemoryUpload
            file_metadata = {
                "name": filename,
                "parents": [folder_id]
            }
            media = MediaInMemoryUpload(file_bytes, mimetype=mime_type, resumable=True)
            uploaded = service.files().create(
                body=file_metadata,
                media_body=media,
                fields="id,name,mimeType,webViewLink,webContentLink,thumbnailLink,size",
                supportsAllDrives=True
            ).execute()

            file_id = uploaded.get("id")
            try:
                service.permissions().create(
                    fileId=file_id,
                    body={"type": "anyone", "role": "reader"},
                    fields="id",
                    supportsAllDrives=True
                ).execute()
            except Exception:
                pass


            thumb = uploaded.get("thumbnailLink") or f"/api/creatives/thumbnail/{file_id}"
            return {
                "file_id": file_id,
                "filename": filename,
                "mime_type": mime_type,
                "is_video": is_video,
                "thumbnail_url": thumb,
                "stream_url": f"/api/creatives/stream/{file_id}",
                "preview_link": f"https://drive.google.com/file/d/{file_id}/preview",
                "web_view_link": uploaded.get("webViewLink") or f"https://drive.google.com/file/d/{file_id}/view",
                "title": ad_name or filename,
                "source": "google_drive"
            }
        except Exception as e:
            logger.warning(f"Google Drive upload quota/error: {e}. Saved locally to {local_path}")
            return local_result

    return local_result


