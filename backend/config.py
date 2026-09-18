from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # БД
    database_url: str = "sqlite:///./data/zametochnitsa.db"

    # Telegram
    auth_bot_token: str = ""          # токен бота для Login Widget + отправки уведомлений
    auth_bot_username: str = ""       # @username бота (без @) - для Login Widget на фронте
    auth_allowed_tg_ids: str = ""     # через запятую: "12345,67890" - попадают в whitelist как admin при первом старте

    # Сессии
    session_secret: str = "change-me"  # сейчас не используется (cookie - random token), но оставлено на будущее
    session_ttl_days: int = 30

    # Сеть
    frontend_origin: str = "http://localhost:5173"  # CORS
    public_url: str = "http://localhost:5173"        # для ссылок в TG-уведомлениях

    # Планировщик
    scheduler_interval_seconds: int = 60

    # Dev-режим без TG-логина: бэк подставляет фиктивного юзера-админа
    dev_auth_bypass: bool = False

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()
