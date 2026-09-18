# Промпт для Claude (копировать целиком)

Скопируй всё, что ниже линии, и закинь в Claude как первое сообщение. Дальше работаешь с ним по обычной схеме - он сначала составит план, ты подтверждаешь, он пишет.

---

Мне нужен внутренний инструмент для команды - что-то среднее между Notion и лёгкой CRM, без громоздкости больших CRM. Команда маленькая, хостить буду на одном VPS. Делаем итеративно: сначала план, потом по этапам.

Что должно быть внутри:
- Страницы с текстом и форматированием (редактор как в Notion), складываются в дерево родитель-потомок, можно закреплять на главной
- Таблицы с типизированными колонками (текст, число, дата, выбор из списка, чекбокс) - аналог Notion databases, с инлайн-редактированием
- Шаблоны для страниц и таблиц ("создать из шаблона")
- Глобальный поиск по страницам и таблицам с автокомплитом, в верхней панели, с горячей клавишей Ctrl+K
- Дашборды с виджетами: KPI-карточки, линейные/столбчатые/круговые графики по данным из таблиц, мини-таблицы, ближайшие задачи. Виджеты тащатся и ресайзятся мышкой. Агрегацию (sum/avg/count) считать на бэке
- Календарь задач: ставить задачи кликом по дню, перетаскивать для переноса, привязывать к странице
- Уведомления в Telegram: "тебе поставили задачу" сразу при назначении + "скоро дедлайн" за 30 минут. С флагами, чтобы не слать дважды
- Импорт CSV в таблицы (типы колонок угадывать)
- Роли: админ / редактор / читатель
- Тёмная тема
- Синий акцент в оформлении (#3B82F6)

Стек строго такой (он проверен, не предлагай альтернативы):
- Backend: FastAPI, SQLAlchemy 2.0, SQLite в режиме WAL, Pydantic 2.x + pydantic-settings, APScheduler, httpx
- Frontend: React 18 + Vite + TypeScript, Tailwind v4 (через плагин @tailwindcss/vite, НЕ postcss), TanStack Query, TipTap (StarterKit), Recharts, react-grid-layout v2, FullCalendar, axios

Авторизация через Telegram Login Widget с HMAC-проверкой. ВАЖНО: TG Login Widget не работает на localhost и нестандартных портах. Поэтому сразу заложи режим DEV_AUTH_BYPASS: при включённом флаге в .env бэк подставляет фиктивного юзера-админа, а фронт пропускает экран логина. Разрабатывать будем с байпасом, реальный логин проверим уже на задеплоенном домене с https. Не пытайся завести TG-логин локально.

Учти эти грабли заранее:
- В requirements.txt версии не пинить жёстко (ставь >=), иначе pydantic-core может не собраться на свежем питоне
- В vite.config.ts: host '0.0.0.0', strictPort true, и заходить по 127.0.0.1, а не localhost (Windows залипает на IPv6). Нужные хосты добавь в server.allowedHosts
- Tailwind v4: @import "tailwindcss" в css, @variant dark для тёмной темы
- react-grid-layout v2: WidthProvider больше нет, используй ResponsiveGridLayout напрямую
- TypeScript: интерфейсы импортировать через import type, отдельно от обычных импортов
- Миграции SQLite делать простым ALTER TABLE в lifespan при старте (проверяя PRAGMA), без Alembic

Telegram-уведомления: чтобы бот мог писать юзеру в личку, юзер должен сам нажать /start (до этого chat_id неизвестен). Сделай в scheduler long-polling getUpdates, чтобы ловить /start и фиксировать chat_id. В UI - плашка "напиши боту /start", пока chat_id не пойман.

Модель данных примерно такая:
- User (tg_id, role, label, pinned_pages - JSON-массив id)
- AuthSession (token, user_tg_id, expires_at)
- Workspace (один, но архитектурно готов к нескольким)
- Page (parent_page_id, title, content_json, content_text для поиска)
- DbTable (title, columns_json: [{key, name, type, options?}])
- Row (db_id, values_json, values_text для поиска)
- Template (kind, payload_json)
- Dashboard (layout_json)
- Widget (type, source_db_id, config_json)
- Task (title, due_at, status, assignee_tg_id, page_id, notified_assigned, notified_deadline)

Поиск делай через LIKE по content_text / values_text, FTS5 не нужен - команда маленькая.

Начни с плана: структура папок, этапы, модель данных. Покажи план, я подтвержу, дальше пойдём по этапам.
