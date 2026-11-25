import os
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Settings:
    # Database
    database_url: str = field(default_factory=lambda: os.environ.get("DATABASE_URL", ""))
    db_path: str = field(
        default_factory=lambda: os.environ.get(
            "ZERO7_DB_PATH",
            os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "zero7_crm.db"),
        )
    )

    # Auth
    jwt_secret: str = field(default_factory=lambda: os.environ.get("JWT_SECRET", "zero7-dev-secret"))
    jwt_algorithm: str = "HS256"
    jwt_expiry_hours: int = 72

    # Google
    google_credentials_path: str = field(default_factory=lambda: os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", ""))
    google_sheet_id: str = field(default_factory=lambda: os.environ.get("GOOGLE_SHEET_ID", ""))
    google_drive_root: str = field(default_factory=lambda: os.environ.get("GOOGLE_DRIVE_ROOT_FOLDER_ID", ""))

    # Hostinger DNS
    hostinger_api_token: str = field(default_factory=lambda: os.environ.get("HOSTINGER_API_TOKEN", ""))
    hostinger_domain: str = "zero7.space"
    droplet_ip: str = "68.183.92.215"

    # AI
    gemini_api_key: str = field(default_factory=lambda: os.environ.get("GEMINI_API_KEY", ""))

    # Deepgram
    deepgram_api_key: str = field(default_factory=lambda: os.environ.get("DEEPGRAM_API_KEY", ""))

    # MCP
    mcp_token: str = field(default_factory=lambda: os.environ.get("CRM_MCP_TOKEN", ""))

    # Agent Worker
    agent_bridge_secret: str = field(default_factory=lambda: os.environ.get("AGENT_BRIDGE_SECRET", ""))

    @property
    def is_postgres(self) -> bool:
        return bool(self.database_url)

    @property
    def has_gemini(self) -> bool:
        return bool(self.gemini_api_key)

    @property
    def has_deepgram(self) -> bool:
        return bool(self.deepgram_api_key)

    @property
    def has_hostinger(self) -> bool:
        return bool(self.hostinger_api_token)


settings = Settings()
