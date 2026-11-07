# MONO Audio Studio

Website responsif (hitam-putih), mendukung mode lokal dan hosting publik, untuk konversi audio, upload Roblox Open Cloud, dan status moderasi. Tanpa dependencies NPM, frontend framework, atau emoji/icon library. Semua ikon SVG dibuat manual.

## Persiapan

- **Node.js 20 atau lebih baru** (disarankan Node 22+)
- **FFmpeg** dan **FFprobe** sudah ada di PATH (`ffmpeg -version`, `ffprobe -version`)
- **yt-dlp** di PATH (`yt-dlp --version`) untuk memproses URL YouTube/SoundCloud. Tidak dibutuhkan jika hanya mengunggah file lokal.
- **Roblox Open Cloud API key** untuk Direct Upload. Buat di Creator Hub dengan izin **asset:read** dan **asset:write** serta hak akses creator. Audio harus legal Anda gunakan. Tidak perlu Roblox cookie / password.

### Instalasi cepat (Windows)

1. Instal Node.js LTS dari https://nodejs.org/.
2. Instal FFmpeg agar perintah `ffmpeg` dan `ffprobe` dikenali terminal. Salah satu cara lewat `winget install Gyan.FFmpeg` dan buka ulang terminal.
3. Opsional untuk link: instal yt-dlp dari https://github.com/yt-dlp/yt-dlp (misalnya `winget install yt-dlp.yt-dlp`), lalu buka ulang terminal.
4. Salin `.env.example` menjadi `.env`, isi `ROBLOX_API_KEY`, `ROBLOX_CREATOR_ID`, dan `ROBLOX_CREATOR_TYPE` (`user` atau `group`). Pastikan key punya izin akses owner yang benar.
5. Buka terminal di folder ini:

   ```sh
   node server.mjs
   ```

6. Kunjungi **http://127.0.0.1:3000** di browser.

Anda boleh menguji **Convert** tanpa API key Roblox. **Upload** akan nonaktif sampai API key dikonfigurasi. Untuk link YouTube/SoundCloud diperlukan yt-dlp; konten tertentu bisa gagal karena pembatasan platform.

### Alur penggunaan

1. Isi URL **atau** pilih file lokal, atur speed 0.75–1.50x, gain −6–+12 dB, dan format MP3/OGG/WAV. Centang hak penggunaan audio, lalu **Convert Audio**.
2. Ketika status `Ready`, tekan Download atau Use for upload. Hasil tersimpan lokal selama maksimal 24 jam.
3. Di panel Upload, masukkan nama/deskripsi, pilih hasil konversi atau file sendiri, konfirmasi hak audio, lalu **Upload to Roblox**.
4. Status riil Open Cloud tampil di Activity: `Uploading`, `Pending`, `Approved`, atau `Rejected`. Proses dan moderasi bisa berlangsung berbeda waktu. Setelah mendapatkan `Asset ID`, gunakan `rbxassetid://ID` di Roblox Studio. Situs ini melakukan polling status ketika halaman dibuka (setiap 12 detik) dan ada tombol cek manual.

### Batasan dan keamanan

- Mode lokal hanya diakses pada `127.0.0.1`. Mode publik (HOST=0.0.0.0) memerlukan `APP_PASSWORD` dan menggunakan sesi login serta pembatasan percobaan masuk. Didesain untuk satu pemilik pribadi, bukan layanan multi-akun.
- API key hanya dibaca oleh backend dari `.env`, tidak pernah dimasukkan ke halaman HTML / JavaScript browser.
- Hanya upload audio **<20 MB**, durasi **≤7 menit**, sample rate **≤48kHz**, tipe MP3/OGG/WAV/FLAC sesuai syarat Open Cloud Roblox. Limit akun Roblox dan moderasi tetap berlaku.
- Tidak ada cara memaksa approval moderasi. Status `Approved` hanya ditampilkan jika Roblox mengembalikan status disetujui. Ketika Roblox belum memberi keputusan, tetap `Pending`.
- Konversi membutuhkan sumber yang Anda miliki hak atau izinnya. Pastikan download diizinkan oleh ketentuan platform dan hak cipta.
- Hasil konversi ada di `storage/`; riwayat lokal di `data/jobs.json`. Jangan membagikan folder `.env`, `storage`, atau `data` ke publik. Proses yang sedang berjalan saat server dimatikan perlu diulang; untuk upload yang terputus periksa Creator Dashboard sebelum mengulang agar tidak duplikat.
- Semua input URL dibatasi ke HTTPS YouTube / SoundCloud, tanpa menjalankan shell dari input, dan proses dibatasi ukuran/durasi.

### Struktur

```text
MonoAudioStudio/
  server.mjs            # HTTP API, FFmpeg/yt-dlp, Roblox Open Cloud, polling
  .env.example          # template kredensial
  public/
    index.html          # dashboard + ikon SVG
    styles.css          # UI responsive monochrome + gradients
    app.js              # interaksi frontend
    favicon.svg         # ikon SVG kustom
  data/                 # job history (dibuat otomatis)
  storage/              # audio hasil konversi (dibuat otomatis)
```

Dokumentasi resmi:
- https://create.roblox.com/docs/cloud/guides/usage-assets
- https://create.roblox.com/docs/cloud/reference/features/assets
- https://create.roblox.com/docs/audio/assets

## Deploy online: Render

Aplikasi ini sudah mendukung hosting publik, menggunakan login password agar API key Roblox tidak tersedia bagi pengunjung lain.

1. Hubungkan akun **Render** ke ChatGPT, atau unggah folder proyek sebagai repository GitHub lalu buka [Render Dashboard](https://dashboard.render.com/) > **New** > **Blueprint** untuk memilih repository dengan `render.yaml`.
2. Isi `APP_PASSWORD` dengan password yang **kuat dan unik (minimal 12 karakter)** dalam konfigurasi rahasia Render; jangan taruh password di source code.
3. Render membangun aplikasi menggunakan `Dockerfile` (Node.js, FFmpeg/FFprobe, yt-dlp). Tunggu status deploy **Live**; link publik tersedia sebagai `https://<nama-layanan>.onrender.com` (link ditentukan Render, bukan diciptakan manual).
4. Login dengan `APP_PASSWORD`. Fitur Convert dapat berjalan meskipun belum punya API key Roblox.
5. Untuk upload Roblox, tambahkan **Secret environment variables** di Render: `ROBLOX_API_KEY`, `ROBLOX_CREATOR_ID`, `ROBLOX_CREATOR_TYPE=user` (atau `group`) lalu redeploy. Jangan masukkan API key di browser atau repository.

**Penting:** Render Free dapat tidur saat tidak dipakai dan akan menghapus riwayat/file sementara saat restart, redeploy, atau spin down. Untuk penyimpanan permanen gunakan paket berbayar dengan persistent disk dan atur `DATA_DIR` ke path disk yang dipasang. Batasan CPU/RAM gratis dapat mengganggu konversi audio. Jangan bagikan password publik jika hanya Anda yang berhak memakai Roblox Creator account. Akun Roblox mungkin membatasi API key berdasarkan IP; periksa konfigurasi Open Cloud bila upload mengembalikan 403.

## Keamanan saat hosting publik

- Password tidak disimpan di frontend. Setelah login, server memberikan cookie sesi acak `HttpOnly`, `Secure`, dan `SameSite=Strict`, berlaku 24 jam, serta membatasi percobaan login. Sesi akan hilang saat server restart.
- Jangan mengatur `HOST=0.0.0.0` tanpa `APP_PASSWORD` kuat. Server akan menolak startup tanpa password dengan minimal 12 karakter.
- Semua API upload, konversi, status, dan download membutuhkan sesi login pada mode publik. Endpoint `/healthz` tetap terbuka hanya untuk status infrastruktur.
- Host Render HTTPS digunakan untuk melindungi cookie dan password selama transmisi. Jangan memasang aplikasi ini pada HTTP publik tanpa HTTPS.
