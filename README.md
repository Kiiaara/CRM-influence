# CRM-influence

CRM для инфлюенс-менеджмента: сделки с брендами (со ссылкой на расчёт КП), пул стримеров и
блогеров внутри каждой сделки (свои сроки/сумма/статус/договор/оплаты у каждого), канбан по
стадиям, авторасчёт комиссии и суммы на руки, базы стримеров и блогеров (блогеры подтягиваются
из гугл-таблицы), поиск, календарь задач с TG-уведомлениями, Telegram-бот, в котором можно
править всё то же, что на сайте (/menu).

## Стек

- Backend: FastAPI + SQLAlchemy + SQLite, APScheduler, httpx
- Frontend: React + Vite + TypeScript, Tailwind v4, TanStack Query, TipTap, Recharts, react-grid-layout, FullCalendar

## Локальный запуск

### Бэк

```
cd backend
.\start-backend.ps1
```

Слушает на http://127.0.0.1:8000. При первом старте создаст `data/zametochnitsa.db` и поднимет миграции.

### Фронт

```
cd frontend
.\start-frontend.ps1
```

Откроется на http://127.0.0.1:5173.

## Конфиг (backend/.env)

```
AUTH_BOT_TOKEN=         # токен TG-бота от @BotFather
AUTH_BOT_USERNAME=      # username бота без @
AUTH_ALLOWED_TG_IDS=    # через запятую: TG-ID первых админов
SESSION_SECRET=         # любая длинная строка
DATABASE_URL=sqlite:///./data/zametochnitsa.db
FRONTEND_ORIGIN=http://localhost:5173
PUBLIC_URL=http://localhost:5173
SCHEDULER_INTERVAL_SECONDS=60
DEV_AUTH_BYPASS=true    # вход без авторизации (для локалки)
```

В режиме `DEV_AUTH_BYPASS=true` фронт пропускает логин, бэк подставляет фиктивного юзера-админа. Для прода поставить `false` и одновременно в `frontend/src/App.tsx` поменять `DEV_BYPASS = false`.

## Структура

```
backend/
  models/         ORM (User, Integration, IntegrationStreamer, IntegrationPayment, Task...)
  routers/        FastAPI роуты
  notifier.py     отправка в TG
  scheduler.py    APScheduler + long-polling /start
frontend/
  src/api/        axios-клиенты под каждый ресурс
  src/pages/      React-страницы (IntegrationsBoard - канбан, HomePage - сводка)
```

## Деплой на VPS

1. Поставить домен + nginx + сертификат (Let's Encrypt).
2. Включить TG Login Widget: в @BotFather `/setdomain` → указать домен (без https://, без порта).
3. В `.env` выставить `PUBLIC_URL=https://твой-домен`, `FRONTEND_ORIGIN=https://твой-домен`, `DEV_AUTH_BYPASS=false`.
4. Сбилдить фронт (`npm run build` в `frontend`) и отдавать `dist/` через nginx, проксируя `/api/*` на бэк-uvicorn.
5. uvicorn под systemd: `uvicorn main:app --host 127.0.0.1 --port 8000`.
