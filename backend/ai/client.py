"""
Unified AI Client for Zero7 CRM.
Connects to dedicated OmniRoute Server (Tailscale P2P WireGuard Mesh, Local LAN, and Cloudflare Tunnel)
with automatic multi-tier failover and Google Gemini direct fallback.
"""

import os
import json
import time
import urllib.request
import urllib.error
from typing import List, Dict, Any, Optional

# Load environment variables if available
try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

# OmniRoute Multi-Tier Endpoint Configuration
OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "").rstrip("/")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")

OMNIROUTE_PRIMARY_URL = os.environ.get("OMNIROUTE_PRIMARY_URL", "http://100.101.21.96:20128/v1").rstrip("/")
OMNIROUTE_LAN_URL = os.environ.get("OMNIROUTE_LAN_URL", "http://192.168.1.11:20128/v1").rstrip("/")
OMNIROUTE_TUNNEL_URL = os.environ.get("OMNIROUTE_TUNNEL_URL", "https://conditioning-baskets-vip-christ.trycloudflare.com/v1").rstrip("/")
OMNIROUTE_LOCAL_URL = os.environ.get("OMNIROUTE_LOCAL_URL", "http://localhost:20128/v1").rstrip("/")
OMNIROUTE_API_KEY = os.environ.get("OMNIROUTE_API_KEY") or OPENAI_API_KEY or ""

# Anthropic Endpoint
ANTHROPIC_BASE_URL = os.environ.get("ANTHROPIC_BASE_URL", "http://100.101.21.96:20128").rstrip("/")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY") or OMNIROUTE_API_KEY

# Legacy Fallback Gateway Configuration
LEGACY_API_BASE = os.environ.get("AI_API_BASE", "http://168.144.91.0:8080/v1").rstrip("/")
LEGACY_API_KEY = os.environ.get("AI_API_KEY", "")

# Default Model: OmniRoute native Antigravity OAuth model (ultra-fast, zero-token cost)
DEFAULT_MODEL = os.environ.get("AI_MODEL", "antigravity/gemini-3.7-flash-tiered")

MODEL_ALIASES = {
    "pro": "antigravity/gemini-3.7-flash-tiered",
    "flash": "antigravity/gemini-3.7-flash-tiered",
    "local": "antigravity/gemini-3.7-flash-tiered",
    "best-fast": "antigravity/gemini-3.7-flash-tiered",
    "auto/best-fast": "antigravity/gemini-3.7-flash-tiered",
    "auto/best-coding": "antigravity/gemini-3.7-flash-tiered",
    "auto/best-reasoning": "antigravity/gemini-3.7-flash-tiered",
    "gemini-3.7": "antigravity/gemini-3.7-flash-tiered",
    "gemini-3.8": "antigravity/gemini-3.8-flash-tiered",
}

def resolve_model_name(model_name: Optional[str]) -> str:
    """Resolves model aliases and legacy identifiers to optimal OmniRoute models."""
    if not model_name:
        return DEFAULT_MODEL
    cleaned = str(model_name).strip()
    return MODEL_ALIASES.get(cleaned, cleaned)

def get_agent_model(agent_slug: Optional[str] = None) -> str:
    """Returns optimal OmniRoute model for a given agent slug."""
    slug = (agent_slug or "").lower().strip()
    if slug == "prototype_maker":
        return "antigravity/gemini-3.7-flash-tiered"
    elif slug == "lead_researcher":
        return "antigravity/gemini-3.7-flash-tiered"
    elif slug == "sow_architect":
        return "antigravity/gemini-3.7-flash-tiered"
    elif slug == "whatsapp_nudge":
        return "antigravity/gemini-3.7-flash-tiered"
    elif slug == "chief":
        return "antigravity/gemini-3.7-flash-tiered"
    elif slug == "pipeline_sentinel":
        return "antigravity/gemini-3.7-flash-tiered"
    return DEFAULT_MODEL

# In-memory model cache
_MODELS_CACHE = {"timestamp": 0.0, "data": []}
CACHE_TTL_SECONDS = 300  # 5 minutes


def _send_request(url: str, api_key: str, payload: Dict[str, Any], timeout: int) -> Optional[str]:
    """Helper to send POST chat completion request."""
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read().decode("utf-8"))
        if "choices" in data and len(data["choices"]) > 0:
            msg = data["choices"][0].get("message", {})
            content = msg.get("content") or msg.get("reasoning_content") or ""
            if content:
                return content.strip()
    return None


def chat_completion(
    messages: List[Dict[str, str]],
    model: Optional[str] = None,
    temperature: float = 0.7,
    max_tokens: int = 3000,
    timeout: int = 45
) -> str:
    """
    Send chat completion request across the multi-tier gateway:
    1. Primary Tailscale WireGuard Mesh (100.101.21.96:20128/v1)
    2. Local LAN (192.168.1.11:20128/v1)
    3. Cloudflare Public Tunnel
    4. Localhost Loopback (localhost:20128/v1)
    5. Legacy Gateway
    6. Direct Gemini API
    """
    primary_model = resolve_model_name(model or DEFAULT_MODEL)
    
    # Candidate models to try in case the primary encounters an issue
    candidate_models = [primary_model]
    if primary_model != "antigravity/gemini-3.7-flash-tiered":
        candidate_models.append("antigravity/gemini-3.7-flash-tiered")
    if "antigravity/gemini-3.8-flash-tiered" not in candidate_models:
        candidate_models.append("antigravity/gemini-3.8-flash-tiered")

    # Ranked list of OmniRoute endpoints to try
    candidate_endpoints = []
    
    # 1. Primary Tailscale Mesh (or explicit OPENAI_BASE_URL if set)
    primary = OPENAI_BASE_URL or OMNIROUTE_PRIMARY_URL
    if primary:
        candidate_endpoints.append(("Tailscale Primary", primary, 2))  # fast 2s connect probe

    # 2. Local LAN (Wi-Fi)
    if OMNIROUTE_LAN_URL and OMNIROUTE_LAN_URL not in [e[1] for e in candidate_endpoints]:
        candidate_endpoints.append(("Local LAN", OMNIROUTE_LAN_URL, 6))

    # 3. Public Cloudflare Tunnel
    if OMNIROUTE_TUNNEL_URL and OMNIROUTE_TUNNEL_URL not in [e[1] for e in candidate_endpoints]:
        candidate_endpoints.append(("Cloudflare Tunnel", OMNIROUTE_TUNNEL_URL, timeout))

    # 4. Localhost
    if OMNIROUTE_LOCAL_URL and OMNIROUTE_LOCAL_URL not in [e[1] for e in candidate_endpoints]:
        candidate_endpoints.append(("Localhost", OMNIROUTE_LOCAL_URL, 2))

    # Try OmniRoute candidates across model fallback cascade
    for target_m in candidate_models:
        payload = {
            "model": target_m,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens
        }
        for name, base_url, t_out in candidate_endpoints:
            try:
                content = _send_request(
                    f"{base_url}/chat/completions",
                    OMNIROUTE_API_KEY,
                    payload,
                    timeout=t_out
                )
                if content:
                    return content
            except Exception:
                continue

    # 5. Try Legacy Gateway fallback
    legacy_payload = {
        "model": "gemini-3.7-flash-tiered",
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens
    }
    try:
        content = _send_request(
            f"{LEGACY_API_BASE}/chat/completions",
            LEGACY_API_KEY,
            legacy_payload,
            timeout=timeout
        )
        if content:
            return content
    except Exception as e:
        print(f"[AI CLIENT] Legacy gateway error: {e}")

    # 6. Fallback to direct Gemini API if GEMINI_API_KEY exists
    gemini_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if gemini_key:
        try:
            gemini_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={gemini_key}"
            prompt_parts = []
            for m in messages:
                role = m.get("role", "user").upper()
                content = m.get("content", "")
                prompt_parts.append(f"{role}:\n{content}\n")
            
            gem_payload = {
                "contents": [{"parts": [{"text": "\n".join(prompt_parts)}]}],
                "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens}
            }
            gem_req = urllib.request.Request(
                gemini_url,
                data=json.dumps(gem_payload).encode("utf-8"),
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(gem_req, timeout=timeout) as resp:
                res_json = json.loads(resp.read().decode("utf-8"))
                return res_json["candidates"][0]["content"]["parts"][0]["text"].strip()
        except Exception as e2:
            print(f"[AI CLIENT] Direct Gemini fallback error: {e2}")

    raise RuntimeError("AI generation failed on all configured endpoints.")


def get_available_models() -> List[Dict[str, Any]]:
    """
    Fetch and cache the available models from OmniRoute.
    Returns list of dicts: [{'id': ..., 'name': ..., 'provider': ...}]
    """
    global _MODELS_CACHE
    now = time.time()
    if _MODELS_CACHE["data"] and (now - _MODELS_CACHE["timestamp"]) < CACHE_TTL_SECONDS:
        return _MODELS_CACHE["data"]

    for base_url in [OMNIROUTE_LAN_URL, OMNIROUTE_TUNNEL_URL, OMNIROUTE_PRIMARY_URL, OMNIROUTE_LOCAL_URL]:
        if not base_url:
            continue
        try:
            req = urllib.request.Request(
                f"{base_url}/models",
                headers={"Authorization": f"Bearer {OMNIROUTE_API_KEY}"}
            )
            with urllib.request.urlopen(req, timeout=4) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                models = data.get("data", [])
                if models:
                    # Sort Antigravity OAuth models to the top of catalog
                    anti_models = [m for m in models if "antigravity/" in (m.get("id") or "")]
                    other_models = [m for m in models if "antigravity/" not in (m.get("id") or "")]
                    sorted_models = anti_models + other_models
                    _MODELS_CACHE = {"timestamp": now, "data": sorted_models}
                    return sorted_models
        except Exception:
            continue

    # Fallback to curated standard models if offline
    curated = [
        {"id": "antigravity/gemini-3.7-flash-tiered", "name": "Gemini 3.7 Flash (Antigravity OAuth - Recommended)"},
        {"id": "antigravity/gemini-3.8-flash-tiered", "name": "Gemini 3.8 Flash (Antigravity OAuth)"},
        {"id": "antigravity/gpt-oss-120b-medium", "name": "GPT-OSS 120B (Antigravity OAuth)"},
        {"id": "auto/best-fast", "name": "Best Fast (Auto-Combo)"},
        {"id": "auto/best-reasoning", "name": "Best Reasoning (DeepSeek / Claude)"},
        {"id": "auto/best-coding", "name": "Best Coding (Kimi / Claude / DeepSeek)"},
        {"id": "kimi-coding/k3", "name": "Kimi K3 (Moonshot AI)"},
    ]
    return curated
