#!/usr/bin/env bash
# Проверка здоровья CRM-influence на сервере. Только читает, ничего не меняет.
# Запуск: ssh <сервер> 'bash -s' < scripts/check_crm_health.sh
# Необязательные переменные: SERVICE (юнит), URL (адрес сайта), WINDOW (окно логов).
SERVICE="${SERVICE:-crm-influence}"
URL="${URL:-https://crm-influence.kiiara.ru/}"
WINDOW="${WINDOW:-10 minutes ago}"
FAIL=0

echo "== 1. Статус systemd: $SERVICE"
STATE="$(systemctl is-active "$SERVICE")"
echo "is-active: $STATE"
[ "$STATE" = "active" ] || FAIL=1
systemctl show "$SERVICE" -p NRestarts -p ActiveEnterTimestamp

echo "== 2. Спам планировщика за '$WINDOW'"
# До фикса: ~30 строк в минуту. После фикса должно быть 0.
SPAM="$(journalctl -u "$SERVICE" --since "$WINDOW" --no-pager 2>/dev/null | grep -c 'maximum number of running instances')"
echo "строк 'maximum number of running instances': $SPAM"
[ "$SPAM" -eq 0 ] || FAIL=1

echo "== 3. Ошибки long polling за '$WINDOW'"
# Единичные предупреждения при проблемах с сетью допустимы, поток - нет (backoff до 60 с).
POLL_ERR="$(journalctl -u "$SERVICE" --since "$WINDOW" --no-pager 2>/dev/null | grep -c 'Ошибка getUpdates')"
echo "строк 'Ошибка getUpdates': $POLL_ERR"
journalctl -u "$SERVICE" --since "$WINDOW" --no-pager 2>/dev/null | grep -E 'long polling запущен|Scheduler started' | tail -n 3

echo "== 4. Ответ сайта: $URL"
CODE="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$URL")"
echo "HTTP: $CODE"
[ "$CODE" = "200" ] || FAIL=1

echo "== Итог"
if [ "$FAIL" -eq 0 ]; then echo "OK"; else echo "ПРОБЛЕМА (см. выше)"; fi
exit "$FAIL"
