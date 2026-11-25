"""
COS Theta — Routers Package
Modular API routers for FastAPI.
"""

from backend.routers import deals, health, auth, facts, whatsapp, leads, calls, subdomains

__all__ = ["deals", "health", "auth", "facts", "whatsapp", "leads", "calls", "subdomains"]
