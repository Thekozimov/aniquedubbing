import http from "node:http";
import { Bot, InlineKeyboard } from "grammy";
import { BOT_TOKEN, ADMIN_IDS, REQUIRED_CHANNEL, CHANNEL_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PORT } from "./config.js";
import * as q from "./db.js";

if (!BOT_TOKEN) { console.error("BOT_TOKEN ko'rsatilmagan."); process.exit(1); }
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) { console.error("SUPABASE_URL va SUPABASE_SERVICE_ROLE_KEY ko'rsatilmagan."); process.exit(1); }

// Render (Web Service) port kutadi, UptimeRobot esa shu manzilni har 5 daqiqada so'rab botni uyg'oq tutadi
http.createServer(async (req, res) => {
  // Bazaga yengil so'rov: Supabase bepul loyihasi "faolsiz" deb to'xtatilmasligi uchun ham foydali
  try { await q.ping(); } catch (e) { console.error("Health: baza javob bermadi:", e.message); }
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(req.method === "HEAD" ? undefined : "Anique Dubbing bot ishlayapti");
}).listen(PORT, () => console.log(`Health server: port ${PORT}`));

await q.initDb();

const bot = new Bot(BOT_TOKEN);

// Barcha xabarlarda HTML formatlash (<b>, <code>) ishlashi uchun
const HTML_METHODS = new Set(["sendMessage", "editMessageText", "sendPhoto", "sendVideo", "editMessageCaption"]);
bot.api.config.use((prev, method, payload, signal) => {
  if (HTML_METHODS.has(method) && payload.parse_mode === undefined) payload = { ...payload, parse_mode: "HTML" };
  return prev(method, payload, signal);
});

// ---------- Yordamchi funksiyalar ----------
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pad = (n) => String(n).padStart(2, "0");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isAdmin = (id) => ADMIN_IDS.has(id);
const txt = (ctx) => (ctx.msg?.text || "").trim();
const errText = (e) => String(e?.description || e?.message || e);
const background = (fn) => fn().catch((e) => console.error("Fon vazifasi xatosi:", e));

// Foydalanuvchi holati (FSM o'rniga): userId -> { step, data }
const states = new Map();
const setState = (uid, step, data = {}) => states.set(uid, { step, data });

const listText = (head, rows) => {
  let t = head + "\n\n";
  for (const r of rows) {
    const line = `<code>${r.id}</code> — ${esc(r.title)}\n`;
    if (t.length + line.length > 3900) { t += "…"; break; }
    t += line;
  }
  return t;
};

// Matnli xabarni tahrirlaydi; rasm/video xabar bo'lsa yangisini yuborib eskisini o'chiradi
async function edit(ctx, text, kb) {
  const msg = ctx.callbackQuery?.message;
  if (!msg || !msg.text) {
    await ctx.reply(text, { reply_markup: kb });
    try { await ctx.deleteMessage(); } catch { /* ignore */ }
    return;
  }
  try {
    await ctx.editMessageText(text, { reply_markup: kb });
  } catch (e) {
    if (!errText(e).includes("message is not modified")) throw e;
  }
}

async function subscribed(ctx, uid) {
  if (!REQUIRED_CHANNEL) return true;
  try {
    const m = await ctx.api.getChatMember(REQUIRED_CHANNEL, uid);
    return ["member", "administrator", "creator"].includes(m.status);
  } catch { return false; }
}

// ---------- Klaviaturalar ----------
function animeKeyboard(rows, back = "home") {
  const kb = new InlineKeyboard();
  for (const r of rows) kb.text(`🎬 ${r.title}`, `anime:${r.id}`).row();
  return kb.text("⬅️ Orqaga", back);
}
const mainMenu = () => new InlineKeyboard()
  .text("🎬 Anime", "catalog").text("🔥 Mashhur", "popular").row()
  .text("🆕 Yangi", "new").text("🎭 Janrlar", "genres").row()
  .text("🔎 Qidirish", "search").text("❤️ Sevimlilar", "favorites").row()
  .text("📚 Davom ettirish", "continue").text("🔔 Kuzatuvlar", "following").row()
  .url("📢 Yangiliklar", CHANNEL_URL || "https://t.me/").text("💬 Taklif", "suggest").row()
  .text("ℹ️ Biz haqimizda", "about");
const adminMenu = () => new InlineKeyboard()
  .text("➕ Anime", "admin:add_anime").text("➕ Qism", "admin:add_episode").row()
  .text("✏️ Anime tahrirlash", "admin:edit_anime").text("🗑 O'chirish", "admin:delete_anime").row()
  .text("📊 Statistika", "admin:stats").text("📣 Broadcast", "admin:broadcast").row()
  .text("⬅️ Bosh menyu", "home");
const backHome = () => new InlineKeyboard().text("⬅️ Bosh menyu", "home");
const backToAnime = (aid) => new InlineKeyboard().text("⬅️ Anime", `anime:${aid}`);

function episodeKeyboard(aid, rows) {
  const kb = new InlineKeyboard();
  for (const e of rows) {
    kb.text(`▶️ S${pad(e.season)} • E${pad(e.episode)}${e.title ? ` — ${e.title}` : ""}`, `episode:${e.id}`).row();
  }
  return kb.text("⬅️ Anime", `anime:${aid}`);
}
async function detailKeyboard(aid, uid) {
  const fav = (await q.isFavorite(uid, aid)) ? "💔 Sevimlidan olib tashlash" : "❤️ Sevimliga qo'shish";
  const nt = (await q.isNotifying(uid, aid)) ? "🔕 Kuzatuvni o'chirish" : "🔔 Yangi qismlarni kuzatish";
  return new InlineKeyboard()
    .text("📺 Qismlar", `eps:${aid}`).row()
    .text(fav, `fav:${aid}`).text(nt, `notify:${aid}`).row()
    .text("⭐ Baholash", `rate:${aid}`).row()
    .text("⬅️ Bosh menyu", "home");
}

// ---------- Anime sahifasi ----------
async function showAnime(ctx, aid, answer = true) {
  const a = await q.getAnime(aid);
  if (!a) return ctx.answerCallbackQuery({ text: "Anime topilmadi.", show_alert: true });
  const { avg, count } = await q.avgRating(aid);
  const eps = (await q.getEpisodes(aid)).length;
  let text = `🎬 <b>${esc(a.title)}</b>\n\n`;
  if (a.genre) text += `🎭 Janr: <b>${esc(a.genre)}</b>\n`;
  if (a.year) text += `📅 Yil: <b>${a.year}</b>\n`;
  if (a.status) text += `📌 Holat: <b>${esc(a.status)}</b>\n`;
  text += `📺 Qismlar: <b>${eps}</b>\n⭐ Reyting: <b>${avg || "—"}</b>${count ? ` (${count} ta baho)` : ""}\n\n`;
  const tail = "Kerakli bo'limni tanlang:";
  if (a.description) {
    const room = (a.poster_file_id ? 900 : 3800) - text.length - tail.length; // rasm izohi 1024 belgigacha
    const d = a.description.length <= room ? a.description : a.description.slice(0, Math.max(room, 0) - 1) + "…";
    text += `📝 ${esc(d)}\n\n`;
  }
  text += tail;
  const kb = await detailKeyboard(aid, ctx.from.id);
  if (answer) await ctx.answerCallbackQuery();

  if (a.poster_file_id) {
    if (ctx.callbackQuery?.message?.photo) {
      try { await ctx.editMessageCaption({ caption: text, reply_markup: kb }); return; }
      catch (e) { if (errText(e).includes("not modified")) return; }
    }
    try {
      await ctx.replyWithPhoto(a.poster_file_id, { caption: text, reply_markup: kb });
      try { await ctx.deleteMessage(); } catch { /* ignore */ }
      return;
    } catch (e) { console.error("Poster yuborilmadi (file_id noto'g'ri bo'lishi mumkin):", errText(e)); }
  }
  await edit(ctx, text, kb);
}

// ---------- Buyruqlar (holat handlerlaridan oldin turishi shart) ----------
bot.command("id", (ctx) => ctx.reply(`🆔 Sizning Telegram ID: <code>${ctx.from.id}</code>`));

bot.command("admin", async (ctx) => {
  states.delete(ctx.from.id);
  if (!isAdmin(ctx.from.id)) return ctx.reply("⛔ Siz admin emassiz.");
  await ctx.reply("🛠 <b>ANIQUE DUBBING ADMIN PANEL</b>", { reply_markup: adminMenu() });
});

bot.command("cancel", async (ctx) => {
  states.delete(ctx.from.id);
  await ctx.reply("❌ Bekor qilindi.", { reply_markup: mainMenu() });
});

bot.command("start", async (ctx) => {
  states.delete(ctx.from.id);
  await q.saveUser(ctx.from); await q.addStat("starts");
  if (!(await subscribed(ctx, ctx.from.id))) {
    const kb = new InlineKeyboard().url("📢 Kanalga o'tish", CHANNEL_URL || "https://t.me/").row().text("✅ Tekshirish", "checksub");
    return ctx.reply("🔒 Botdan foydalanish uchun kanalga obuna bo'ling.", { reply_markup: kb });
  }
  await ctx.reply("🎙️ <b>ANIQUE DUBBING</b>\n\nAnime olamiga xush kelibsiz!\n\nKerakli bo'limni tanlang:", { reply_markup: mainMenu() });
});

// ---------- Foydalanuvchi tugmalari ----------
bot.callbackQuery("checksub", async (ctx) => {
  if (await subscribed(ctx, ctx.from.id)) {
    await edit(ctx, "✅ Obuna tasdiqlandi!", mainMenu());
    await ctx.answerCallbackQuery();
  } else {
    await ctx.answerCallbackQuery({ text: "❌ Hali obuna bo'lmagansiz.", show_alert: true });
  }
});

bot.callbackQuery("home", async (ctx) => {
  states.delete(ctx.from.id);
  await edit(ctx, "🎙️ <b>ANIQUE DUBBING</b>\n\nAsosiy menyu:", mainMenu());
  await ctx.answerCallbackQuery();
});

const listScreen = (data, title, getRows, back) =>
  bot.callbackQuery(data, async (ctx) => {
    const rows = await getRows(ctx);
    await edit(ctx, title, rows.length ? animeKeyboard(rows, back) : backHome());
    await ctx.answerCallbackQuery();
  });
listScreen("catalog", "🎬 <b>Anime katalogi</b>\n\nAnime tanlang:", () => q.getAnimes());
listScreen("new", "🆕 <b>Yangi qo'shilganlar</b>", async () => (await q.getAnimes("new")).slice(0, 20));
listScreen("popular", "🔥 <b>Mashhur animelar</b>", () => q.popularAnimes());
listScreen("favorites", "❤️ <b>Sevimlilar</b>", (ctx) => q.favoriteAnimes(ctx.from.id));
listScreen("following", "🔔 <b>Kuzatayotgan animelar</b>", (ctx) => q.followedAnimes(ctx.from.id));

bot.callbackQuery("genres", async (ctx) => {
  const kb = new InlineKeyboard();
  (await q.genres()).forEach((g, i) => kb.text(`🎭 ${g}`, `genre:${i}`).row()); // indeks: callback_data 64 baytdan oshmasligi uchun
  kb.text("⬅️ Bosh menyu", "home");
  await edit(ctx, "🎭 <b>Janrlar</b>", kb);
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^genre:(\d+)$/, async (ctx) => {
  const g = (await q.genres())[Number(ctx.match[1])];
  if (!g) return ctx.answerCallbackQuery({ text: "Janr topilmadi.", show_alert: true });
  const rows = await q.animesByGenre(g);
  await edit(ctx, `🎭 <b>${esc(g)}</b>`, rows.length ? animeKeyboard(rows, "genres") : backHome());
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("search", async (ctx) => {
  setState(ctx.from.id, "search");
  await edit(ctx, "🔎 Anime nomini yozing:", backHome());
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("continue", async (ctx) => {
  const rows = await q.getProgress(ctx.from.id);
  if (!rows.length) {
    await edit(ctx, "📚 Hali ko'rilgan qism yo'q.", backHome());
    return ctx.answerCallbackQuery();
  }
  const kb = new InlineKeyboard();
  for (const r of rows) kb.text(`▶️ ${r.title} — S${pad(r.season)} E${pad(r.episode)}`, `episode:${r.episode_id}`).row();
  kb.text("⬅️ Bosh menyu", "home");
  await edit(ctx, "📚 <b>Davom ettirish</b>", kb);
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^anime:(\d+)$/, (ctx) => showAnime(ctx, Number(ctx.match[1])));

bot.callbackQuery(/^eps:(\d+)$/, async (ctx) => {
  const aid = Number(ctx.match[1]);
  const rows = await q.getEpisodes(aid);
  await edit(ctx, "📺 <b>Qismlar</b>\n\nKerakli qismni tanlang:", rows.length ? episodeKeyboard(aid, rows) : backToAnime(aid));
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^fav:(\d+)$/, async (ctx) => {
  const aid = Number(ctx.match[1]);
  const added = await q.toggleFavorite(ctx.from.id, aid);
  await ctx.answerCallbackQuery({ text: added ? "❤️ Sevimliga qo'shildi" : "💔 Sevimlilardan olib tashlandi" });
  await showAnime(ctx, aid, false);
});

bot.callbackQuery(/^notify:(\d+)$/, async (ctx) => {
  const aid = Number(ctx.match[1]);
  const added = await q.toggleNotify(ctx.from.id, aid);
  await ctx.answerCallbackQuery({ text: added ? "🔔 Kuzatuv yoqildi" : "🔕 Kuzatuv o'chirildi" });
  await showAnime(ctx, aid, false);
});

bot.callbackQuery(/^rate:(\d+)$/, async (ctx) => {
  const aid = Number(ctx.match[1]);
  const kb = new InlineKeyboard();
  for (let i = 1; i <= 5; i++) kb.text(`${i} ⭐`, `rating:${aid}:${i}`);
  kb.row().text("⬅️ Anime", `anime:${aid}`);
  await edit(ctx, "⭐ <b>Bahoni tanlang</b>", kb);
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^rating:(\d+):([1-5])$/, async (ctx) => {
  const aid = Number(ctx.match[1]);
  await q.rateAnime(ctx.from.id, aid, Number(ctx.match[2]));
  await ctx.answerCallbackQuery({ text: "✅ Bahoyingiz saqlandi" });
  await showAnime(ctx, aid, false);
});

bot.callbackQuery(/^episode:(\d+)$/, async (ctx) => {
  const ep = await q.getEpisode(Number(ctx.match[1]));
  if (!ep) return ctx.answerCallbackQuery({ text: "Qism topilmadi.", show_alert: true });
  await q.saveProgress(ctx.from.id, ep.anime_id, ep.id); await q.addStat("episode_views");
  const caption = `🎬 <b>${esc(ep.anime_title)}</b>\n📺 S${pad(ep.season)} • E${pad(ep.episode)}${ep.title ? ` — ${esc(ep.title)}` : ""}\n\n🎙️ Anique Dubbing`;
  try {
    await ctx.replyWithVideo(ep.file_id, { caption });
    await ctx.answerCallbackQuery();
  } catch (e) {
    console.error("Video yuborilmadi:", errText(e));
    await ctx.answerCallbackQuery({ text: "❌ Videoni yuborib bo'lmadi. Admin bilan bog'laning.", show_alert: true });
  }
});

bot.callbackQuery("suggest", async (ctx) => {
  setState(ctx.from.id, "suggest");
  await edit(ctx, "💬 Taklifingizni yozing:", backHome());
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("about", async (ctx) => {
  await edit(ctx, "🎙️ <b>ANIQUE DUBBING</b>\n\nAnime loyihalarini o'zbek tilida dublyaj qilish uchun yaratilgan loyiha.\n\n🎧 Sifatli ovoz\n🎬 Anime katalogi\n📺 Qismlar\n❤️ Sevimlilar\n🔔 Yangi qismlar\n⭐ Reyting\n\n© Anique Dubbing", backHome());
  await ctx.answerCallbackQuery();
});

// ---------- Admin tugmalari ----------
async function guard(ctx) {
  if (isAdmin(ctx.from.id)) return true;
  await ctx.answerCallbackQuery({ text: "Ruxsat yo'q", show_alert: true });
  return false;
}
const adminAsk = (data, step, getPrompt) =>
  bot.callbackQuery(data, async (ctx) => {
    if (!(await guard(ctx))) return;
    const prompt = await getPrompt();
    if (!prompt) {
      await edit(ctx, "Avval anime qo'shing.", adminMenu());
      return ctx.answerCallbackQuery();
    }
    setState(ctx.from.id, step);
    await edit(ctx, prompt);
    await ctx.answerCallbackQuery();
  });
adminAsk("admin:add_anime", "aa_title", async () => "➕ Anime nomini yozing:");
adminAsk("admin:add_episode", "ae_aid", async () => { const r = await q.getAnimes(); return r.length ? listText("➕ Anime ID sini yuboring:", r) : null; });
adminAsk("admin:delete_anime", "del", async () => listText("🗑 Anime ID sini yuboring:", await q.getAnimes()));
adminAsk("admin:edit_anime", "ed_aid", async () => listText("✏️ Tahrirlanadigan anime ID sini yuboring:", await q.getAnimes()));
adminAsk("admin:broadcast", "broadcast", async () => "📣 Barcha foydalanuvchilarga yuboriladigan xabarni yozing (matn, rasm yoki video):");

bot.callbackQuery("admin:stats", async (ctx) => {
  if (!(await guard(ctx))) return;
  const s = await q.getStats();
  await edit(ctx, `📊 <b>Statistika</b>\n\n👥 Foydalanuvchilar: <b>${s.users}</b>\n🎬 Anime: <b>${s.anime}</b>\n📺 Qismlar: <b>${s.episodes}</b>\n▶️ Ko'rishlar: <b>${s.views}</b>`, adminMenu());
  await ctx.answerCallbackQuery();
});

// ---------- Holatga bog'liq xabarlar (admin jarayonlari, qidiruv, taklif) ----------
const go = (st, step, patch = {}) => { st.step = step; Object.assign(st.data, patch); };
const YEAR_ASK = "📅 Yil (masalan: 2026, noma'lum bo'lsa 0):";
const parseYear = (s) => (/^\d{1,4}$/.test(s) && Number(s) <= 2100 ? Number(s) : null);
const parsePositive = (s) => (/^\d+$/.test(s) && Number(s) > 0 ? Number(s) : null);
const requireText = async (ctx, label = "Nomni") => {
  const t = txt(ctx);
  if (!t) await ctx.reply(`❌ ${label} matn bilan yozing.`);
  return t;
};

const steps = {
  async search(ctx) {
    const s = txt(ctx);
    if (!s) return ctx.reply("❌ Anime nomini matn ko'rinishida yozing.");
    states.delete(ctx.from.id);
    const rows = await q.searchAnimes(s);
    await ctx.reply(`🔎 <b>${esc(s)}</b> bo'yicha natijalar:`, { reply_markup: rows.length ? animeKeyboard(rows) : mainMenu() });
  },
  async suggest(ctx) {
    const s = txt(ctx);
    if (!s) return ctx.reply("❌ Taklifni matn ko'rinishida yozing.");
    states.delete(ctx.from.id);
    const name = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ");
    for (const aid of ADMIN_IDS) {
      try { await ctx.api.sendMessage(aid, `💬 <b>Yangi taklif</b>\n\n👤 ${esc(name)}\n🆔 <code>${ctx.from.id}</code>\n📩 ${esc(s)}`); } catch { /* ignore */ }
    }
    await ctx.reply("✅ Taklifingiz adminlarga yuborildi.", { reply_markup: mainMenu() });
  },

  // --- Anime qo'shish ---
  async aa_title(ctx, st) { const t = await requireText(ctx); if (!t) return; go(st, "aa_desc", { title: t }); await ctx.reply("📝 Tavsif (kerak bo'lmasa -):"); },
  async aa_desc(ctx, st) { const t = txt(ctx); go(st, "aa_genre", { description: t === "-" ? "" : t }); await ctx.reply("🎭 Janrlar (masalan: Action, Fantasy):"); },
  async aa_genre(ctx, st) { go(st, "aa_year", { genre: txt(ctx) }); await ctx.reply(YEAR_ASK); },
  async aa_year(ctx, st) {
    const y = parseYear(txt(ctx));
    if (y === null) return ctx.reply("❌ Yil 0 yoki to'g'ri raqam bo'lsin.");
    go(st, "aa_status", { year: y }); await ctx.reply("📌 Holat: Ongoing / Completed / Hiatus");
  },
  async aa_status(ctx, st) { go(st, "aa_poster", { status: txt(ctx) || "Ongoing" }); await ctx.reply("🖼 Poster rasmini yuboring. Kerak bo'lmasa <code>-</code> yuboring."); },
  async aa_poster(ctx, st) {
    const photo = ctx.msg.photo?.at(-1)?.file_id;
    if (!photo && txt(ctx) !== "-") return ctx.reply("❌ Rasm yuboring yoki - yuboring.");
    const d = st.data;
    const aid = await q.createAnime(d.title, d.description, photo || "", d.genre, d.year, d.status);
    states.delete(ctx.from.id);
    await ctx.reply(`✅ Anime qo'shildi! ID: <code>${aid}</code>`, { reply_markup: adminMenu() });
  },

  // --- Qism qo'shish ---
  async ae_aid(ctx, st) {
    const aid = parsePositive(txt(ctx));
    if (!aid) return ctx.reply("❌ ID raqam bo'lsin.");
    if (!await q.getAnime(aid)) return ctx.reply("❌ Bunday anime yo'q.");
    go(st, "ae_season", { anime_id: aid }); await ctx.reply("📀 Fasl raqami:");
  },
  async ae_season(ctx, st) {
    const n = parsePositive(txt(ctx));
    if (!n) return ctx.reply("❌ Musbat son.");
    go(st, "ae_ep", { season: n }); await ctx.reply("🎬 Qism raqami:");
  },
  async ae_ep(ctx, st) {
    const n = parsePositive(txt(ctx));
    if (!n) return ctx.reply("❌ Musbat son.");
    go(st, "ae_title", { episode: n }); await ctx.reply("📝 Qism nomi (- bo'lsa nomsiz):");
  },
  async ae_title(ctx, st) { const t = txt(ctx); go(st, "ae_file", { title: t === "-" ? "" : t }); await ctx.reply("🎥 Videoni yuboring:"); },
  async ae_file(ctx, st) {
    if (!ctx.msg.video) return ctx.reply("❌ Videoni Telegram video sifatida yuboring.");
    const d = st.data;
    const eid = await q.createEpisode(d.anime_id, d.season, d.episode, d.title, ctx.msg.video.file_id);
    states.delete(ctx.from.id);
    const users = await q.notifyUsers(d.anime_id);
    const anime = await q.getAnime(d.anime_id);
    background(async () => {
      for (const uid of users) {
        try { await ctx.api.sendMessage(uid, `🔔 <b>Yangi qism chiqdi!</b>\n\n🎬 ${esc(anime.title)}\n📺 S${pad(d.season)} • E${pad(d.episode)}`); } catch { /* ignore */ }
        await sleep(50);
      }
    });
    await ctx.reply(`✅ Qism qo'shildi! ID: <code>${eid}</code>\n🔔 Kuzatuvchilarga xabar yuborilmoqda: ${users.length}`, { reply_markup: adminMenu() });
  },

  // --- O'chirish ---
  async del(ctx) {
    const aid = parsePositive(txt(ctx));
    if (!aid) return ctx.reply("❌ ID raqam bo'lsin.");
    const a = await q.getAnime(aid);
    if (!a) return ctx.reply("❌ Anime topilmadi.");
    await q.deleteAnime(aid); states.delete(ctx.from.id);
    await ctx.reply(`🗑 <b>${esc(a.title)}</b> o'chirildi.`, { reply_markup: adminMenu() });
  },

  // --- Tahrirlash ---
  async ed_aid(ctx, st) {
    const aid = parsePositive(txt(ctx));
    if (!aid) return ctx.reply("❌ ID raqam bo'lsin.");
    const a = await q.getAnime(aid);
    if (!a) return ctx.reply("❌ Anime topilmadi.");
    go(st, "ed_title", { anime_id: aid, old: a }); await ctx.reply(`✏️ Yangi nom (${esc(a.title)}):`);
  },
  async ed_title(ctx, st) { const t = await requireText(ctx); if (!t) return; go(st, "ed_desc", { title: t }); await ctx.reply("📝 Yangi tavsif (- = bo'sh):"); },
  async ed_desc(ctx, st) { const t = txt(ctx); go(st, "ed_genre", { description: t === "-" ? "" : t }); await ctx.reply("🎭 Yangi janrlar:"); },
  async ed_genre(ctx, st) { go(st, "ed_year", { genre: txt(ctx) }); await ctx.reply("📅 Yangi yil (0 = noma'lum):"); },
  async ed_year(ctx, st) {
    const y = parseYear(txt(ctx));
    if (y === null) return ctx.reply("❌ Noto'g'ri yil.");
    go(st, "ed_status", { year: y }); await ctx.reply("📌 Yangi holat:");
  },
  async ed_status(ctx, st) {
    go(st, "ed_poster", { status: txt(ctx) || "Ongoing" });
    await ctx.reply("🖼 Yangi poster yuboring, <code>-</code> (posterni olib tashlash) yoki /skip (poster o'zgarmasin).");
  },
  async ed_poster(ctx, st) {
    const d = st.data, t = txt(ctx);
    let poster;
    if (ctx.msg.photo) poster = ctx.msg.photo.at(-1).file_id;
    else if (t === "/skip") poster = d.old.poster_file_id || "";
    else if (t === "-") poster = "";
    else return ctx.reply("❌ Rasm yuboring, - yoki /skip.");
    await q.updateAnime(d.anime_id, d.title, d.description, poster, d.genre, d.year, d.status);
    states.delete(ctx.from.id);
    await ctx.reply("✅ Anime yangilandi.", { reply_markup: adminMenu() });
  },

  // --- Broadcast (copyMessage: formatlash, rasm va videoni saqlaydi) ---
  async broadcast(ctx) {
    states.delete(ctx.from.id);
    const users = await q.allUserIds();
    const { id: chatId } = ctx.chat, msgId = ctx.msg.message_id;
    await ctx.reply(`📣 Yuborish boshlandi: ${users.length} ta foydalanuvchi...`);
    background(async () => {
      let sent = 0, failed = 0;
      for (const uid of users) {
        try {
          try { await ctx.api.copyMessage(uid, chatId, msgId); }
          catch (e) {
            if (e?.error_code === 429) { await sleep((e.parameters?.retry_after ?? 1) * 1000 + 200); await ctx.api.copyMessage(uid, chatId, msgId); }
            else throw e;
          }
          sent++;
        } catch { failed++; }
        await sleep(50);
      }
      await ctx.api.sendMessage(chatId, `📣 <b>Tugadi</b>\n\n✅ ${sent}\n❌ ${failed}`, { reply_markup: adminMenu() });
    });
  },
};

bot.on("message", async (ctx, next) => {
  const st = states.get(ctx.from.id);
  if (!st) return next();
  const handler = steps[st.step];
  if (!handler) { states.delete(ctx.from.id); return next(); }
  if (st.step.match(/^(aa|ae|ed|del|broadcast)/) && !isAdmin(ctx.from.id)) { states.delete(ctx.from.id); return; }
  await handler(ctx, st);
});

bot.catch((err) => console.error("Xato:", err.error ?? err));

// ---------- Ishga tushirish ----------
let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  try { await bot.stop(); await q.closeDb(); } catch { /* ignore */ }
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

try {
  await bot.start({ onStart: (me) => console.log(`Anique Dubbing bot ishga tushdi: @${me.username}`) });
} catch (e) {
  // Masalan: deploy paytida eski nusxa bilan to'qnashuv (409). Render servisni o'zi qayta ishga tushiradi.
  console.error("Polling to'xtadi:", errText(e));
  process.exit(1);
}