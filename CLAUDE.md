# CRM-influence - CLAUDE.md

## Status: DEV (локально, деплой на VPS не настроен)
CRM для инфлюенс-менеджмента: сделки с брендами, пул стримеров внутри каждой сделки
(свои сроки/сумма/статус/договор/оплаты у каждого), канбан по стадиям, авторасчёт
комиссии и суммы на руки стримеру.

## Stack
- Backend: Python 3.11, FastAPI, SQLAlchemy, SQLite
- Frontend: React 19, TypeScript, Vite, TanStack Query, Tailwind
- Auth: Telegram Login Widget (или DEV_AUTH_BYPASS=true для локальной разработки)

## Key Files
- `backend/models/integration.py` - сделка с брендом (Integration)
- `backend/models/integration_streamer.py` - стример внутри сделки (стадия/сумма/договор)
- `backend/models/integration_payment.py` - история оплат стримера
- `backend/routers/integrations.py` - CRUD + договор (upload/download) + платежи
- `frontend/src/pages/IntegrationsBoard.tsx` - канбан-доска
- `frontend/src/pages/HomePage.tsx` - сводка (активные стримеры, к получению, дедлайны)
- `frontend/src/api/integrations.ts` - API-клиент, стадии, лейблы

## Стадии стримера (канбан)
На согласовании → Согласован → Ждёт договора → Ждёт оплаты → Завершено (+ Отменено)

## Расчёт (на каждого стримера)
```
комиссия (моя) = сумма * commission_percent / 100     # дефолт 15%
налог стримера = сумма * streamer_tax_percent / 100    # дефолт 6%
стримеру на руки = сумма - комиссия - налог
```

## Dev

```bash
# backend
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn main:app --reload --host 127.0.0.1 --port 8000

# frontend
cd frontend
npm run dev -- --host 127.0.0.1 --port 5173
```

## Settings
- `backend/.env`: `DEV_AUTH_BYPASS=true` для входа без Telegram в локальной разработке
- `backend/data/zametochnitsa.db` - SQLite (имя файла унаследовано от старого проекта-заметочницы)
- `backend/data/contracts/` - загруженные файлы договоров (в .gitignore)

## Известные долги
- Папка проекта на диске всё ещё называется `zametochnitsa` (историческое название) -
  переименовать в `crm-influence`, когда освободится (сейчас держится открытым редактором/процессом)
- Деплой на VPS/поддомен не настроен
