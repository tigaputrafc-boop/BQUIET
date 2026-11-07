# MONO Audio Studio — Cloudflare Pages

Website minimalis hitam-putih untuk **konversi audio lokal di browser**, **upload ke Roblox Open Cloud**, dan **tracking status Roblox**. Frontend tidak menggunakan emoji; ikon SVG dirancang khusus. Tidak perlu Node.js atau FFmpeg pada server Cloudflare.

## Deploy (GitHub ke Cloudflare Pages)

1. Masuk ke https://dash.cloudflare.com/ → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**.
2. Sambungkan GitHub dan pilih repositori `tigaputrafc-boop/BQUIET` (branch `main`).
3. **Framework preset:** None.
4. **Build command:** `npm run build`.
5. **Build output directory:** `public`.
6. **Root directory:** `/` atau kosong (repo root).
7. Pilih **Save and Deploy**. Cloudflare memberikan URL `https://<nama-proyek>.pages.dev` setelah selesai.

Untuk upload Roblox, buka Pages project → **Settings → Variables and Secrets** (nama menu bisa berubah), lalu buat variabel berikut pada **Production**:

| Nama variabel | Nilai | Secret? |
|---|---|---|
| `APP_PASSWORD` | Password akses pribadi, minimal 12 karakter, yang **kamu pilih sendiri** | Ya |
| `ROBLOX_API_KEY` | Roblox Open Cloud API key dengan izin `asset:read`, `asset:write` | Ya |
| `ROBLOX_CREATOR_ID` | ID User atau Group Roblox | Biasanya tidak |
| `ROBLOX_CREATOR_TYPE` | `user` (default) atau `group` | Tidak |

Setelah mengisi variabel, **redeploy** project. Jangan pernah memasukkan API key ke GitHub, JavaScript browser, atau obrolan. Gunakan Secret setting Cloudflare.

Jika variabel belum diisi, converter lokal masih bisa digunakan secara publik tetapi upload Roblox nonaktif. Setelah APP_PASSWORD diisi, website menggunakan login pribadi dan cookie ditandatangani untuk melindungi area utama dan API.

## Fitur dan batasan

- **Convert:** file lokal MP3/OGG/WAV/FLAC/M4A (maks. **25 MB**); output MP3/OGG/WAV, speed 0,75–1,5×, gain -6 hingga +12 dB. Semua konversi menggunakan `@ffmpeg/ffmpeg` di **browser pengguna**. Unduhan WebAssembly pertama kali sekitar 30 MB; konversi di ponsel bisa lambat dan memakai memori besar.
- **Tidak ada konversi URL YouTube/SoundCloud** pada versi Cloudflare. URL membutuhkan layanan downloader di luar Cloudflare Pages Functions.
- **Upload:** file MP3/OGG/WAV yang lebih kecil dari 20 MB, dengan izin pemilik dan durasi ideal <= 7 menit; request diteruskan melalui Pages Function ke Roblox. Audio belum tentu langsung approved: moderasi Roblox punya prosesnya sendiri.
- **Status:** query Open Cloud Operation dan Asset API. `pending` ketika belum ada keputusan moderasi; `approved`/`rejected` hanya saat datanya memang tersedia.
- **Activity:** tersimpan di localStorage browser, hasil audio tersimpan di IndexedDB. Riwayat tidak dibagikan antar perangkat atau akun, dan dapat hilang jika data browser dibersihkan.
- Paket gratis Cloudflare Pages/Workers punya limit permintaan; API Roblox juga bisa mempunyai batas pengguna/asset.

## Struktur

- `public/` — UI dan JavaScript browser.
- `functions/_middleware.js` — perlindungan halaman dan API.
- `functions/api/` — login, config, upload, status.
- `scripts/build.mjs` — menyalin berkas wrapper FFmpeg dari `node_modules` ke `public/vendor/`.
- `package.json` — hanya dependensi build; **tidak ada backend Node di Cloudflare**.

## Tes lokal

Untuk build wrapper FFmpeg: `npm install && npm run build`. Jalankan Cloudflare Pages Functions menggunakan Wrangler (`npx wrangler pages dev public`) agar endpoint `/api/*` berfungsi. HTTP server statis biasa hanya menampilkan UI tanpa Pages Functions.

## Keamanan

Jangan set APP_PASSWORD/ROBLOX_API_KEY sebagai plaintext di repository. Gunakan Cloudflare secrets. Konfigurasi password menciptakan private workspace sederhana; untuk penggunaan publik multiuser perlu autentikasi yang lebih kuat, rate limiting, dan pengaturan kuota per pengguna. Cloudflare Access juga dapat digunakan sebagai lapisan tambahan.
