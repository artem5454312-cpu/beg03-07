-- =========================================================
-- СХЕМА БАЗЫ ДАННЫХ AI-ТРЕНЕРА
-- Запускается один раз при первом старте (см. server/initDb.js)
-- =========================================================

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  phone TEXT,
  is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name TEXT,
  photo_url TEXT,
  profession TEXT,
  gender TEXT,
  city TEXT,
  bio TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme TEXT NOT NULL DEFAULT 'dark',
  notify_agent BOOLEAN NOT NULL DEFAULT TRUE,
  notify_chat BOOLEAN NOT NULL DEFAULT TRUE,
  notify_workout BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Цели: история, а не одна текущая (старая архивируется, не удаляется)
CREATE TABLE IF NOT EXISTS goals (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- active | archived
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS workouts (
  id SERIAL PRIMARY KEY,
  goal_id INTEGER REFERENCES goals(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned', -- planned | done | skipped | cancelled
  source TEXT NOT NULL DEFAULT 'agent',   -- agent | manual
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS difficulty TEXT NOT NULL DEFAULT 'medium'; -- easy | medium | hard

CREATE TABLE IF NOT EXISTS workout_results (
  id SERIAL PRIMARY KEY,
  workout_id INTEGER REFERENCES workouts(id) ON DELETE CASCADE,
  notes TEXT,
  metrics JSONB,
  file_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Лента переписки пользователь <-> агент (можно чистить кнопкой)
CREATE TABLE IF NOT EXISTS agent_messages (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL, -- user | agent
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Структурированные факты о пользователе (никогда не чистится кнопкой "очистить диалог")
CREATE TABLE IF NOT EXISTS agent_memory (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS city_chats (
  id SERIAL PRIMARY KEY,
  city_name TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS city_chat_members (
  chat_id INTEGER REFERENCES city_chats(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id SERIAL PRIMARY KEY,
  chat_id INTEGER REFERENCES city_chats(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS reply_to_id INTEGER REFERENCES chat_messages(id) ON DELETE SET NULL;

-- Реакции на сообщения общего чата (одна реакция на пользователя на сообщение)
CREATE TABLE IF NOT EXISTS message_reactions (
  message_id INTEGER REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

-- Отметки "прочитано", чтобы считать бейджи непрочитанных на вкладках/иконке приложения
CREATE TABLE IF NOT EXISTS chat_read_state (
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  chat_id INTEGER REFERENCES city_chats(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, chat_id)
);
CREATE TABLE IF NOT EXISTS agent_read_state (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  chat_id INTEGER REFERENCES city_chats(id) ON DELETE CASCADE,
  message_id INTEGER REFERENCES chat_messages(id) ON DELETE CASCADE,
  reported_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  chat_id INTEGER REFERENCES city_chats(id) ON DELETE CASCADE,
  creator_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  workout_id INTEGER REFERENCES workouts(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  event_date TIMESTAMPTZ NOT NULL,
  max_participants INTEGER,
  cancelled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS event_participants (
  event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);
ALTER TABLE event_participants ADD COLUMN IF NOT EXISTS response TEXT NOT NULL DEFAULT 'going';

CREATE TABLE IF NOT EXISTS direct_chats (
  id SERIAL PRIMARY KEY,
  user_a INTEGER REFERENCES users(id) ON DELETE CASCADE,
  user_b INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_a, user_b)
);

CREATE TABLE IF NOT EXISTS direct_messages (
  id SERIAL PRIMARY KEY,
  direct_chat_id INTEGER REFERENCES direct_chats(id) ON DELETE CASCADE,
  sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- agent_message | chat_message | event_reminder | workout_reminder | system
  payload JSONB,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  subscription JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_logs (
  id SERIAL PRIMARY KEY,
  action TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workouts_user_date ON workouts(user_id, date);
CREATE INDEX IF NOT EXISTS idx_agent_messages_user ON agent_messages(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat ON chat_messages(chat_id, created_at);
