-- Anique Dubbing bot: Supabase (Postgres) sxemasi
-- Supabase -> SQL Editor -> New query -> shu kodni qo'yib Run bosing.
-- MUHIM: supabase-js jadval yarata olmaydi, shuning uchun bu faylni bir marta QO'LDA ishga tushirish shart.

CREATE TABLE IF NOT EXISTS users(
  user_id BIGINT PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS anime(
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  poster_file_id TEXT DEFAULT '',
  genre TEXT DEFAULT '',
  year INTEGER DEFAULT 0,
  status TEXT DEFAULT 'Ongoing',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS episodes(
  id BIGSERIAL PRIMARY KEY,
  anime_id BIGINT NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
  season INTEGER NOT NULL DEFAULT 1,
  episode INTEGER NOT NULL,
  title TEXT DEFAULT '',
  file_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stats(
  key TEXT PRIMARY KEY,
  value BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS favorites(
  user_id BIGINT NOT NULL,
  anime_id BIGINT NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
  PRIMARY KEY(user_id, anime_id)
);

CREATE TABLE IF NOT EXISTS progress(
  user_id BIGINT NOT NULL,
  anime_id BIGINT NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
  episode_id BIGINT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY(user_id, anime_id)
);

CREATE TABLE IF NOT EXISTS ratings(
  user_id BIGINT NOT NULL,
  anime_id BIGINT NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL,
  PRIMARY KEY(user_id, anime_id)
);

CREATE TABLE IF NOT EXISTS notifications(
  user_id BIGINT NOT NULL,
  anime_id BIGINT NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
  PRIMARY KEY(user_id, anime_id)
);

-- Xavfsizlik: ochiq REST API (anon kalit) orqali hech kim o'qiy/yoza olmasin.
-- Bot service_role kaliti bilan ulanadi, u RLS ni chetlab o'tadi, shuning uchun RLS bot ishiga to'sqinlik qilmaydi.
ALTER TABLE users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE anime         ENABLE ROW LEVEL SECURITY;
ALTER TABLE episodes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE stats         ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorites     ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ratings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- ---- Bot ishlatadigan funksiyalar (RPC) ----
-- Statistikani atomik oshirish
CREATE OR REPLACE FUNCTION add_stat(p_key TEXT, p_amount BIGINT DEFAULT 1)
RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO stats(key, value) VALUES (p_key, p_amount)
  ON CONFLICT (key) DO UPDATE SET value = stats.value + excluded.value
$$;

-- Mashhur animelar (ko'rishlar soni bo'yicha, top 20)
CREATE OR REPLACE FUNCTION popular_animes()
RETURNS TABLE(id BIGINT, title TEXT, description TEXT, poster_file_id TEXT,
              genre TEXT, year INTEGER, status TEXT, views BIGINT)
LANGUAGE sql STABLE AS $$
  SELECT a.id, a.title, a.description, a.poster_file_id, a.genre, a.year, a.status,
         COUNT(p.episode_id) AS views
  FROM anime a LEFT JOIN progress p ON p.anime_id = a.id
  GROUP BY a.id
  ORDER BY views DESC, a.title
  LIMIT 20
$$;

-- Funksiyalarni faqat bot (service_role) chaqira olsin, ochiq API orqali emas
REVOKE ALL ON FUNCTION add_stat(TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION popular_animes()       FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION add_stat(TEXT, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION popular_animes()       TO service_role;