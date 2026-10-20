# CRM-influence - CLAUDE.md

## Status: LIVE (crm-influence.kiiara.ru, FirstVDS, /opt/crm-influence)
CRM для инфлюенс-менеджмента: сделки с брендами, пул инфлюенсеров внутри каждой сделки
(свои сроки/сумма/статус/договор/оплаты у каждого), канбан по стадиям, авторасчёт
комиссии и суммы на руки инфлюенсеру.

## Stack
- Backend: Python 3.11, FastAPI, SQLAlchemy, SQLite
- Frontend: React 19, TypeScript, Vite, TanStack Query, Tailwind
- Auth: Telegram Login Widget (или DEV_AUTH_BYPASS=true для локальной разработки)

## Key Files
- `backend/models/integration.py` - сделка с брендом (Integration)
- `backend/models/integration_streamer.py` - инфлюенсер внутри сделки (стадия/сумма/договор);
  имя файла, таблицы и полей историческое, в интерфейсе везде "инфлюенсер"
- `backend/models/integration_payment.py` - история оплат инфлюенсера
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
- `backend/case_translate.py` - автоперевод кейса на EN/ZH, четыре провайдера, выбор `TRANSLATE_PROVIDER`
  (auto: DeepL при `DEEPL_API_KEY` -> Google -> MyMemory -> Groq при `GROQ_API_KEY`; упал один - берётся
  следующий, в предупреждении публикации видно кто перевёл). Основной на проде Google: публичный эндпоинт
  без ключа и карты (неофициальный, может отвалиться), построчно, ссылки/ники/erid прячутся за заглушки.
  MyMemory запасной (5000 симв/день, `MYMEMORY_EMAIL` поднимает до 50000). DeepL (`:fx` ходит на api-free)
  и Groq (GROQ_API_KEY, GROQ_MODEL) в коде остались, но на сервере не используются: DeepL просит карту,
  Groq даёт 403 даже через Cloudflare Worker. Платные LLM API для перевода не используем - дорого.
- `frontend/src/utils/groqTranslate.ts` - перевод через Groq ПРЯМО ИЗ БРАУЗЕРА (у Groq открыт CORS,
  а IP сервера он блокирует). Качество выше машинного: в промпте объяснён контекст рекламы у блогеров
  и глоссарий терминов. Кнопка в разделе Кейсы, ключ живёт в localStorage браузера и на сервер
  не уходит никогда (конфиг сервера общий на все пространства). Название кейса не переводится нигде.
  При публикации на сайт кейсы без перевода переводятся сами (`site_publisher.translate_missing`,
  бюджет 40 сек); готовые переводы не трогаются, при сбое переводчика публикация идёт на русском
  с предупреждением, в котором назван провайдер.
  Контакты рекламодателя живут только в `BrandContact`; колонки `advertisers.contact_person/telegram/email/phone`
  в старых базах остались мёртвым грузом, код их не читает
- `backend/routers/campaigns.py` - кампании; блогеры кампании = стримеры в сделке с `Integration.campaign_id` (GET/POST `/campaigns/{id}/bloggers`), та же запись, что на канбане. В меню канбан скрыт, открывается по `/integrations`
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
инфлюенсеру на руки = сумма - комиссия - налог
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

## Deploy (FirstVDS, crm-influence.kiiara.ru)

Докера нет. Бэкенд - systemd-юнит `crm-influence.service` (uvicorn на 127.0.0.1:8010,
WorkingDirectory `/opt/crm-influence/backend`). Фронт - статика, nginx раздаёт
`/opt/crm-influence/frontend/dist`, `/api/` проксирует на 8010.

```bash
# 1. бэкап базы. SQLite в режиме WAL, просто cp файла .db теряет свежие записи
cd /opt/crm-influence/backend
.venv/bin/python -c "
import sqlite3, datetime
dst = 'data/zametochnitsa.db.bak-' + datetime.datetime.now().strftime('%Y%m%d-%H%M')
src = sqlite3.connect('data/zametochnitsa.db'); out = sqlite3.connect(dst)
src.backup(out); out.close(); src.close(); print(dst)
"

# 2. код
cd /opt/crm-influence && git pull

# 3. фронт (без пересборки морда остаётся старой)
cd frontend && npm ci && npm run build

# 4. бэк. Миграции прогоняются на старте в lifespan
systemctl restart crm-influence
journalctl -u crm-influence -n 60 --no-pager
```

Откат, если миграция упала:

```bash
systemctl stop crm-influence
cd /opt/crm-influence/backend
rm -f data/zametochnitsa.db-wal data/zametochnitsa.db-shm
cp data/zametochnitsa.db.bak-ГГГГММДД-ЧЧММ data/zametochnitsa.db
systemctl start crm-influence
```

## Известные долги
- Папка проекта на диске всё ещё называется `zametochnitsa` (историческое название) -
  переименовать в `crm-influence`, когда освободится (сейчас держится открытым редактором/процессом)
- `npm audit` на фронте: 38 уязвимостей (11 high). `npm audit fix` вслепую ломает мажорные
  версии, разбирать отдельно
