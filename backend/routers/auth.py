"""
COS Theta — Auth & User Management Router
Handles authentication, token exchange, and user account lifecycle.
"""

from fastapi import APIRouter, Depends, HTTPException
from backend.models import UserLogin, UserCreate, UserUpdate
from backend.database import Repository
from backend.auth import (
    hash_password,
    verify_password,
    create_token,
    get_current_user,
    require_auth,
    require_admin,
)

router = APIRouter(tags=["auth"])


@router.post("/api/auth/login")
def login(data: UserLogin):
    user = Repository.get_user_by_email(data.email)
    if not user or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_token(user["id"], user["role"], user.get("email", ""), user.get("name", ""))
    user_copy = dict(user)
    del user_copy["password_hash"]
    return {"token": token, "access_token": token, "user": user_copy}


@router.post("/api/auth/token")
def login_token(data: UserLogin):
    return login(data)


@router.get("/api/auth/me")
def me(user: dict = Depends(get_current_user)):
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    full_user = Repository.get_user(user["user_id"])
    if not full_user:
        raise HTTPException(status_code=404, detail="User not found")
    user_copy = dict(full_user)
    del user_copy["password_hash"]
    return user_copy


@router.get("/api/users")
def list_users(user: dict = Depends(require_auth)):
    users = Repository.list_users()
    for u in users:
        if "password_hash" in u:
            del u["password_hash"]
    return users


@router.post("/api/users")
def create_user(data: UserCreate, user: dict = Depends(require_admin)):
    existing = Repository.get_user_by_email(data.email)
    if existing:
        update_data = {}
        if data.name:
            update_data["name"] = data.name
        if data.role:
            update_data["role"] = data.role
        if data.phone is not None:
            update_data["phone"] = data.phone
        if data.password:
            update_data["password_hash"] = hash_password(data.password)
        updated = Repository.update_user(existing["id"], update_data)
        if updated and "password_hash" in updated:
            del updated["password_hash"]
        return updated

    pwd = data.password if data.password else "admin123"
    created = Repository.create_user(
        data.name, data.email, hash_password(pwd), data.role, phone=data.phone
    )
    if created and "password_hash" in created:
        del created["password_hash"]
    return created



@router.put("/api/users/{id}")
def update_user(id: str, data: UserUpdate, user: dict = Depends(require_auth)):
    is_admin = user.get("role") == "admin"
    is_self = user.get("user_id") == id
    if not is_admin and not is_self:
        raise HTTPException(status_code=403, detail="Not authorized to edit this user")

    target = Repository.get_user(id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    update_data = {}
    if data.name:
        update_data["name"] = data.name
    if data.email:
        update_data["email"] = data.email
    if data.phone is not None:
        update_data["phone"] = data.phone
    if data.role:
        if not is_admin and data.role != target["role"]:
            raise HTTPException(status_code=403, detail="Only administrators can modify system roles")
        update_data["role"] = data.role
    if data.password:
        update_data["password_hash"] = hash_password(data.password)

    updated = Repository.update_user(id, update_data)
    if updated and "password_hash" in updated:
        del updated["password_hash"]
    return updated


@router.delete("/api/users/{id}")
def delete_user(id: str, user: dict = Depends(require_admin)):
    if id == user.get("user_id"):
        raise HTTPException(status_code=400, detail="Cannot delete your own active administrator account")
    target = Repository.get_user(id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    Repository.delete_user(id)
    return {"status": "success", "message": f"User {target['name']} deleted successfully"}
