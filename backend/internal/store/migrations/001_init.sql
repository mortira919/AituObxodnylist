CREATE TYPE role AS ENUM ('student', 'officer', 'admin');
CREATE TYPE dept AS ENUM ('library', 'accounting', 'dorm', 'military', 'it', 'academic');
CREATE TYPE sheet_type AS ENUM ('graduation', 'expulsion', 'transfer', 'leave', 'dorm');
CREATE TYPE mark_state AS ENUM ('pending', 'clear', 'debt');
CREATE TYPE audit_action AS ENUM ('create', 'clear', 'debt', 'close');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  login text NOT NULL UNIQUE CHECK (login ~ '^[a-z0-9._-]{3,64}$'),
  password_hash text NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 3 AND 120),
  role role NOT NULL,
  department dept,
  active boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT true,
  telegram_chat_id bigint UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((role = 'officer') = (department IS NOT NULL))
);

CREATE TABLE students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  "group" text NOT NULL CHECK (char_length("group") BETWEEN 2 AND 20)
);

CREATE TABLE sheets (
  number text PRIMARY KEY CHECK (number ~ '^\d{4}-\d{4}$'),
  student_id uuid NOT NULL REFERENCES students(id),
  type sheet_type NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id),
  closed_at timestamptz
);
CREATE UNIQUE INDEX one_open_sheet_per_type ON sheets(student_id, type) WHERE closed_at IS NULL;
CREATE INDEX sheets_created_at_idx ON sheets(created_at DESC);

CREATE TABLE marks (
  sheet_number text NOT NULL REFERENCES sheets(number),
  department dept NOT NULL,
  state mark_state NOT NULL DEFAULT 'pending',
  note text CHECK (char_length(note) <= 200),
  due date,
  updated_at timestamptz,
  updated_by uuid REFERENCES users(id),
  updated_by_name text,
  PRIMARY KEY (sheet_number, department),
  CHECK (state = 'debt' OR (note IS NULL AND due IS NULL)),
  CHECK (state <> 'debt' OR note IS NOT NULL)
);

CREATE TABLE templates (
  type sheet_type NOT NULL,
  department dept NOT NULL,
  PRIMARY KEY (type, department)
);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid REFERENCES users(id),
  actor_name text NOT NULL,
  sheet_number text NOT NULL REFERENCES sheets(number),
  department dept,
  action audit_action NOT NULL,
  note text
);
CREATE INDEX audit_sheet_at_idx ON audit_log(sheet_number, at DESC);
CREATE INDEX audit_at_idx ON audit_log(at DESC);

CREATE TABLE sessions (
  token_hash bytea PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);

CREATE TABLE sheet_counters (
  year integer PRIMARY KEY,
  last integer NOT NULL CHECK (last > 0)
);

CREATE TABLE telegram_codes (
  code text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
