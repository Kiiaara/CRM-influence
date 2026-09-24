# CRM-influence - CLAUDE.md

## Status: PROD на VPS (crm-influence.kiiara.ru)
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
- `backend/models/blogger_profile.py` + `backend/blogger_sheet.py` - база блогеров и импорт из гугл-таблицы
  (все листы, лист = площадка = вкладка в CRM, колонки ищутся по ключевым словам в заголовке,
  вся строка листа хранится в `sheet_row` и показывается на вкладке как в таблице).
  Таблица подтягивается сама каждые `BLOGGERS_SYNC_MINUTES` (дефолт 30, 0 - только вручную).
  В CRM (и в боте) база блогеров только для чтения: таблица - единственный источник, синхронизация
  приводит базу к ней целиком (пропавшие строки/листы удаляются; пустая/нечитаемая таблица базу не трогает).
  Ссылку на таблицу меняют admin/editor на странице «База блогеров» или в боте
- `backend/bot_dialog.py` - бот: мастер /new_integration, категорийная правка карточки участника (e:...)
- `backend/bot_editor.py` - бот: универсальный редактор всего остального (x:...): сделки/КП, оплаты,
  кейсы, файлы ТЗ, рекламодатели/контакты, задачи, базы стримеров и блогеров, выбор пространства
- `backend/site_publisher.py` + `backend/routers/site.py` - публикация кейсов на сайт tkacheva-media
  (репо Kiiaara/site): кейсы с `show_on_site` из пространств, которыми владеет админ, -> `cases.json` +
  фото webp в `assets/images/crm/`, одним коммитом через GitHub API (SITE_GITHUB_TOKEN); сервер сайта сам
  тянет с GitHub, index.html подгружает cases.json к ручным кейсам
- `backend/case_translate.py` - автоперевод кейса на EN/ZH через Groq (GROQ_API_KEY, бесплатный тариф;
  модель - GROQ_MODEL). Платные LLM API для перевода не используем - дорого
- `backend/routers/integrations.py` - CRUD + договор (upload/download) + платежи
- `frontend/src/pages/IntegrationsBoard.tsx` - канбан-доска
- `frontend/src/pages/HomePage.tsx` - сводка (активные стримеры, к получению, дедлайны)
- `frontend/src/api/integrations.ts` - API-клиент, стадии, лейблы

## Участник сделки
`IntegrationStreamer.talent_type`: `streamer` | `blogger` - из какой базы добавлен (стримеров или блогеров).
У сделки (`Integration.kp_sheet_url`) - ссылка на гугл-таблицу с расчётом КП.

## Бот
Команды: /menu (всё), /new_integration, /edit_integration, /deals, /advertisers, /tasks, /cases,
/streamers, /bloggers, /workspace, /hot_tasks, /settings, /cancel. Новая сущность в боте = описать
`Entity` в `bot_editor.py` (поля, list_query, create, права) - списки/карточки/ввод общие.

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

## Прод (VPS 157.22.207.137, Ubuntu 24.04)
- Код: `/opt/crm-influence` (git, ветка main), systemd-сервис `crm-influence`:
  `backend/.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8010`, WorkingDirectory `backend`
- nginx `crm-influence.kiiara.ru`: статика из `frontend/dist`, `/api/` -> 127.0.0.1:8010
- Настройки: `/opt/crm-influence/backend/.env` (в git не входит)
- Обновление:
  ```
  cd /opt/crm-influence && git pull origin main
  backend/.venv/bin/pip install -r backend/requirements.txt
  cd frontend && npm ci && npm run build; cd ..
  systemctl restart crm-influence
  ```
- Сайт tkacheva-media.ru на том же сервере, сам тянет репо Kiiaara/site с GitHub

## Settings
- `backend/.env`: `DEV_AUTH_BYPASS=true` для входа без Telegram в локальной разработке
- `backend/data/zametochnitsa.db` - SQLite (имя файла унаследовано от старого проекта-заметочницы)
- `backend/data/contracts/` - загруженные файлы договоров (в .gitignore)

## Известные долги
- Папка проекта на диске всё ещё называется `zametochnitsa` (историческое название) -
  переименовать в `crm-influence`, когда освободится (сейчас держится открытым редактором/процессом)
