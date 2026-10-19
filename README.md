# Anique Dubbing Telegram Bot (Node.js + Supabase)

Node.js **24.21.0**, baza: **Supabase (Postgres)**, hosting: **Render (Web Service, Free)**,
uyg'oq tutish: **UptimeRobot**.

## Imkoniyatlar
Katalog, mashhur, yangi, janrlar, qidirish (kirill/lotin), anime -> fasl/qism -> video, sevimlilar,
yangi qism kuzatuvi, reyting, "davom ettirish", admin panel (qo'shish/tahrirlash/o'chirish, statistika),
takliflar, kanalga obuna tekshiruvi, broadcast (matn/rasm/video), /id, /cancel.

## 1. Supabase
1. supabase.com -> New project. **Database password** ni yaxshilab saqlang.
2. Loyiha ichida yuqoridagi **Connect** tugmasi -> **Session pooler** connection string'ni nusxalang.
   - `[YOUR-PASSWORD]` o'rniga parolni qo'ying (maxsus belgilar bo'lsa URL-kodlash kerak: `@` -> `%40`).
   - Render IPv4 ishlatadi, shuning uchun to'g'ridan-to'g'ri `db.xxx.supabase.co` manzili **ishlamaydi**, pooler kerak.
3. Jadvallarni qo'lda yaratish shart emas: bot birinchi ishga tushganda o'zi yaratadi va RLS ni yoqadi.

## 2. GitHub
Loyihani GitHub'ga yuklang (`.env` va `node_modules` `.gitignore` da, tokenni hech qachon yuklamang).

## 3. Render
New -> **Web Service** -> reponi tanlang.
- Build Command: `npm install`
- Start Command: `npm start`
- Instance Type: **Free**
- Environment variables:

| Nomi | Qiymati |
|---|---|
| `NODE_VERSION` | `24.21.0` |
| `BOT_TOKEN` | BotFather tokeni |
| `ADMIN_IDS` | Telegram ID'ingiz (vergul bilan bir nechta) |
| `DATABASE_URL` | Supabase pooler string |
| `REQUIRED_CHANNEL` | ixtiyoriy, masalan `@kanal` |
| `CHANNEL_URL` | kanal havolasi |

`PORT` ni Render o'zi beradi. Logs'da `Anique Dubbing bot ishga tushdi: @...` chiqishi kerak.

## 4. UptimeRobot
uptimerobot.com -> Add New Monitor -> **HTTP(s)**, URL: `https://SIZNING-NOM.onrender.com`,
interval: **5 daqiqa**. Bepul Render servisi 15 daqiqa so'rovsiz qolsa uxlaydi, UptimeRobot buni oldini oladi.

## Lokal ishga tushirish
```bash
npm install
cp _env.example .env    # to'ldiring
npm start
```
Lokal va Render'dagi bot **bir vaqtda** ishlamasin (bitta token bilan ikki polling = 409 xatosi).

## Cheklovlar
- Render bepul servisini vaqti-vaqti bilan (deploy, texnik ish) qayta ishga tushirishi mumkin. Baza Supabase'da, shuning uchun ma'lumot yo'qolmaydi, lekin admin yarim yo'lda turgan jarayon (masalan, anime qo'shish) bekor bo'ladi, `/admin` dan qayta boshlanadi.
- Bepul workspace'da oyiga 750 soat bor: bu bitta servisni 24/7 ushlashga yetadi, ikkinchi bepul servis qo'shmang.
- Bir klaviaturada 100 tadan ortiq tugma bo'lmaydi (katta ro'yxatlar uchun sahifalash kerak bo'ladi).
