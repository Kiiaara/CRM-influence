# Бриф: внутренний Notion-like сервис ("Заметочница")

> Это ТЗ для разработки с помощью Claude (Claude Code). Закинь весь файл в Claude и скажи: "построй мне этот сервис по этому брифу, поэтапно". Внутри - стек, архитектура, модель данных и грабли, на которые мы уже наступили (чтобы ты не повторял).

## Что это

Внутренний инструмент для команды - база знаний + лёгкая CRM без громоздкости настоящих CRM. По сути урезанный Notion для своих:
- страницы с текстом (документы)
- таблицы как в Notion databases (типизированные колонки)
- шаблоны страниц и таблиц
- глобальный поиск
- дашборды с виджетами (KPI, графики, мини-таблицы)
- календарь задач
- Telegram-уведомления по задачам
- доступ с ролями (админ/редактор/читатель)

Хостинг - VPS.

## Стек (проверен, не меняй без причины)

**Backend:**
- Python (рабочая версия была 3.14 - см. грабли ниже)
- FastAPI
- SQLAlchemy 2.0
- SQLite в режиме WAL (с прагмами `foreign_keys=ON`)
- Pydantic 2.x + pydantic-settings (конфиг из .env)
- APScheduler (async) - планировщик напоминаний
- httpx - прямые запросы к Telegram Bot API (без aiogram, проще)

**Frontend:**
- React 18 + Vite + TypeScript
- Tailwind CSS v4 (через плагин `@tailwindcss/vite`, не postcss)
- TanStack Query - запросы и кэш
- React Router
- TipTap (StarterKit) - редактор страниц
- Recharts - графики
- react-grid-layout v2.x - сетка дашбордов (ВАЖНО: в v2 нет `WidthProvider`, используй `ResponsiveGridLayout` напрямую)
- FullCalendar (плагины dayGrid / timeGrid / interaction) - календарь задач
- dayjs - даты

**Палитра:** синий акцент (`#3B82F6` / `#1E40AF`), светлая тема + тёмная (toggle через класс `.dark` на `html`).

## Структура проекта

```
zametochnitsa/
  backend/
    main.py          # точка входа, lifespan, CORS, auth middleware, ALTER TABLE миграции, старт scheduler
    config.py        # Pydantic settings из .env
    database.py      # SQLAlchemy engine, SQLite WAL, авто-создание data/
    deps.py          # get_current_user, require_role(role) фабрика
    notifier.py      # send_message(chat_id, text) через Bot API
    scheduler.py     # APScheduler джобы: дедлайны, назначения, long-polling /start
    models/          # ORM: user, auth_session, workspace, page, database(table), row, template, dashboard, widget, task
    routers/         # auth, users, pages, databases, rows, templates, search, dashboards, tasks, csv_import
    start-backend.ps1
  frontend/
    src/
      api/           # TanStack Query клиенты (client, pages, databases, dashboards, tasks, auth, templates)
      pages/         # HomePage, WorkspacePage, PageEditor, DatabaseView, DatabasesListPage, PagesListPage,
                     # DashboardView, DashboardsListPage, CalendarPage, TemplatesPage, AdminUsersPage, LoginPage
      components/     # PageTree, TopSearch, widgets/*
      theme.ts       # useTheme hook
    vite.config.ts
  .env.example
  .gitignore
  README.md
```

## Модель данных

- `User(tg_id PK, role[admin|editor|viewer], label, pinned_pages[JSON-массив id], created_at)`
- `AuthSession(token PK, user_tg_id FK, expires_at)`
- `Workspace(id, title)` - пока один, но архитектурно готов к нескольким
- `Page(id, workspace_id, parent_page_id nullable, title, icon, content_json, content_text, updated_at, created_by)` - `content_text` это выжимка текста из TipTap-JSON для поиска
- `DbTable(id, workspace_id, title, icon, columns_json)` - `columns_json`: `[{key, name, type: text|number|date|select|checkbox, options?}]`
- `Row(id, db_table_id, values_json, values_text, created_at, updated_at)`
- `Template(id, kind: page|db_table, title, icon, payload_json)`
- `Dashboard(id, workspace_id, title, icon, layout_json)` - `layout_json`: массив `{i, x, y, w, h}`
- `Widget(id, dashboard_id, type: kpi|line|bar|pie|table|tasks_upcoming, source_db_table_id, config_json)`
- `Task(id, workspace_id, title, description, due_at, status[todo|doing|done], assignee_tg_id, created_by_tg_id, page_id nullable, notified_assigned bool, notified_deadline bool, created_at)`

Флаги `notified_*` чтобы не слать одно и то же дважды.

## Ключевые механики

1. **Шаблоны** - кнопка "Из шаблона" подставляет `payload_json` в новую страницу/таблицу. Любую страницу можно сохранить в шаблоны.
2. **Графики из таблиц** - виджет ссылается на таблицу, в `config_json` указано какие колонки на осях и тип агрегации (sum/avg/count). Агрегацию делает бэк, фронт только рисует Recharts.
3. **Дашборды** - react-grid-layout, виджеты таскаются и ресайзятся. Типы: KPI (число), линейный/столбчатый/круговой график, мини-таблица топ-N, "ближайшие задачи".
4. **Календарь** - FullCalendar, виды месяц/неделя/день, создание задачи кликом по дню, drag-n-drop переносит дедлайн.
5. **Telegram-уведомления:**
   - При создании задачи с `assignee_tg_id` сразу шлём "Тебе поставили задачу: ... Дедлайн: ... Открыть: ...", ставим `notified_assigned=true`.
   - APScheduler раз в минуту берёт задачи где `due_at - now <= 30 мин`, `notified_deadline=false`, `status != done` - шлёт "Скоро дедлайн", ставит флаг.
   - Перенос задачи на новый день сбрасывает `notified_deadline=false`.
   - Уведомления приходят только если юзер написал боту `/start` (так бот узнаёт chat_id). Long-polling джоба ловит `/start` и фиксирует chat_id. Кто не написал - показываем в UI плашку "напиши боту /start".
6. **Роли** - `require_role("admin")` для управления юзерами и удаления, `editor` пишет, `viewer` только GET (на фронте кнопки прячем, на бэке возвращаем 403).
7. **Поиск** - глобальный, по `Page.content_text` и `Row.values_text`. Можно через FTS5, мы сделали проще - LIKE (для команды из 5-10 человек хватает с головой). Вынесен в топ-бар, автокомплит с debounce, Ctrl+K, навигация стрелками.
8. **Иерархия страниц** - дерево в сайдбаре через `parent_page_id`, сворачивается/разворачивается. Закреплённые страницы выводятся на главной.
9. **Импорт CSV** - парсим заголовки в колонки, угадываем типы, строки в rows, создаём новую таблицу.

## Авторизация

Telegram Login Widget + HMAC-SHA256 валидация + cookie-сессия + whitelist по tg_id. Первый юзер из `.env` (`AUTH_ALLOWED_TG_IDS`) автоматом становится админом.

**ВАЖНАЯ ГРАБЛЯ:** Telegram Login Widget НЕ работает на localhost и на нестандартных портах. Ему нужен реальный домен на портах 80/443 (из-за CSP `frame-ancestors`). Для локальной разработки сделай флаг `DEV_AUTH_BYPASS=true` в .env - в этом режиме бэк создаёт фейкового dev-юзера и пропускает без авторизации. На проде ставь `false` и нормальный домен с SSL.

## .env (backend)

```
AUTH_BOT_TOKEN=токен_бота_от_BotFather
AUTH_BOT_USERNAME=имя_бота_без_@
AUTH_ALLOWED_TG_IDS=твой_tg_id        # первый = админ, через запятую можно несколько
SESSION_SECRET=случайная_строка_base64
DEV_AUTH_BYPASS=true                   # на проде false
```

## Грабли, на которые мы наступили (не повторяй)

1. **pydantic-core не собирался на Python 3.14** - не пинуй версии жёстко в requirements.txt, ставь `>=` диапазоны, пусть подтянет совместимые колёса.
2. **Vite не открывался на localhost** - забинди явно: `host: '0.0.0.0'`, `strictPort: true`, и пропиши `allowedHosts`. Заходи через `127.0.0.1:5173`, не `localhost`.
3. **Telegram Widget "Bot domain invalid" / CSP frame-ancestors** - см. блок про авторизацию выше. Для локалки только bypass.
4. **Vite: `does not provide export named 'Column'`** - интерфейсы импортируй через `import type { Column } from ...`, отдельно от рантайм-импортов. Иначе Vite ругается.
5. **`WidthProvider is not a function`** - react-grid-layout v2 убрал WidthProvider, используй `ResponsiveGridLayout` напрямую.
6. **Кириллица в PowerShell** показывается криво, но в самом приложении всё ок - не путай вывод консоли с реальной проблемой.
7. Бэк делает `ALTER TABLE` миграции прямо в `lifespan` при старте (например добавление колонки `pinned_pages`) - простой способ мигрировать SQLite без alembic для маленького проекта.

## Порядок разработки (этапы)

1. `git init`, структура папок, `.gitignore` (`.venv`, `*.db`, `.env`, `node_modules`, `dist`), `.env.example`.
2. Backend skeleton: FastAPI, БД, модели User/AuthSession, auth-роутер, middleware.
3. Frontend skeleton: Vite + React + TS + Tailwind + роутер, LoginPage, WorkspacePage с сайдбаром.
4. Страницы + редактор TipTap, CRUD.
5. Таблицы + строки (типизированные колонки, инлайн-редактирование, добавление/удаление колонок).
6. Шаблоны (CRUD + "применить").
7. Поиск (LIKE по content_text / values_text).
8. Дашборды + виджеты (Recharts + react-grid-layout).
9. Календарь задач (FullCalendar + CRUD + виджет "ближайшие задачи").
10. Telegram-уведомления (notifier + long-polling /start + APScheduler джоба на дедлайны).
11. Импорт CSV.
12. Роли и админка пользователей.
13. README.

## Как проверять (чек-лист)

- Бэк поднимается на :8000, фронт `npm run dev` на :5173.
- Создаёшь страницу, редактируешь, перезагрузка сохраняет.
- Делаешь страницу дочерней - в сайдбаре складывается в дерево. Закрепляешь - появляется на главной.
- Таблица с колонками `дата(date)`, `просмотры(number)`, `канал(select)`, набиваешь 5-10 строк.
- Дашборд: линейный график по таблице (X=дата, Y=sum(просмотры)) рисуется. KPI "всего просмотров" совпадает с суммой колонки.
- Поиск находит слово из таблицы и со страницы.
- Календарь: задача на завтра, перетащил на послезавтра - сохранилось.
- Задача на коллегу с дедлайном через 35 мин - коллеге в TG приходит "поставили задачу", через 5 мин "скоро дедлайн". Закрыл задачу - больше ничего.
- Второй TG-аккаунт (viewer) видит дашборд, но не редактирует (кнопки скрыты, API 403).
```
