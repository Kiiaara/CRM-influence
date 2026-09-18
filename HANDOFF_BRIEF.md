# Заметочница - бриф для разработки похожего сервиса

Это выжимка по проекту, который уже собран и работает. Цель документа - чтобы другой человек (или его Claude) мог поднять такой же сервис с нуля, не наступая на грабли, на которые мы уже наступили.

## Что это за сервис

Внутренний инструмент для команды - что-то среднее между Notion и лёгкой CRM. Без громоздкости больших CRM. Команда небольшая, хостится на одном VPS.

Что внутри:
- Страницы с текстом и форматированием (как документы в Notion), складываются в дерево родитель-потомок
- Таблицы с типизированными колонками (текст, число, дата, выбор из списка, чекбокс) - аналог Notion databases
- Шаблоны для страниц и таблиц
- Глобальный поиск по страницам и таблицам
- Дашборды с виджетами: KPI-карточки, линейные/столбчатые/круговые графики, мини-таблицы, ближайшие задачи. Виджеты тащатся и ресайзятся мышкой
- Календарь задач, задачи можно ставить кликом по дню и перетаскивать
- Уведомления в Telegram: "тебе поставили задачу" + "скоро дедлайн" (за 30 минут)
- Импорт CSV в таблицы
- Роли: админ / редактор / читатель
- Тёмная тема
- Закрепление страниц на главной

## Стек

Брали проверенный, не экспериментировали:

Backend
- FastAPI
- SQLAlchemy 2.0
- SQLite (с режимом WAL - меньше блокировок при записи)
- Pydantic 2.x + pydantic-settings (конфиг из .env)
- APScheduler - фоновые задачи (проверка дедлайнов, опрос бота)
- httpx - дёргать Telegram Bot API

Frontend
- React 18 + Vite + TypeScript
- Tailwind v4 (через плагин `@tailwindcss/vite`, не postcss)
- TanStack Query - запросы к бэку и кэш
- TipTap (StarterKit) - редактор страниц
- Recharts - графики
- react-grid-layout - перетаскиваемая сетка дашборда
- FullCalendar - календарь
- axios - http-клиент

Тема: синий акцент (#3B82F6 / #1E40AF), светлый фон, тёмная тема опционально.

## Модель данных

- User (tg_id, role [admin|editor|viewer], label, pinned_pages - JSON-массив id закреплённых страниц)
- AuthSession (token, user_tg_id, expires_at) - сессия в куке
- Workspace - верхний контейнер, пока один, но архитектура готова к нескольким
- Page (parent_page_id для дерева, title, content_json от TipTap, content_text для поиска)
- DbTable (title, columns_json - массив {key, name, type, options?})
- Row (db_id, values_json, values_text для поиска)
- Template (kind [page|db_table], payload_json)
- Dashboard (layout_json - массив виджетов с координатами сетки)
- Widget (type [kpi|line|bar|pie|table|tasks_upcoming], source_db_id, config_json - какие колонки, какая агрегация sum/avg/count)
- Task (title, due_at, status [todo|doing|done], assignee_tg_id, page_id, notified_assigned, notified_deadline)

Поиск сделали через LIKE по колонкам content_text и values_text (не FTS5). Для маленькой команды этого хватает за глаза, FTS5 - оверкилл.

Флаги notified_assigned / notified_deadline на задаче - чтобы не слать одно и то же дважды. При смене даты задачи notified_deadline сбрасывается, при смене исполнителя - notified_assigned.

## Авторизация через Telegram

Тут главные грабли, читай внимательно.

Используется Telegram Login Widget с проверкой подписи (HMAC-SHA256 по данным от телеги + токен бота). Логика проверки стандартная, её можно взять из любого гайда по TG Login Widget.

ВАЖНО, на чём мы залипли надолго:
- Telegram Login Widget НЕ работает на localhost и на нестандартных портах. Виджету нужен реальный домен и порты 80/443. Из-за CSP (frame-ancestors) кнопка либо не появляется, либо выдаёт "Bot domain invalid".
- В @BotFather домен задаётся через `/setdomain` - БЕЗ https://, БЕЗ порта, просто `example.com`.
- Поэтому для локальной разработки мы сделали режим DEV_AUTH_BYPASS: при `DEV_AUTH_BYPASS=true` бэк подставляет фиктивного юзера-админа, фронт пропускает экран логина (константа `DEV_BYPASS` в App.tsx). На проде ставишь оба в false.

Не пытайся завести TG Login Widget локально, это тупик. Разрабатывай с байпасом, авторизацию проверяй уже на задеплоенном домене с https.

## Telegram-уведомления

- Отдельный бот (можно тот же, что для логина). Токен в .env.
- Чтобы бот мог писать юзеру в личку, юзер должен сам нажать /start. До этого chat_id неизвестен. Поэтому scheduler делает long-polling getUpdates каждые пару секунд и ловит /start, фиксирует chat_id. В UI стоит показывать плашку "напиши боту /start, чтобы получать уведомления", пока chat_id не пойман.
- Три фоновые джобы в APScheduler: проверка дедлайнов (раз в минуту), отправка уведомлений о назначении (раз в 30 сек), опрос телеги (раз в 2 сек).

## Грабли и решения (самое ценное)

1. **Python 3.13+/3.14 и pydantic-core**: на свежем питоне колёса pydantic-core могут не собираться из-за пинов версий. Решение: в requirements.txt не пинить версии жёстко, ставить `>=`.

2. **Vite не открывается по localhost / connection refused**: на Windows бывает залипает на IPv6. Лечится в vite.config.ts: `host: '0.0.0.0'`, `strictPort: true`, и заходить по `127.0.0.1:5173`, а не `localhost`.

3. **Vite "Blocked request. This host is not allowed"**: добавить хосты в `server.allowedHosts` в vite.config.ts.

4. **Tailwind v4**: не через postcss, а через плагин `@tailwindcss/vite`. В css `@import "tailwindcss"` и `@variant dark` для тёмной темы. Синтаксис заметно отличается от v3.

5. **react-grid-layout v2.x**: убрали `WidthProvider` (в v1 он был). В v2 импортируешь `ResponsiveGridLayout` напрямую и используешь его. Если найдёшь гайд с WidthProvider - он устарел.

6. **TypeScript: "does not provide export named 'X'"**: интерфейсы и типы импортировать через `import type { Foo }`, а не обычным import. Иначе Vite ругается, потому что типы стираются на этапе сборки. Раздельно: `import { dbApi } from '...'` и `import type { Column } from '...'`.

7. **Миграции SQLite**: новые колонки добавляли простым `ALTER TABLE` прямо в lifespan-хуке при старте бэка (проверяя через PRAGMA, есть ли колонка). Для маленького проекта Alembic не тянули.

## Деплой на VPS (коротко)

1. Домен + nginx + сертификат Let's Encrypt.
2. В @BotFather `/setdomain` → твой домен (без протокола и порта).
3. В .env: `PUBLIC_URL=https://домен`, `FRONTEND_ORIGIN=https://домен`, `DEV_AUTH_BYPASS=false`. В App.tsx `DEV_BYPASS = false`.
4. `npm run build` фронта, `dist/` отдавать через nginx, `/api/*` проксировать на uvicorn.
5. uvicorn под systemd: `uvicorn main:app --host 127.0.0.1 --port 8000`.

## Что бы я сделала иначе / на что заложить время

- Сразу разрабатывай с DEV_AUTH_BYPASS, не трать день на попытки завести TG-логин на localhost.
- Tailwind v4 и react-grid-layout v2 - свежие, гайдов под старые версии в сети больше, легко скопировать устаревший код. Сверяйся с версией.
- Поиск через LIKE - норм для старта, не усложняй FTS5, пока команда маленькая.
- Закладывай флаги "уже уведомили" на любые автосообщения сразу, иначе словишь спам.
