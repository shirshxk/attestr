"""
config.py — central settings for Attestr.
All values come from environment variables (set in docker-compose).
"""
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Environment
    attestr_env: str = "development"

    # Database
    database_url: str = "sqlite:////app/data/attestr.db"

    # CA keystore
    ca_keystore_path: str = "/app/data/ca_keystore.json"
    ca_passphrase: str = "dev-passphrase-change-in-production"

    # JWT (used only for session tokens, not for any cryptographic operation)
    jwt_secret: str = "dev-jwt-secret-change-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 8  # 8 hours

    # Email (Mailhog for local dev)
    smtp_host: str = "mailhog"
    smtp_port: int = 1025
    smtp_from: str = "attestr@localhost"

    # Certificate settings
    cert_validity_days: int = 365
    cert_renewal_warning_days: int = 30

    # Argon2id keystore parameters
    argon2_memory_cost: int = 65536   # 64 MB
    argon2_time_cost: int = 3
    argon2_parallelism: int = 4

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


# Default values that must NOT survive into production.
_INSECURE_DEFAULTS = {
    "ca_passphrase": "dev-passphrase-change-in-production",
    "jwt_secret":    "dev-jwt-secret-change-in-production",
}


def validate_production_secrets(s: "Settings") -> None:
    """
    Refuse to run in production with shipped default secrets. Called at startup.
    In development/test these defaults are allowed so the demo just works.
    """
    if s.attestr_env != "production":
        return
    problems = []
    for field, default in _INSECURE_DEFAULTS.items():
        value = getattr(s, field, None)
        if not value or value == default:
            problems.append(field)
        elif len(value) < 16:
            problems.append(f"{field} (too short, need ≥16 chars)")
    if problems:
        raise RuntimeError(
            "Refusing to start in production with insecure secrets: "
            + ", ".join(problems)
            + ". Set strong values via environment variables "
            "(CA_PASSPHRASE, JWT_SECRET)."
        )


# Single shared instance imported everywhere
settings = Settings()
