#!/usr/bin/env bash
# Доска задач проекта в GitHub: метки, веха, issues из плана (раздел 11.1 документации) и GitHub Project.
# Нужны: gh (авторизован со scope project) и jq. Запуск из корня репозитория: scripts/github_board.sh
set -euo pipefail
REPO=mortira919/AituObxodnylist
TITLE="Обходной лист"
MILESTONE="Сдача 05.11.2026"

for l in "crit-1:Анализ проекта и бизнес-процессов" "crit-2:Требования" "crit-3:Техническая документация" \
         "crit-4:Реализация" "crit-5:Тестирование" "crit-6:Командная работа" \
         "Must:MoSCoW" "Should:MoSCoW" "change-request:Запрос на изменение требований"; do
  gh label create "${l%%:*}" --repo "$REPO" --description "${l#*:}" --force >/dev/null
done
gh api "repos/$REPO/milestones" -f title="$MILESTONE" -f due_on="2026-11-05T23:59:59Z" >/dev/null 2>&1 || true

# номер|задача|ответственный|зависит от|срок|статус|метки
TASKS=$(cat <<'T'
1|Анализ процесса: проблема, AS-IS, TO-BE, стейкхолдеры, SMART|Зарина|—|25.10|Done|crit-1,Must
2|Сбор требований: интервью с библиотекой, бухгалтерией, учебной частью, анализ бланка|Зарина|1|27.10|Done|crit-2,Must
3|Требования FR/NFR, MoSCoW, критерии приёмки, MVP|Зарина|2|28.10|Done|crit-2,Must
4|Контракт API (openapi.yaml, API.md) и бизнес-правила R1–R20|Азиз, Алтынжан|3|29.10|Done|crit-3,Must
5|Дизайн-система и бренд AITU|Команда|3|29.10|Done|crit-4,Should
6|Фронтенд: кабинеты студента, отдела, учебной части, проверка по QR, RU/KZ|Команда|4, 5|02.11|Done|crit-4,Must
7|Бэкенд: схема БД, миграции, сессии, права, отметки, импорт, Telegram|Алтынжан|4|03.11|Done|crit-4,Must
8|Защита данных: Argon2id, rate limit, CSRF, заголовки, формат ошибок|Алтынжан|7|03.11|Done|crit-3,Must
9|Техописание одним файлом, схема системы, схема БД|Азиз|4, 7|04.11|Done|crit-3,Must
10|Доска задач GitHub Project|Азиз|1–9|04.11|Done|crit-6,Must
11|Тестирование: юнит, сквозные сценарии, ошибочные данные, отчёт|Артём|6, 7|05.11|In Progress|crit-5,Must
12|Исправления по тестам (CSV-кавычки, казахские даты)|Команда|11|05.11|In Progress|crit-4,Must
13|Сборка документации, подготовка к защите|Азиз|9, 11|05.11|In Progress|crit-6,Must
T
)

PROJECT=$(gh project create --owner "@me" --title "$TITLE" --format json | jq -r .number)
OWNER=$(gh api user --jq .login)
gh project link "$PROJECT" --owner "$OWNER" --repo "$REPO" >/dev/null || true
PID=$(gh project view "$PROJECT" --owner "$OWNER" --format json | jq -r .id)
FIELD=$(gh project field-list "$PROJECT" --owner "$OWNER" --format json | jq -r '.fields[] | select(.name=="Status")')
FID=$(jq -r .id <<<"$FIELD")

while IFS='|' read -r n task owner dep due status labels; do
  body=$(printf 'Ответственный: %s\nЗависит от задач: %s\nСрок: %s.2026\nКритерий завершения: Definition of Done, раздел 11.2 документации (docs/obhodnoy_list_documentation.md).' "$owner" "$dep" "$due")
  url=$(gh issue create --repo "$REPO" --title "$n. $task" --body "$body" --label "$labels" --milestone "$MILESTONE")
  item=$(gh project item-add "$PROJECT" --owner "$OWNER" --url "$url" --format json | jq -r .id)
  opt=$(jq -r --arg s "$status" '.options[] | select(.name==$s) | .id' <<<"$FIELD")
  gh project item-edit --id "$item" --project-id "$PID" --field-id "$FID" --single-select-option-id "$opt" >/dev/null
  [ "$status" = Done ] && gh issue close "$url" --reason completed >/dev/null
  echo "$n $status $url"
done <<<"$TASKS"
gh project view "$PROJECT" --owner "$OWNER" --format json | jq -r .url
