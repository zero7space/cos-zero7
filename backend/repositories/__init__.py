"""
COS Theta — Repositories Package
Modular repository layer for database access.
"""

from backend.repositories.base import BaseRepository
from backend.repositories.activities import ActivityRepository
from backend.repositories.subdomains import SubdomainRepository
from backend.repositories.attributions import AttributionRepository
from backend.repositories.prototypes import PrototypeRepository
from backend.repositories.contacts import NoteRepository, CallLogRepository
from backend.repositories.deals import DealRepository
from backend.repositories.facts import FactsRepository

__all__ = [
    "BaseRepository",
    "ActivityRepository",
    "SubdomainRepository",
    "AttributionRepository",
    "PrototypeRepository",
    "NoteRepository",
    "CallLogRepository",
    "DealRepository",
    "FactsRepository",
]
