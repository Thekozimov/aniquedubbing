import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "./config.js";

// service_role kaliti RLS ni chetlab o'tadi. Bu kalit faqat serverda (Render env) turishi kerak!
export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const lc = (v) => String(v ?? "").toLowerCase();
const COLS = "id,title,description,poster_file_id,genre,year,status";
const PAGE = 1000; // Supabase bitta so'rovda odatda 1000 qatordan ortiq qaytarmaydi

// Xatoni exception qilib tashlaydi, aks holda data qaytaradi
function check({ data, error }) {
  if (error) throw new Error(error.message || String(error));
  return data;
}

// 1000 tadan ko'p qatorni sahifalab olish. build() har safar yangi so'rov qaytarishi kerak.
async function fetchAll(build) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const part = check(await build().range(from, from + PAGE - 1));
    rows.push(...part);
    if (part.length < PAGE) break;
  }
  return rows;
}

const count = async (table) => {
  const { count: n, error } = await supabase.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  return n ?? 0;
};

// Health-check uchun yengil so'rov (Supabase bepul loyiha "faolsiz" deb to'xtatilmasligi uchun ham foydali)
export const ping = async () => {
  const { error } = await supabase.from("stats").select("key").limit(1);
  if (error) throw new Error(error.message);
};

// supabase-js jadval yarata olmaydi: schema.sql ni Supabase SQL Editor'da bir marta ishga tushiring.
export async function initDb() {
  const { error } = await supabase.from("anime").select("id").limit(1);
  if (error) {
    const missing = error.code === "PGRST205" || error.code === "42P01" || /schema cache|does not exist/i.test(error.message);
    if (missing) {
      throw new Error("Jadvallar topilmadi. Supabase -> SQL Editor'da schema.sql ni ishga tushiring. (" + error.message + ")");
    }
    throw new Error("Supabase'ga ulanib bo'lmadi: " + error.message + " (SUPABASE_URL va SUPABASE_SERVICE_ROLE_KEY ni tekshiring)");
  }
}

export const closeDb = async () => {}; // HTTP orqali ishlaydi, yopiladigan ulanish yo'q

export const addStat = async (key, amount = 1) =>
  check(await supabase.rpc("add_stat", { p_key: key, p_amount: amount }));

export const saveUser = async (u) =>
  check(await supabase.from("users").upsert(
    { user_id: u.id, username: u.username || "", first_name: u.first_name || "" },
    { onConflict: "user_id" }
  ));

export const allUserIds = async () =>
  (await fetchAll(() => supabase.from("users").select("user_id").order("user_id"))).map((r) => r.user_id);

// ---- Anime ----
export async function getAnimes(order = "title") {
  if (order === "title") {
    const rows = await fetchAll(() => supabase.from("anime").select(COLS).order("id"));
    return rows.sort((a, b) => lc(a.title).localeCompare(lc(b.title)));
  }
  return fetchAll(() =>
    supabase.from("anime").select(COLS).order("created_at", { ascending: false }).order("id", { ascending: false })
  );
}

export async function searchAnimes(query) {
  const s = lc(query);
  return (await getAnimes()).filter((a) => lc(a.title).includes(s) || lc(a.genre).includes(s)).slice(0, 40);
}

export const getAnime = async (id) =>
  check(await supabase.from("anime").select(COLS).eq("id", id).maybeSingle()) ?? undefined;

export const createAnime = async (title, desc, poster = "", genre = "", year = 0, status = "Ongoing") =>
  check(await supabase.from("anime")
    .insert({ title, description: desc, poster_file_id: poster, genre, year, status })
    .select("id").single()).id;

export const updateAnime = async (id, title, desc, poster, genre, year, status) =>
  check(await supabase.from("anime")
    .update({ title, description: desc, poster_file_id: poster, genre, year, status })
    .eq("id", id));

// Bog'liq jadvallar ON DELETE CASCADE orqali avtomatik o'chadi
export const deleteAnime = async (id) => check(await supabase.from("anime").delete().eq("id", id));

export const popularAnimes = async () => check(await supabase.rpc("popular_animes"));

export async function favoriteAnimes(uid) {
  const rows = check(await supabase.from("favorites").select("anime(id,title)").eq("user_id", uid));
  return rows.map((r) => r.anime).filter(Boolean).sort((a, b) => lc(a.title).localeCompare(lc(b.title)));
}

export async function followedAnimes(uid) {
  const rows = check(await supabase.from("notifications").select("anime(id,title)").eq("user_id", uid));
  return rows.map((r) => r.anime).filter(Boolean).sort((a, b) => lc(a.title).localeCompare(lc(b.title)));
}

export async function genres() {
  const vals = new Map(); // katta-kichik harf farqisiz takrorlanmasin
  const rows = await fetchAll(() => supabase.from("anime").select("id,genre").neq("genre", "").order("id"));
  for (const r of rows) {
    if (!r.genre) continue;
    for (const g of r.genre.split(",")) if (g.trim() && !vals.has(lc(g.trim()))) vals.set(lc(g.trim()), g.trim());
  }
  return [...vals.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}
export const animesByGenre = async (g) => (await getAnimes()).filter((a) => lc(a.genre).includes(lc(g)));

// ---- Qismlar ----
export const getEpisodes = async (aid) =>
  fetchAll(() =>
    supabase.from("episodes").select("id,season,episode,title,file_id").eq("anime_id", aid)
      .order("season").order("episode").order("id")
  );

export async function getEpisode(eid) {
  const r = check(await supabase.from("episodes")
    .select("id,anime_id,season,episode,title,file_id,anime(title)").eq("id", eid).maybeSingle());
  if (!r) return undefined;
  const { anime, ...rest } = r;
  return { ...rest, anime_title: anime?.title ?? "" };
}

export const createEpisode = async (aid, season, ep, title, fileId) =>
  check(await supabase.from("episodes")
    .insert({ anime_id: aid, season, episode: ep, title, file_id: fileId })
    .select("id").single()).id;

// ---- Statistika ----
export async function getStats() {
  const v = check(await supabase.from("stats").select("value").eq("key", "episode_views").maybeSingle());
  const [users, anime, episodes] = await Promise.all([count("users"), count("anime"), count("episodes")]);
  return { users, anime, episodes, views: v ? Number(v.value) : 0 };
}

// ---- Sevimli / kuzatuv ----
async function toggle(table, uid, aid) {
  const deleted = check(await supabase.from(table).delete().eq("user_id", uid).eq("anime_id", aid).select("user_id"));
  if (deleted.length > 0) return false;
  check(await supabase.from(table).upsert({ user_id: uid, anime_id: aid }, { onConflict: "user_id,anime_id", ignoreDuplicates: true }));
  return true;
}
const has = async (table, uid, aid) =>
  check(await supabase.from(table).select("user_id").eq("user_id", uid).eq("anime_id", aid).limit(1)).length > 0;

export const toggleFavorite = (u, a) => toggle("favorites", u, a);
export const isFavorite = (u, a) => has("favorites", u, a);
export const toggleNotify = (u, a) => toggle("notifications", u, a);
export const isNotifying = (u, a) => has("notifications", u, a);
export const notifyUsers = async (aid) =>
  (await fetchAll(() => supabase.from("notifications").select("user_id").eq("anime_id", aid).order("user_id"))).map((r) => r.user_id);

// ---- Progress / reyting ----
export const saveProgress = async (uid, aid, eid) =>
  check(await supabase.from("progress").upsert(
    { user_id: uid, anime_id: aid, episode_id: eid, updated_at: new Date().toISOString() },
    { onConflict: "user_id,anime_id" }
  ));

export async function getProgress(uid) {
  const rows = check(await supabase.from("progress")
    .select("anime_id,episode_id,updated_at,anime(title)").eq("user_id", uid)
    .order("updated_at", { ascending: false }));
  if (!rows.length) return [];
  const eps = check(await supabase.from("episodes").select("id,season,episode").in("id", rows.map((r) => r.episode_id)));
  const byId = new Map(eps.map((e) => [e.id, e]));
  // Qismi o'chirib yuborilgan yozuvlar tashlab ketiladi (SQL'dagi INNER JOIN kabi)
  return rows
    .filter((r) => r.anime && byId.has(r.episode_id))
    .map((r) => ({
      anime_id: r.anime_id,
      episode_id: r.episode_id,
      title: r.anime.title,
      season: byId.get(r.episode_id).season,
      episode: byId.get(r.episode_id).episode,
    }));
}

export const rateAnime = async (uid, aid, rating) =>
  check(await supabase.from("ratings").upsert({ user_id: uid, anime_id: aid, rating }, { onConflict: "user_id,anime_id" }));

export async function avgRating(aid) {
  const rows = await fetchAll(() => supabase.from("ratings").select("user_id,rating").eq("anime_id", aid).order("user_id"));
  if (!rows.length) return { avg: 0, count: 0 };
  const sum = rows.reduce((s, r) => s + r.rating, 0);
  return { avg: Math.round((sum / rows.length) * 10) / 10, count: rows.length };
}