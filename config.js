// .env faylini o'qish (Node 20.12+ da o'rnatilgan, dotenv kerak emas)
try { process.loadEnvFile(); } catch { /* .env yo'q bo'lsa, tizim env ishlatiladi (Render) */ }

export const BOT_TOKEN = (process.env.BOT_TOKEN || "").trim();
export const ADMIN_IDS = new Set(
  (process.env.ADMIN_IDS || "").split(",").map((x) => x.trim()).filter((x) => /^\d+$/.test(x)).map(Number)
);
export const REQUIRED_CHANNEL = (process.env.REQUIRED_CHANNEL || "").trim();
export const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
export const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
export const PORT = Number(process.env.PORT) || 3000; // Render PORT ni o'zi beradi
export let CHANNEL_URL = (process.env.CHANNEL_URL || "").trim();
if (!CHANNEL_URL && REQUIRED_CHANNEL.startsWith("@")) {
  CHANNEL_URL = "https://t.me/" + REQUIRED_CHANNEL.slice(1);
}