# Прокси для телеграм-бота через Cloudflare Workers

Сеть VPS иногда не может достучаться напрямую до `api.telegram.org`
(в логах видно `ConnectTimeout`). Без установки VPN на сервер решаем
через бесплатный Cloudflare Worker — он просто перекладывает запросы
дальше в Telegram.

## 1. Завести аккаунт Cloudflare

Если аккаунта ещё нет — зарегистрируйся на https://dash.cloudflare.com/sign-up
Домен подключать не нужно, Worker работает независимо.

## 2. Создать Worker

В дашборде: **Workers & Pages** → **Create** → **Create Worker**.
Дай любое имя, например `tg-proxy`, и нажми **Deploy** (создастся с
шаблонным кодом — его сейчас заменим).

## 3. Вставить код прокси

Открой **Edit code** и полностью замени содержимое на это:

```js
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = "https://api.telegram.org" + url.pathname + url.search;
    const init = {
      method: request.method,
      headers: request.headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(),
    };
    return fetch(target, init);
  },
};
```

Нажми **Deploy** ещё раз, чтобы применить новый код.

## 4. Скопировать адрес воркера

После деплоя Cloudflare покажет адрес вида:

```
https://tg-proxy.твой-логин.workers.dev
```

Именно этот URL (без слэша на конце) понадобится на следующем шаге.

## 5. Прописать на сервере

Открой `.env` бэкенда и добавь строку (или замени, если уже похожая есть):

```bash
cd /opt/crm-influence/backend
echo 'TELEGRAM_API_BASE=https://tg-proxy.твой-логин.workers.dev' >> .env
sudo systemctl restart crm-influence
```

Замени `твой-логин` на реальный адрес из шага 4 — иначе бот перестанет
отвечать вообще.

## 6. Проверить

Напиши боту `/start` в Telegram — если ответил и появилась клавиатура
с кнопками, прокси работает. Заодно глянь логи:

```bash
journalctl -u crm-influence -n 30 --no-pager | grep -i "telegram\|ConnectTimeout"
```

Если `ConnectTimeout` больше не появляется в свежих логах — готово.

---

Бесплатный тариф Cloudflare Workers — 100 000 запросов в день, для
одного бота более чем достаточно.
