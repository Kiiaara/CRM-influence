from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # БД
    database_url: str = "sqlite:///./data/zametochnitsa.db"

    # Telegram
    auth_bot_token: str = ""          # токен бота для Login Widget + отправки уведомлений
    auth_bot_username: str = ""       # @username бота (без @) - для Login Widget на фронте
    auth_allowed_tg_ids: str = ""     # через запятую: "12345,67890" - попадают в whitelist как admin при первом старте
    telegram_api_base: str = "https://api.telegram.org"  # можно указать URL Cloudflare Worker-прокси, если сеть до api.telegram.org нестабильна

    # VK ID (вход через VK)
    vk_app_id: str = ""          # ID приложения из vk.com/apps?act=manage
    vk_client_secret: str = ""   # Защищённый ключ приложения

    # Сессии
    session_secret: str = "change-me"  # сейчас не используется (cookie - random token), но оставлено на будущее
    session_ttl_days: int = 30
    cookie_secure: bool = False  # на проде с HTTPS ставим true

    # Сеть
    frontend_origin: str = "http://localhost:5173"  # CORS
    public_url: str = "http://localhost:5173"        # для ссылок в TG-уведомлениях

    # Планировщик
    scheduler_interval_seconds: int = 60
    # как часто подтягивать базу блогеров из гугл-таблицы (минуты, 0 - только вручную)
    bloggers_sync_minutes: int = 30

    # Публикация кейсов на сайт tkacheva-media: CRM коммитит cases.json + фото в репозиторий сайта,
    # сервер сайта сам забирает изменения с GitHub. Токен - fine-grained PAT с Contents: Read and write
    site_github_token: str = ""
    site_github_repo: str = "Kiiaara/site"
    site_github_branch: str = "main"
    site_url: str = "https://tkacheva-media.ru"

    # Автоперевод кейсов на EN/ZH через Claude API (если пусто - SDK ищет ключ в окружении)
    anthropic_api_key: str = ""

    # Dev-режим без TG-логина: бэк подставляет фиктивного юзера-админа
    dev_auth_bypass: bool = False

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()
