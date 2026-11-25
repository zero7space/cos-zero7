import hashlib
import json
import base64
from fastapi import Request

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def verify_password(password: str, hashed: str) -> bool:
    return hash_password(password) == hashed

def create_token(user_id: str, role: str, email: str = "", name: str = "") -> str:
    payload = {
        "user_id": user_id,
        "id": user_id,
        "role": role,
        "email": email,
        "name": name,
    }
    json_payload = json.dumps(payload)
    return base64.b64encode(json_payload.encode()).decode()

def decode_token(token: str) -> dict:
    try:
        json_payload = base64.b64decode(token.encode()).decode()
        return json.loads(json_payload)
    except Exception:
        return None

def get_current_user(request: Request) -> dict:
    token = None
    auth = request.headers.get("Authorization")
    if auth and auth.startswith("Bearer "):
        token = auth.split(" ")[1]
    elif request.query_params.get("token"):
        token = request.query_params.get("token")

    if token:
        decoded = decode_token(token)
        if decoded:
            if not decoded.get("email") and decoded.get("user_id"):
                try:
                    from backend.database import Repository
                    u = Repository.get_user(decoded["user_id"])
                    if u:
                        decoded["email"] = u.get("email") or ""
                        decoded["name"] = u.get("name") or ""
                        decoded["id"] = u.get("id") or decoded["user_id"]
                except Exception:
                    pass
            if "id" not in decoded and "user_id" in decoded:
                decoded["id"] = decoded["user_id"]
            return decoded
    return None


def require_auth(user: dict = None) -> dict:
    from fastapi import Depends, HTTPException
    # Default dependency when called via Depends(require_auth)
    # Fastapi evaluates signature
    return user


# Proper FastAPI dependency functions
from fastapi import Depends, HTTPException


def require_authenticated_user(user: dict = Depends(get_current_user)) -> dict:
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return user


require_auth = require_authenticated_user


def require_admin(user: dict = Depends(require_authenticated_user)) -> dict:
    if user.get('role') != 'admin':
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return user
