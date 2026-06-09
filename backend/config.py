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


# Single shared instance imported everywhere
settings = Settings()
