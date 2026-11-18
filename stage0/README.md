# Tahap 0 — GitHub Pages, Apps Script, dan Google Sheets

Workflow GitHub Pages membangun halaman utama React/Vite di URL akar dan menyertakan panel uji akses di `/LPJ-Litapdimas/stage0/`. Gunakan panel tersebut untuk matriks uji di bawah. Untuk preview halaman utama, jalankan `pnpm install` lalu `pnpm dev`. Login lokal memerlukan `config.json` di akar checkout dan origin lokal yang terdaftar pada OAuth client. Workflow membuat konfigurasi deployment dari variabel GitHub Actions.

## Deployment uji dari GitHub Pages

Gunakan Google Sheet uji privat yang sudah berisi proyek 2023 dan 2025 serta tiga akun uji. Apps Script membaca data dan memeriksa akun serta peran pada setiap permintaan. Panel GitHub Pages mengirim ID token Google dalam isi POST HTTPS. Token hanya disimpan di memori halaman selama sesi uji. Google mendokumentasikan `tokeninfo` untuk debugging, jadi deployment ini hanya untuk fixture sintetis. [Verifikasi token Google](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).

1. Di **Google Cloud Console → Google Auth Platform**, siapkan branding dan buat OAuth client bertipe **Web application**. Tambahkan `https://syamsudintekno.github.io` pada **Authorized JavaScript origins**. Jika konfigurasi OAuth meminta test users, gunakan ketiga akun uji. Salin **Client ID**. Alur ini tidak memerlukan Firebase, Cloud Run, billing, atau client secret. [Penyiapan Sign in with Google](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).
2. Sebagai pemilik spreadsheet, buat proyek Apps Script mandiri khusus uji. Salin [Code.gs](Code.gs), [appsscript.json](appsscript.json), dan [Index.html](Index.html) dengan nama `Index`. Di **Project Settings → Script properties**, isi `SPREADSHEET_ID` dan `GOOGLE_CLIENT_ID`. Jika memakai proyek Google Cloud standar untuk skrip, aktifkan Google Sheets API di proyek tersebut. Biarkan `CAMPUS_DOMAIN` kosong untuk deployment GitHub Pages. [Advanced Google services](https://developers.google.com/apps-script/guides/services/advanced).
3. Pilih **Deploy → New deployment → Web app**, **Execute as me**, dan **Who has access → Anyone** (`ANYONE_ANONYMOUS`), lalu otorisasi sebagai pemilik. Salin URL `/exec`. Akses ini mengizinkan browser mengirim POST tanpa sesi Apps Script. Apps Script memverifikasi token dan keanggotaan sebelum mengembalikan data proyek. Spreadsheet tetap dibatasi. Jika akun pemilik tidak menyediakan opsi **Anyone**, catat batasan itu sebagai hasil uji. [Deployment Apps Script](https://developers.google.com/apps-script/guides/web).
4. Setelah kode tersedia di branch default repo, pilih **Settings → Pages → Source → GitHub Actions**. Di **Settings → Secrets and variables → Actions → Variables**, isi `STAGE0_APPS_SCRIPT_URL` dengan URL `/exec` dan `STAGE0_GOOGLE_CLIENT_ID` dengan Client ID. Jalankan workflow **Publish Stage 0 test page**. Workflow hanya memublikasikan panel dan konfigurasi klien. Client ID dan URL layanan memang dapat dilihat dari browser. [Workflow GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
5. Buka URL yang dilaporkan workflow. Login sebagai pemilik untuk memastikan POST dari `github.io` bisa membaca respons JSON setelah redirect Apps Script. Jika gagal, periksa **Network** di browser dan catat apakah masalahnya login, izin Sheets, atau pembacaan respons lintas origin. Jalankan skenario akun di matriks bawah dari GitHub Pages. Untuk tautan lama, gunakan URL Pages dengan `?project_id=<ID-A>`. Akun Google di luar undangan yang tokennya sah harus mendapat `FORBIDDEN`. Permintaan tanpa token harus mendapat `UNAUTHENTICATED`. [Redirect Content Service](https://developers.google.com/apps-script/guides/content#redirects).

Sembilan pengujian lokal lulus dengan sesi Google, verifikasi token, dan Sheets yang disimulasikan. Endpoint Apps Script uji mengembalikan JSON `UNAUTHENTICATED` saat menerima POST tanpa token dengan header origin GitHub Pages.

Pada 18 November 2026, [halaman uji GitHub Pages](https://syamsudintekno.github.io/LPJ-Litapdimas/) berhasil dibuka. Setelah login Google sebagai pemilik, browser menampilkan daftar dan detail proyek sintetis 2023 dan 2025 dengan peran `OWNER`. Uji hak tulis dan hak verifikasi pajak untuk proyek 2023 berhasil. Hasil ini memverifikasi bahwa browser GitHub Pages dapat membaca respons Apps Script untuk sesi pemilik. Uji kedua anggota, akun tanpa undangan, perubahan peran dan pencabutan, serta akses langsung ke Sheets dan Drive masih tertunda.

## Menyiapkan uji wizard LPJ-01

Untuk uji penulisan gunakan deployment Apps Script dan spreadsheet privat khusus data sintetis. Tambahkan `Projects.gs` bersama `Code.gs`. Manifest saat ini meminta scope tulis Sheets. Untuk mereproduksi prototipe baca saja, gunakan scope `https://www.googleapis.com/auth/spreadsheets.readonly` dan biarkan `PROJECT_WRITES_ENABLED` kosong.

Pertahankan data fixture, lalu lengkapi header berikut sebelum menjalankan wizard. Kolom pertama setiap tab tetap PK. Baris data lama boleh tetap kosong pada kolom baru.

| Tab | Header |
| --- | --- |
| `projects` | `project_id, fiscal_year, title, project_code, official_ceiling_amount, status, active_budget_version_id, row_version, created_at, updated_at` |
| `project_people` | `project_person_id, project_id, person_id, assignment_role, row_version, created_at, updated_at` |
| `report_stages` | `report_stage_id, project_id, sequence_no, label, target_bps, cutoff_date, status, row_version, created_at, updated_at` |
| `audit_log` | `audit_id, request_id, user_id, project_id, action, entity_type, entity_id, occurred_at, change_summary` |
| `mutation_requests` | `request_id, user_id, action, payload_digest, result_ref, status, row_version, created_at, updated_at` |

Jika header pertama `project_people` lama adalah `project_id`, sisipkan kolom `project_person_id` di depannya dan berikan UUID unik pada setiap penugasan lama. Setelah deployment uji menunjuk ke spreadsheet sintetis dan skemanya siap, set Script Property `PROJECT_WRITES_ENABLED=true`. Buka halaman sebagai pemilik dan uji simpan draf, aktivasi, serta penolakan dari akun anggota.

## Menyiapkan uji impor Master Personel LPJ-02

Tambahkan `PeopleImport.gs` bersama `Code.gs` dan `Projects.gs` pada deployment uji sintetis dengan scope tulis. Gunakan tab `audit_log` dan `mutation_requests` di atas. Lengkapi header `people` menjadi `person_id, person_kind, display_name, nip, nim, unit_name, civil_service_grade, active, row_version, created_at, updated_at`. Tetapkan `active` sebagai boolean `TRUE` pada entri sintetis lama yang masih aktif. Aktifkan Script Property `PEOPLE_IMPORT_ENABLED=true` untuk menampilkan impor bagi pemilik.

Unduh tab sumber sebagai CSV, atau gunakan XLSX dengan tab sumber di posisi pertama. Berkas dosen dengan header `NIP`, `NAMA`, `UNIT`, dan `PANGKAT` dipetakan ke NIP, nama, unit, dan golongan dengan kategori `DOSEN`. Subheader PDDIKTI atau golongan dilewati. Untuk format kanonik, gunakan nama kolom pada skema `people` dan isi jenis personel. Sertakan UUID teks, NIP, atau NIM untuk deduplikasi. Simpan kolom ID sebagai teks di Excel. Buka **Master Personel → Impor personel → Pratinjau**, periksa nomor baris, lalu impor baris valid. Batasnya 1.000 baris dan 5 MB per berkas.

Gunakan data dosen asli setelah deployment mempunyai verifikasi identitas produksi dan penyimpanan berakses terbatas. Data sumber dan hasil impor disimpan di luar repositori.

## Menyiapkan uji versi RAB LPJ-03

Tambahkan `Budgets.gs` pada deployment sintetis yang sudah menyiapkan tab `projects`, `audit_log`, dan `mutation_requests`. Buat tab di bawah dan tetapkan `BUDGETS_ENABLED=true` setelah skema siap.

| Tab | Header |
| --- | --- |
| `budget_versions` | `budget_version_id, project_id, version_no, status, approved_by_user_id, approved_at, row_version, created_at, updated_at` |
| `budget_categories` | `budget_category_id, budget_version_id, category_code, label, sort_order, row_version, created_at, updated_at` |
| `budget_items` | `budget_item_id, budget_category_id, label, volume, frequency, unit, unit_price_amount, row_version, created_at, updated_at` |

Buka proyek draf atau aktif yang memiliki plafon resmi. Buat dan sahkan versi pertama, susun revisi dari versi itu, lalu sahkan revisinya. Pastikan versi sebelumnya berstatus **Digantikan** dan rincian lamanya masih dapat dibaca. Uji editor dapat membuat draf tetapi ditolak saat mengesahkan, serta pembaca hanya dapat membuka riwayat proyek yang ditugaskan.

## Prototipe awal HTML Service

Langkah deployment di bawah berlaku untuk reproduksi prototipe awal. Gunakan proyek Apps Script tersendiri, ubah `webapp.access` di manifest menjadi `DOMAIN` dan gunakan scope Sheets baca saja untuk skenario tersebut.

Prototipe LPJ-09 membaca dua proyek sintetis, A tahun 2023 dan B tahun 2025. Anggota A adalah `EDITOR` proyek A dan anggota B adalah `VIEWER` proyek B. PPK, Bendahara Pengeluaran, dan mahasiswa terkait melalui `people` dan `project_people`. Fixture akun aplikasi hanya berisi pemilik dan dua anggota.

HTML Service memanggil `dispatch` melalui `google.script.run`. Setiap RPC memakai email dari `Session.getActiveUser()` dan membaca status akun serta keanggotaan dari spreadsheet privat. `projects.list` mengembalikan seluruh proyek yang diizinkan dalam fixture kecil ini. `stage0.write_probe` dan `taxes.verify` hanya mengembalikan hasil pemeriksaan hak. Pemilik mengubah peran dan status pencabutan melalui spreadsheet. Berkas ini memakai panel HTML sederhana untuk uji transport serta otorisasi.

## Uji lokal

Jalankan `node --test stage0/access.test.cjs` dari akar repositori dengan Node.js 18 atau lebih baru. Pengujian menjalankan `Code.gs` dengan layanan Google disimulasikan, memakai TSV yang sama dengan panduan deployment.

## Deployment uji dengan akun Google Workspace

1. Masuk sebagai akun Workspace kampus yang menjadi pemilik uji. Buat spreadsheet privat dan folder Drive privat berisi satu berkas bukti dummy. Atur **General access → Restricted** untuk keduanya dan pastikan akses induk serta grup kampus tidak memberi anggota akses langsung. Bila memungkinkan, gunakan akun pemilik uji yang hanya memiliki akses ke berkas pengujian. Prototipe memakai scope `userinfo.email` dan `spreadsheets.readonly`. Folder Drive hanya dipakai untuk memeriksa izin langsung dan tidak memerlukan scope Drive pada skrip. [Scope Google Sheets API](https://developers.google.com/workspace/sheets/api/scopes).
2. Buat lima tab dengan nama yang sama dengan berkas di [fixtures](fixtures/), tanpa ekstensi. Tempel tiap TSV mulai A1 pada tabnya, lalu pastikan nilai terpisah per kolom. Di tab `users`, ganti email contoh dengan email primer aktual milik akun deployer, anggota A, dan anggota B yang berada pada domain yang sama. Pastikan nilai `active` bertipe boolean `TRUE`, misalnya dengan memasukkan rumus `=TRUE()` jika hasil tempel berupa teks. Pastikan kolom `revoked_at` kedua anggota kosong. Email aktual dan ID berkas hanya disimpan di lingkungan uji privat.
3. Buat proyek Apps Script mandiri milik akun yang sama. Tempel [Code.gs](Code.gs) ke berkas skrip dan buat berkas HTML bernama `Index` dari [Index.html](Index.html). Di **Project Settings**, tampilkan manifest, lalu salin [appsscript.json](appsscript.json). Manifest mengaktifkan advanced service Sheets v4. Jika skrip memakai proyek Google Cloud standar, aktifkan Google Sheets API di proyek tersebut. Tambahkan Script Properties `SPREADSHEET_ID` dari URL spreadsheet dan `CAMPUS_DOMAIN` dengan domain email primer kampus tanpa karakter `@`. [Advanced Google services](https://developers.google.com/apps-script/guides/services/advanced).
4. Pilih **Deploy → New deployment → Web app**. Pilih **Execute as me** (`USER_DEPLOYING`) dan akses dalam domain kampus (`DOMAIN`), lalu beri izin sebagai deployer. Bagikan URL versi `/exec` ke kedua anggota uji. URL `/dev` hanya bisa dibuka editor proyek skrip. Jalankan uji dengan profil browser terpisah untuk tiap akun. Jika opsi domain tidak tersedia atau email anggota kosong, catat hasilnya untuk evaluasi hosting. Email kosong harus menghasilkan `UNAUTHENTICATED` jika RPC sampai ke aplikasi. [Deployment web app](https://developers.google.com/apps-script/guides/web), [konfigurasi manifest](https://developers.google.com/apps-script/manifest/web-app-api-executable), [perilaku Session](https://developers.google.com/apps-script/reference/base/session).
5. Jalankan matriks secara berurutan. Simpan versi deployment, mode eksekusi, cakupan akses, hasil aktual tiap baris dan letak penolakan di catatan privat. Gunakan label akun saat merangkum hasil di repositori. Setelah uji, arsipkan deployment melalui **Deploy → Manage deployments**. [Pengelolaan deployment](https://developers.google.com/apps-script/concepts/deployments).

## Matriks verifikasi

Proyek A memakai ID `20000000-0000-4000-8000-000000000001` dan proyek B memakai ID `20000000-0000-4000-8000-000000000002`. Form menerima ID secara langsung, termasuk proyek di luar daftar. Setiap tombol mengirim aksi ke server sehingga keputusan dapat diamati dari respons RPC.

| Kasus | Langkah dan hasil yang diharapkan | Lokal | Google sungguhan |
| --- | --- | --- | --- |
| Pemilik | Baca kedua proyek. Kedua pemeriksaan hak berhasil pada masing-masing proyek. | Lulus | Belum dijalankan |
| Anggota A | Daftar hanya memuat 2023. Baca A sebagai `EDITOR` dan jalankan uji hak tulis untuk A. Keduanya berhasil. | Lulus | Belum dijalankan |
| Anggota B | Daftar hanya memuat 2025. Baca B sebagai `VIEWER`. Uji hak tulis untuk B menghasilkan `FORBIDDEN`. | Lulus | Belum dijalankan |
| Lintas proyek | Sebagai B, masukkan ID A dan tekan **Baca proyek**. Ulangi sebagai A dengan ID B. Server mengembalikan `FORBIDDEN`. | Lulus | Belum dijalankan |
| Verifikasi pajak | Sebagai masing-masing anggota, tekan **Uji hak verifikasi pajak** untuk proyek yang ditugaskan. Server mengembalikan `FORBIDDEN`. | Lulus | Belum dijalankan |
| Turun ke baca saja | Biarkan tab A terbuka. Sebagai pemilik, ubah `project_role` A menjadi `VIEWER` dan tunggu Sheets menyimpan perubahan. Pada tab yang sama, baca A dan ulangi uji hak tulis. Baca berhasil dan uji hak tulis menghasilkan `FORBIDDEN`. | Lulus | Belum dijalankan |
| Pencabutan | Sebagai pemilik, isi `revoked_at` A dengan waktu UTC ISO 8601 dan tunggu Sheets menyimpan perubahan. Sebagai A, jalankan ulang baca proyek dan daftar proyek pada tab lama. Baca menghasilkan `FORBIDDEN` dan daftar kosong. Buka kembali tautan `/exec?project_id=<ID-A>` dan pastikan baca juga ditolak. | Lulus untuk RPC | Tab dan tautan lama belum diuji |
| Akun tanpa undangan dan personel LPJ | Pastikan detail proyek menampilkan PPK, Bendahara Pengeluaran, dan mahasiswa proyek itu. Coba URL uji dengan akun kampus yang tidak ada di `users`. Server mengembalikan `FORBIDDEN` bila identitas tersedia. Gunakan akun tanpa undangan sebagai pengganti akun personel. | Lulus | Belum dijalankan |
| Identitas kosong dan akun luar | Buka `/exec` tanpa sesi dan dengan akun luar bila tersedia. Google seharusnya meminta login atau menolak akses. Jika RPC menerima email kosong, hasilnya `UNAUTHENTICATED`. Jika RPC menerima email luar, hasilnya `FORBIDDEN`. Catat apakah penolakan terjadi di Google atau di aplikasi. | Lulus untuk RPC | Belum dijalankan |
| Akses langsung ke berkas | Buka URL spreadsheet, folder bukti, dan berkas dummy sebagai pemilik lalu sebagai anggota A dan B. Pemilik dapat membukanya dan kedua anggota ditolak langsung. | Memerlukan akun Google | Belum dijalankan |

Untuk GitHub Pages, uji ulang matriks otorisasi dari origin `github.io` memakai transport yang mendukung identitas Google di server. Catat hasil aktual dan keputusan transport di [arsitektur](../ARCHITECTURE.md).
