# Бэкенд электронного обходного листа: техническое задание

Документ для разработчика бэкенда. Фронтенд уже готов и ходит в API по контракту из [openapi.yaml](openapi.yaml). Подробный справочник по каждому эндпоинту с примерами запросов и ответов: [API.md](API.md). Здесь собрано всё остальное: модель данных, бизнес-правила, права, безопасность и порядок приёмки. Стек на ваш выбор (FastAPI, NestJS, Django), контракт от него не зависит. База данных: PostgreSQL 15+.

## 1. Что делает система

Колледж Astana IT University переводит бумажный обходной лист в электронный вид. Учебная часть открывает студенту лист определённого типа. Все отделы из шаблона этого типа видят лист сразу и ставят отметку: «нет задолженности» или «есть долг» с описанием и сроком. Когда все отделы подтвердили отсутствие долга, лист закрывается автоматически и больше не меняется. Закрытый лист проверяется публично по номеру с QR-кода.

Роли:

| Роль | Код | Что делает |
|---|---|---|
| Студент | `student` | Видит свои листы и долги, привязывает Telegram |
| Сотрудник отдела | `officer` | Видит листы своего отдела, ставит отметки своего отдела |
| Учебная часть | `admin` | Открывает листы, ведёт справочники студентов и сотрудников, шаблоны, журнал |
| Проверяющий | без входа | Проверяет подлинность закрытого листа по номеру |

Отделы фиксированы (enum `DeptId`): `library` библиотека, `accounting` бухгалтерия, `dorm` общежитие, `military` военно-учётный стол, `it` IT-отдел, `academic` учебная часть. Отметки в ответах всегда идут в этом порядке.

Типы листа (enum `SheetType`): `graduation` выпуск, `expulsion` отчисление, `transfer` перевод, `leave` академический отпуск, `dorm` выселение из общежития.

## 2. Как фронтенд ходит в API

- Базовый путь `/api/v1`. В разработке Vite проксирует `/api` на `http://localhost:8000` (меняется переменной `VITE_PROXY_TARGET` во `frontend/.env`). В проде фронт и API отдаются с одного домена, поэтому CORS не нужен.
- Аутентификация через cookie `session`: `HttpOnly; Secure; SameSite=Lax; Path=/`. Фронт отправляет запросы с `credentials: 'include'` и не видит токен.
- Каждый запрос фронта несёт заголовок `X-Requested-With: fetch`. На изменяющих запросах (POST, PUT, PATCH, DELETE) без этого заголовка отвечайте `403 forbidden`: это простая защита от CSRF вместе с SameSite.
- JSON в обе стороны, даты в ISO 8601 (`2026-10-29T10:15:00+05:00`), даты без времени `YYYY-MM-DD`.
- Ошибки всегда в одном формате:

```json
{ "error": { "code": "duplicate", "message": "Student already has an open graduation sheet", "field": "type" } }
```

`code` берётся только из enum `ErrorCode` (раздел 6). Интерфейс показывает свой перевод по коду, `message` нужен для логов. `field` указывайте, когда ошибка относится к конкретному полю формы.

- На `401` фронт отправляет пользователя на вход. Для `GET /auth/me` без сессии верните `401 unauthorized`, фронт поймёт это как «не вошёл».

## 3. Модель данных

Схема для PostgreSQL. Имена можно поменять под ваш ORM, ограничения сохраните: часть правил держится на них.

```sql
create extension if not exists pgcrypto;

create type role         as enum ('student', 'officer', 'admin');
create type dept         as enum ('library', 'accounting', 'dorm', 'military', 'it', 'academic');
create type sheet_type   as enum ('graduation', 'expulsion', 'transfer', 'leave', 'dorm');
create type mark_state   as enum ('pending', 'clear', 'debt');
create type audit_action as enum ('create', 'clear', 'debt', 'close');

create table users (
  id                   uuid primary key default gen_random_uuid(),
  login                text not null unique check (login ~ '^[a-z0-9._-]{3,64}$'),
  password_hash        text not null,
  name                 text not null check (char_length(name) between 3 and 120),
  role                 role not null,
  department           dept,
  active               boolean not null default true,
  must_change_password boolean not null default true,
  telegram_chat_id     bigint unique,
  created_at           timestamptz not null default now(),
  -- отдел есть ровно у сотрудников отделов
  check ((role = 'officer') = (department is not null))
);

create table students (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references users(id),
  "group" text not null check (char_length("group") between 2 and 20)
);

create table sheets (
  number     text primary key check (number ~ '^\d{4}-\d{4}$'),
  student_id uuid not null references students(id),
  type       sheet_type not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references users(id),
  closed_at  timestamptz
);
-- правило R2: один открытый лист на студента и тип
create unique index one_open_sheet_per_type on sheets (student_id, type) where closed_at is null;

create table marks (
  sheet_number text not null references sheets(number),
  department   dept not null,
  state        mark_state not null default 'pending',
  note         text check (char_length(note) <= 200),
  due          date,
  updated_at   timestamptz,
  updated_by   uuid references users(id),
  primary key (sheet_number, department),
  check (state = 'debt' or (note is null and due is null)),
  check (state <> 'debt' or note is not null)
);

create table templates (
  type       sheet_type not null,
  department dept not null,
  primary key (type, department)
);

create table audit_log (
  id           bigserial primary key,
  at           timestamptz not null default now(),
  actor_id     uuid references users(id),   -- null означает «Система»
  actor_name   text not null,               -- имя на момент действия, журнал не меняется при переименовании
  sheet_number text not null references sheets(number),
  department   dept,
  action       audit_action not null,
  note         text
);
create index on audit_log (sheet_number, at desc);

create table sessions (
  token_hash   bytea primary key,           -- sha256 от токена из cookie, сам токен не храним
  user_id      uuid not null references users(id),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  last_seen_at timestamptz not null default now()
);

create table sheet_counters (
  year int primary key,
  last int not null
);

create table telegram_codes (
  code       text primary key,
  user_id    uuid not null references users(id),
  expires_at timestamptz not null
);
```

Журнал только дописывается. Отзовите у пользователя приложения права на изменение: `revoke update, delete on audit_log from app_user;`.

Начальные данные:
- шаблоны: `graduation` и `expulsion` все шесть отделов; `transfer` library, accounting, it, academic; `leave` library, accounting, academic; `dorm` dorm, accounting;
- первый администратор создаётся командой CLI или из переменных окружения при первом запуске (`ADMIN_LOGIN`, `ADMIN_PASSWORD`), не через API.

## 4. Бизнес-правила

Часовой пояс колледжа `Asia/Almaty`. Слово «сегодня» в правилах означает дату в этом поясе.

| № | Правило | Нарушение |
|---|---|---|
| R1 | Открыть лист может только `admin`. Студент должен существовать. | `403 forbidden`, `404 not_found` |
| R2 | У студента не бывает двух открытых листов одного типа. Держится на уникальном индексе, нарушение индекса переводите в код. | `409 duplicate` |
| R3 | При открытии отделы копируются из шаблона типа в `marks` со статусом `pending`. Позже шаблон на этот лист не влияет. | — |
| R4 | Номер листа `YYYY-NNNN`: год открытия и порядковый номер внутри года с ведущими нулями. Счётчик увеличивайте в той же транзакции: `insert into sheet_counters ... on conflict (year) do update set last = sheet_counters.last + 1 returning last`. | — |
| R5 | Отметку ставит только `officer`, и только за свой отдел: отдел в URL должен совпадать с `users.department`. | `403 forbidden` |
| R6 | Отдел должен входить в лист. | `400 foreign_dept` |
| R7 | Закрытый лист не меняется: ни отметки, ни что-либо ещё. | `409 closed` |
| R8 | Долг (`state=debt`) требует описания: после обрезки пробелов от 1 до 200 символов. Срок необязателен, но не раньше сегодня. | `400 note_required`, `400 note_too_long`, `400 due_past` |
| R9 | `state=clear` стирает `note` и `due`. | — |
| R10 | Если после изменения все отметки листа `clear`, в той же транзакции ставится `closed_at = now()` и пишется запись журнала `close` от имени «Система». | — |
| R11 | Статус листа вычисляется, а не хранится: `closed`, если `closed_at` заполнен; иначе `debt`, если есть хоть один долг; иначе `progress`, если есть хоть одна `clear`; иначе `created`. | — |
| R12 | Открытие листа и каждое изменение отметки пишутся в `audit_log` в той же транзакции. Отметка, которая ничего не меняет (то же состояние, текст и срок), записи не создаёт. | — |
| R13 | Шаблон не может быть пустым. Изменение шаблона влияет только на новые листы. | `400 no_depts` |
| R14 | Массовая отметка `POST /queue/clear` обрабатывает каждый лист в своей транзакции. Ошибка одного листа не откатывает другие и попадает в `failed`. | — |
| R15 | Логин уникален среди всех пользователей. | `409 login_taken` |
| R16 | Сотруднику отдела нужен отдел, администратору отдел не задаётся. | `400 department_required` |
| R17 | Новый пароль не короче 8 символов. Смена пароля требует текущего. | `400 weak_password`, `400 wrong_password` |
| R18 | Администратор не может заблокировать сам себя. | `403 forbidden` |
| R19 | Блокировка (`active=false`) и сброс пароля удаляют все сессии пользователя. Смена своего пароля удаляет все сессии, кроме текущей. Заблокированный не может войти. | `401 login_failed` |
| R20 | Публичная проверка отдаёт минимум данных: для незакрытого листа только `found`, `closed=false` и `shortName`; для закрытого ещё `number`, `type`, `closedAt`, `departments`. Никогда не отдаёт ФИО полностью, группу, описания долгов и суммы. | — |

`shortName` строится как имя и первая буква фамилии: «Айгерим Сапарова» → «Айгерим С.».

## 5. Права доступа

| Эндпоинт | student | officer | admin | без входа |
|---|---|---|---|---|
| `POST /auth/login` | ✓ | ✓ | ✓ | ✓ |
| `POST /auth/logout`, `GET /auth/me`, `POST /auth/password` | ✓ | ✓ | ✓ | — |
| `GET /sheets` | — | только листы своего отдела, параметр `department` игнорируйте и подставляйте свой | все | — |
| `GET /sheets/mine` | ✓ | — | — | — |
| `GET /sheets/summary` | — | — | ✓ | — |
| `GET /sheets/{number}` | — | если отдел входит в лист | ✓ | — |
| `POST /sheets` | — | — | ✓ | — |
| `PUT /sheets/{number}/marks/{department}` | — | свой отдел | — | — |
| `GET /queue/counts`, `POST /queue/clear` | — | ✓ | — | — |
| `/students`, `/students/{id}`, `/students/import` | — | — | ✓ | — |
| `/users`, `/users/{id}`, `/users/{id}/reset-password` | — | — | ✓ | — |
| `GET /templates` | — | — | ✓ | — |
| `PUT /templates/{type}` | — | — | ✓ | — |
| `GET /audit` | — | — | ✓ | — |
| `POST /telegram/link`, `DELETE /telegram/link` | ✓ | — | — | — |
| `GET /public/verify/{number}` | ✓ | ✓ | ✓ | ✓ |

Чужая роль получает `403 forbidden`. Объект, к которому у роли нет доступа (лист чужого отдела), отдавайте как `404 not_found`, чтобы не подтверждать его существование.

## 6. Коды ошибок

| Код | HTTP | Когда |
|---|---|---|
| `validation` | 400 | Тело не прошло схему (тип, длина, формат). Укажите `field`. |
| `unauthorized` | 401 | Нет сессии или она истекла |
| `login_failed` | 401 | Неверный логин или пароль, либо пользователь заблокирован. Причину не уточнять. |
| `forbidden` | 403 | Роль не позволяет действие, нет заголовка `X-Requested-With` |
| `not_found` | 404 | Нет объекта или нет доступа к нему |
| `duplicate` | 409 | R2 |
| `closed` | 409 | R7 |
| `login_taken` | 409 | R15 |
| `foreign_dept` | 400 | R6 |
| `note_required`, `note_too_long`, `due_past` | 400 | R8 |
| `no_depts` | 400 | R13 |
| `department_required` | 400 | R16 |
| `weak_password`, `wrong_password` | 400 | R17 |
| `bad_file` | 400 | CSV не читается: не UTF-8, больше 2 МБ или 2000 строк, нет нужных колонок |
| `rate_limited` | 429 | Превышен лимит, заголовок `Retry-After` в секундах |
| `server` | 500 | Всё непредвиденное. Стек и детали в лог, клиенту только код. |

## 7. Безопасность

Этот раздел войдёт в техническую спецификацию дипломного проекта (критерий 3.4), поэтому описывайте в коде именно так, как здесь.

**Данные, которые защищаем:** ФИО, логины и группы студентов, финансовые долги (суммы в описании), журнал действий, пароли, сессии, Telegram chat id.

**Пароли.** Хеш argon2id (или bcrypt с cost 12). Временный пароль: 10 случайных символов из алфавита без похожих знаков (`0O1lI`), генератор `secrets`/`crypto.randomBytes`. После выдачи временного пароля `must_change_password = true`. Пока флаг стоит, фронт ведёт пользователя на смену пароля. Открытый пароль не пишите ни в базу, ни в логи, отдавайте его один раз в ответе.

**Сессии.** Токен: 32 случайных байта в base64url. В базе храните только `sha256(token)`. Срок жизни 12 часов с продлением при активности, абсолютный максимум 7 дней. Выход удаляет запись. Правило R19 завершает сессии при блокировке, сбросе и смене пароля.

**CSRF.** `SameSite=Lax` и обязательный заголовок `X-Requested-With` на изменяющих запросах. Дополнительно сверяйте `Origin` с доменом приложения, если он пришёл.

**Ограничение частоты.**
- `POST /auth/login`: 5 неудачных попыток за 15 минут на пару «IP + логин», затем `429`;
- `GET /public/verify/*`: 30 запросов в минуту на IP;
- `POST /students/import`: 5 в час на пользователя.

**Проверка входа.** Валидируйте каждое поле по схеме из openapi.yaml до бизнес-логики. В SQL только параметризованные запросы или ORM. CSV разбирайте библиотекой, а не `split`. Строку, в которой ячейка начинается с `=`, `+`, `-` или `@`, пропускайте с кодом `validation`: иначе файл с паролями при открытии в Excel выполнит формулу.

**Права.** Роль и отдел берите из сессии, никогда из тела запроса. Сотрудник отдела не может отметить чужой отдел, даже подставив его в URL (R5).

**Ошибки и логи.** Клиенту только код и короткое сообщение, без стека и SQL. В логах не должно быть паролей, токенов и cookie. Логируйте вход, неудачный вход, блокировку, сброс пароля, импорт.

**Транспорт.** Только HTTPS, заголовок `Strict-Transport-Security`. Добавьте `X-Content-Type-Options: nosniff` и `Referrer-Policy: same-origin`.

## 8. Telegram

1. Студент нажимает «Подключить», фронт вызывает `POST /telegram/link`. Сервер создаёт 4–6-значный код на 15 минут и отдаёт `botUrl` вида `https://t.me/<bot>?start=<code>`.
2. Студент открывает бота, бот получает `/start <code>`, находит код, записывает `users.telegram_chat_id`, удаляет код и отвечает «Подключено».
3. Фронт после нажатия «Я отправил код» перезапрашивает `GET /auth/me`, где `telegramLinked` станет `true`.

Когда отправлять сообщение студенту:
- отдел поставил долг: отдел, описание, срок, кабинет;
- лист закрыт: номер листа и ссылка на проверку `https://<домен>/verify/<номер>`.

Отметку «нет задолженности» не присылайте, иначе в сезон выпуска студента засыплет сообщениями. Отправку делайте после коммита транзакции, через очередь или фоновую задачу. Ошибка Telegram не должна откатывать отметку.

## 9. Импорт студентов из CSV

- UTF-8, допускается BOM. Разделитель `;` или `,`, определяйте по первой строке.
- Колонки по порядку: `name`, `group`, `login`. Первая строка может быть заголовком с этими именами.
- До 2 МБ и 2000 строк, иначе `400 bad_file` целиком.
- Каждая строка проверяется отдельно, плохая строка попадает в `skipped` с номером (с 1) и кодом: `validation` (пустое или слишком короткое поле, неверный логин, ячейка начинается с `=`, `+`, `-`, `@`) или `login_taken`. Хорошие строки создаются. `bad_file` относится только к файлу целиком.
- Для созданных возвращайте временные пароли. Фронт сам соберёт из них CSV для учебной части: сервер пароли не хранит.

## 10. Что фронт ожидает от ответов

- `Sheet.status` вычислен по R11, `Sheet.student` содержит `id`, `name`, `group`.
- `Sheet.marks` в порядке отделов из раздела 1, у отметки `by` хранится ФИО сотрудника на момент отметки.
- Списки отдают `{ items, total }`, сортировка: листы новые сверху, студенты по ФИО, журнал новые сверху. `pageSize` до 100, по умолчанию 25.
- `GET /sheets` с `department` и `markState` отдаёт листы, в которых отметка этого отдела находится в этом состоянии. Для `clear` в выборку входят и закрытые листы.
- `GET /queue/counts` считает отметки отдела текущего сотрудника по состояниям, включая закрытые листы для `clear`.
- `User.mustChangePassword` отражает флаг из раздела 7.

## 11. Как проверить вместе с фронтендом

1. Поднимите бэкенд на `http://localhost:8000` (или пропишите адрес в `frontend/.env`, переменная `VITE_PROXY_TARGET`).
2. `cd frontend && npm install && npm run dev`, откройте http://localhost:5173/login.
3. Пройдите сценарии и сверьте с правилами:

| Сценарий | Ожидание |
|---|---|
| Вход администратора, создание сотрудника библиотеки | Показан временный пароль, сотрудник входит и попадает на смену пароля |
| Добавление студента, импорт CSV из 3 строк с одним занятым логином | 2 создано, 1 пропущена с `login_taken` |
| Открытие листа «Выпуск» тому же студенту дважды | Второй раз `duplicate` |
| Сотрудник библиотеки ставит долг без описания | `note_required`, на сервер не ушло, если фронт поймал раньше; сервер всё равно отвечает 400 при прямом запросе |
| Сотрудник подставляет в URL чужой отдел | `403` |
| Все отделы ставят «нет задолженности» | Лист закрыт, в журнале запись «Система» |
| Попытка изменить отметку закрытого листа | `409 closed` |
| `GET /public/verify/<номер>` без входа | Только поля из R20 |
| 6 неудачных входов подряд | `429` с `Retry-After` |
| Блокировка сотрудника, у которого открыта вкладка | Следующий запрос даёт 401, фронт уводит на вход |

Автотесты на бэкенде должны покрывать правила R1–R20 и матрицу прав из раздела 5. Для диплома достаточно одного набора интеграционных тестов на тестовой базе.
