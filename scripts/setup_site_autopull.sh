#!/usr/bin/env bash
# Автообновление сайта tkacheva-media.ru из гита.
#
# Зачем: CRM публикует кейсы коммитом в репозиторий сайта, но на сервере файлы
# не появляются, пока кто-то не сделает git pull руками. Таймер делает это сам,
# поэтому публиковать кейсы можно хоть с телефона, не заходя на сервер.
#
# Запуск (от root, один раз):
#   bash setup_site_autopull.sh
# Снести:
#   systemctl disable --now site-autopull.timer && rm /etc/systemd/system/site-autopull.*
set -euo pipefail

SITE_DIR="${SITE_DIR:-/var/www/tkacheva-media.ru}"
INTERVAL="${INTERVAL:-1min}"   # как часто проверять гит

echo "== проверяю каталог сайта =="
[ -d "$SITE_DIR/.git" ] || { echo "ОШИБКА: $SITE_DIR не git-репозиторий"; exit 1; }
cd "$SITE_DIR"

# Локальные правки на проде ломают pull, поэтому предупреждаем сразу
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "ВНИМАНИЕ: в $SITE_DIR есть незакоммиченные правки, pull может не пройти:"
    git status --short --untracked-files=no
    echo "Разберись с ними, иначе таймер будет молча падать."
fi

echo "== проверяю, что git тянет без пароля =="
# GIT_TERMINAL_PROMPT=0: если гит захочет логин, команда упадёт сразу, а не повиснет
if ! GIT_TERMINAL_PROMPT=0 timeout 60 git fetch --quiet origin 2>/dev/null; then
    echo "ОШИБКА: git fetch не прошёл без пароля."
    echo "Таймер работает без человека, поэтому нужен доступ без ввода пароля:"
    echo "  - ssh-ключ для git@github.com, либо"
    echo "  - токен в url: git remote set-url origin https://<TOKEN>@github.com/<repo>.git"
    exit 1
fi
echo "ок, доступ есть"

echo "== ставлю сервис и таймер =="
cat > /etc/systemd/system/site-autopull.service <<EOF
[Unit]
Description=Подтянуть свежие кейсы на сайт из гита
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$SITE_DIR
Environment=GIT_TERMINAL_PROMPT=0
# --ff-only: только перемотка вперёд. Если история разошлась, лучше упасть
# с понятной ошибкой, чем молча слить ветки на проде
ExecStart=/usr/bin/git pull --ff-only --quiet
EOF

cat > /etc/systemd/system/site-autopull.timer <<EOF
[Unit]
Description=Проверять гит на свежие кейсы каждые $INTERVAL

[Timer]
OnBootSec=2min
OnUnitActiveSec=$INTERVAL
# не копим пропущенные запуски, если сервер спал
Persistent=false

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now site-autopull.timer

echo
echo "== готово =="
systemctl list-timers site-autopull.timer --no-pager | head -3
echo
echo "Проверить вручную:   systemctl start site-autopull.service && git -C $SITE_DIR log --oneline -1"
echo "Посмотреть логи:     journalctl -u site-autopull.service -n 20 --no-pager"
echo "Выключить:           systemctl disable --now site-autopull.timer"
