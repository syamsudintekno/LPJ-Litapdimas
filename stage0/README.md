# Tahap 0 — GitHub Pages, Apps Script, dan Google Sheets

Workflow GitHub Pages membangun halaman utama React/Vite di URL akar dan menyertakan panel uji akses di `/LPJ-Litapdimas/stage0/`. Gunakan panel tersebut untuk matriks uji di bawah. Untuk preview halaman utama, jalankan `pnpm install` lalu `pnpm dev`. Login lokal memerlukan `config.json` di akar checkout dan origin lokal yang terdaftar pada OAuth client. Workflow membuat konfigurasi deployment dari variabel GitHub Actions.

## Deployment uji dari GitHub Pages

Gunakan Google Sheet uji privat yang sudah berisi proyek 2023 dan 2025 serta tiga akun uji. Apps Script membaca data dan memeriksa akun serta peran pada setiap permintaan. Panel GitHub Pages mengirim ID token Google dalam isi POST HTTPS. Token hanya disimpan di memori halaman selama sesi uji. Google mendokumentasikan `tokeninfo` untuk debugging, jadi deployment ini hanya untuk fixture sintetis. [Verifikasi token Google](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).

1. Di **Google Cloud Console → Google Auth Platform**, siapkan branding dan buat OAuth client bertipe **Web application**. Tambahkan `https://syamsudintekno.github.io` pada **Authorized JavaScript origins**. Jika konfigurasi OAuth meminta test users, gunakan ketiga akun uji. Salin **Client ID**. Alur ini tidak memerlukan Firebase, Cloud Run, billing, atau client secret. [Penyiapan Sign in with Google](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).
2. Sebagai pemilik spreadsheet, buat proyek Apps Script mandiri khusus uji. Salin [Code.gs](Code.gs), [appsscript.json](appsscript.json), dan [Index.html](Index.html) dengan nama `Index`. Di **Project Settings → Script properties**, isi `SPREADSHEET_ID` dan `GOOGLE_CLIENT_ID`. Jika memakai proyek Google Cloud standar untuk skrip, aktifkan Google Sheets API di proyek tersebut. Biarkan `CAMPUS_DOMAIN` kosong untuk deployment GitHub Pages. [Advanced Google services](https://developers.google.com/apps-script/guides/services/advanced).
3. Pilih **Deploy → New deployment → Web app**, **Execute as me**, dan **Who has access → Anyone** (`ANYONE_ANONYMOUS`), lalu otorisasi sebagai pemilik. Salin URL `/exec`. Akses ini mengizinkan browser mengirim POST tanpa sesi Apps Script. Apps Script memverifikasi token dan keanggotaan sebelum mengembalikan data proyek. Spreadsheet tetap dibatasi. Jika akun pemilik tidak menyediakan opsi **Anyone**, catat batasan itu sebagai hasil uji. [Deployment Apps Script](https://developers.google.com/apps-script/guides/web).
4. Setelah kode tersedia di branch default repo, pilih **Settings → Pages → Source → GitHub Actions**. Di **Settings → Secrets and variables → Actions → Variables**, isi `STAGE0_APPS_SCRIPT_URL` dengan URL `/exec` dan `STAGE0_GOOGLE_CLIENT_ID` dengan Client ID. Jalankan workflow **Publish Stage 0 test page**. Workflow hanya memublikasikan panel dan konfigurasi klien. Client ID dan URL layanan memang dapat dilihat dari browser. [Workflow GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
5. Buka URL yang dilaporkan workflow. Login sebagai pemilik untuk memastikan POST dari `github.io` bisa membaca respons JSON setelah redirect Apps Script. Jika gagal, periksa **Network** di browser dan catat apakah masalahnya login, izin Sheets, atau pembacaan respons lintas origin. Jalankan skenario akun di matriks bawah dari GitHub Pages. Untuk tautan lama, gunakan URL Pages dengan `?project_id=<ID-A>`. Akun Google di luar undangan yang tokennya sah harus mendapat `FORBIDDEN`. Permintaan tanpa token harus mendapat `UNAUTHENTICATED`. [Redirect Content Service](https://developers.google.com/apps-script/guides/content#redirects).

Sembilan pengujian lokal lulus dengan sesi Google, verifikasi token, dan Sheets yang disimulasikan. Endpoint Apps Script uji mengembalikan JSON `UNAUTHENTICATED` tanpa data saat menerima POST tanpa token dengan header origin GitHub Pages. [Deployment GitHub Pages](https://github.com/syamsudintekno/LPJ-Litapdimas/actions/runs/44133150691) berhasil. Pengguna melaporkan login dan akses dasar pemilik serta kedua anggota berjalan sesuai peran dari browser GitHub Pages. Uji lintas proyek, verifikasi pajak oleh anggota, perubahan peran dalam sesi aktif, pencabutan, akun tanpa undangan, dan akses langsung ke berkas masih menunggu hasil.

## Menyiapkan uji wizard LPJ-01

### Aktivasi fitur setelah struktur deployment siap

Tambahkan `DeploymentSetup.gs` bersama seluruh berkas server terbaru. Helper ini tidak membuat atau mengubah data bisnis. Siapkan tab/header sesuai panduan di bawah terlebih dahulu, lalu buat folder privat `Bukti <project_id>` untuk setiap proyek uji langsung di folder induk spreadsheet. Jika `EVIDENCE_FOLDERS_JSON` sudah berisi pemetaan valid, helper mempertahankannya dan tidak mencari folder berdasarkan nama.

Sebagai pemilik aktif yang tercatat di `users`, buka editor Apps Script, pilih fungsi **setupSyntheticFeatures**, lalu **Run**. Otorisasi scope aplikasi bila Google memintanya. Helper menolak identitas kosong/anggota/nonaktif, spreadsheet yang judulnya tidak memuat `Data Uji`, header yang kurang, serta folder yang publik atau ambigu. Semua pemeriksaan selesai sebelum menulis flag. Helper mengaktifkan sepuluh flag fitur yang sudah diimplementasikan dan menyimpan pemetaan folder pada Script Properties, tanpa menghapus properti lain atau mengubah status/nominal proyek lama. Fungsi dapat dijalankan kembali untuk memeriksa konfigurasi; ini bukan RPC aplikasi dan tidak dipanggil otomatis saat login.

Log hasil sukses berisi `ok:true`, `enabled_features`, dan jumlah proyek. Setelah itu muat ulang GitHub Pages dan login sebagai pemilik. Fixture proyek lama yang belum mempunyai status, plafon, atau versi tetap belum siap untuk alur tulis; lengkapi melalui alur proyek yang sesuai atau buat proyek uji baru. Helper tidak mengarang data agar proyek lama tampak lengkap.

### Wizard proyek

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

## Menyiapkan uji kegiatan LPJ-04

Tambahkan `Activities.gs` bersama `Code.gs`, `Projects.gs`, `PeopleImport.gs`, dan `Budgets.gs` di deployment sintetis. Writer kegiatan memakai helper batch yang sudah ada di `Budgets.gs`. Siapkan `audit_log` dan `mutation_requests` seperti wizard, serta dua tab berikut. Aktifkan `ACTIVITIES_ENABLED=true` setelah skema siap.

| Tab | Header |
| --- | --- |
| `activities` | `activity_id, project_id, activity_kind, title, activity_date, location, status, row_version, created_at, updated_at` |
| `agenda_items` | `agenda_item_id, activity_id, start_time, end_time, title, speaker_person_id, row_version, created_at, updated_at` |

Setelah memperbarui `Code.gs` dan `Activities.gs` serta memublikasikan build frontend terbaru, buka detail proyek. Bagian **Kegiatan dan rundown** tampil jika deployment mengaktifkan fitur. Sebagai pemilik/editor, pilih **Tambah kegiatan**, isi judul, jenis, tanggal dan lokasi, lalu tambahkan sesi berurutan. Pembicara opsional dipilih dari personel proyek. Simpan draf dan periksa detail rundown. Viewer hanya mendapat daftar dan detail. Daftar mendukung pencarian serta delapan kegiatan per halaman.

Untuk menguji RPC langsung, gunakan `activities.save`, ID proyek draf/aktif, UUID `request_id`, serta payload berikut. Server menghasilkan ID kegiatan dan sesi. Pembacaan memakai `activities.list` atau `activities.get` dengan `payload.activity_id` dalam proyek yang sama.

```json
{"activity":{"activity_kind":"FGD","title":"FGD sintetis","activity_date":"2026-11-18","location":"Ruang uji"},"agenda":[{"start_time":"09:00","end_time":"10:00","title":"Diskusi"}]}
```

Uji ulang UUID request yang sama: hasil dan jumlah baris harus tetap sama. Perubahan payload dengan UUID lama menghasilkan `CONFLICT`. Viewer dan anggota proyek lain ditolak saat membuat kegiatan. Tanggal tak sah, jam terbalik, sesi tumpang tindih, dan ID pembicara tak tersedia ditolak. Bila hasil simpan belum diketahui di UI, isian dikunci dan **Coba simpan kembali** memakai request yang sama.

Pengujian lokal browser dengan login/RPC sintetis lulus untuk gagal muat dan muat ulang, pembuatan oleh editor, validasi waktu dan fokus, retry setelah respons terputus, pembacaan rundown, pencarian, pembatasan UI viewer, serta lebar 360 px tanpa gulir horizontal halaman. Tampilan desktop dan mobile juga diperiksa melalui screenshot. Uji Google sungguhan untuk irisan ini belum dijalankan; penyuntingan dan pratinjau cetak dijelaskan pada bagian berikut.

## Menyiapkan uji logbook LPJ-04

Tambahkan `Logbook.gs` bersama berkas server yang sudah ada, termasuk `Budgets.gs` sebagai penyedia helper batch atomik. Perbarui `Code.gs`, siapkan tab `activities` seperti di atas (boleh kosong), serta tab `audit_log` dan `mutation_requests`. Buat tab `logbook_entries` dengan header berikut:

```text
logbook_entry_id, project_id, activity_id, entry_date, description, result, row_version, created_at, updated_at
```

Set `LOGBOOK_ENABLED=true` pada deployment sintetis, perbarui versi web app, lalu publikasikan build Pages terbaru. Di detail proyek, buka **Logbook penelitian → Tambah logbook**. Isi tanggal, uraian dan hasil; pilih kegiatan atau biarkan tanpa kegiatan terkait. Simpan, sunting, lalu periksa isi terbaru. Untuk melihat kegiatan yang baru dibuat pada bagian lain, gunakan **Muat ulang logbook** sebelum memilih kegiatan. Viewer hanya mendapat daftar, pencarian dan halaman baca.

Uji dua pengguna menyunting versi yang sama: penyimpanan kedua harus menghasilkan `CONFLICT` dan tidak menimpa perubahan pertama. Isian tetap tersedia untuk disalin. Batalkan penyuntingan, muat ulang logbook, lalu buka kembali entri untuk memakai versi terbaru. Retry setelah koneksi terputus harus memakai payload dan UUID yang sama serta tidak menambah baris atau audit kedua. Server menolak kegiatan/entri dari proyek lain, akun tanpa hak tulis, tanggal tidak valid, serta penulisan baru pada proyek arsip. Pembacaan arsip dan pengulangan request yang sudah selesai tetap tunduk pada hak akses saat ini.

Pengujian browser dengan login/RPC sintetis juga lulus untuk tambah dan sunting logbook, hubungan kegiatan opsional, retry setelah respons terputus, konflik versi tanpa kehilangan isian, pemuatan versi terbaru, pencarian, UI viewer, dan tata letak 360 px. Uji deployment Google sungguhan masih tertunda.

## Menyiapkan uji peserta dan distribusi LPJ-04

Tambahkan `Participants.gs`, perbarui `Code.gs` dan `Activities.gs`, lalu siapkan tab berikut bersama tab kegiatan, personel, penugasan proyek, audit, serta jurnal permintaan yang sudah ada. Helper batch tetap berada di `Budgets.gs`.

| Tab | Header |
| --- | --- |
| `activity_participants` | `activity_participant_id, activity_id, person_id, attendance_status, row_version, created_at, updated_at` |
| `distributions` | `distribution_id, activity_participant_id, transaction_id, distribution_kind, quantity, received_at, row_version, created_at, updated_at` |

Set `PARTICIPANTS_ENABLED=true` pada deployment sintetis, perbarui versi web app dan build Pages. Buka detail kegiatan untuk melihat **Peserta dan distribusi**. Pilih personel proyek dan buat pratinjau, atau unggah CSV dengan contoh format berikut. `person_id` harus berasal dari Master Personel aktif. CSV tidak membuat personel baru; simpan data asli di luar repo publik.

```csv
person_id,attendance_status
30000000-0000-4000-8000-000000000001,PRESENT
```

Periksa hasil valid/duplikat/koreksi lalu impor peserta valid. Status hadir menerima `UNRECORDED`, `PRESENT`, atau `ABSENT`; kolom kosong menjadi belum dicatat. Impor ulang orang yang sudah terdaftar tidak menimpa status hadir dan distribusinya. Pratinjau kedaluwarsa maksimal 10 menit dan harus dibuat ulang bila isi batch atau hasil pemeriksaan berubah. CSV maksimal 1.000 baris dan 5 MB.

Uji peserta tidak hadir menerima transport, serta peserta hadir belum menerima snack. Catat distribusi per jenis dengan jumlah unit dan waktu WIB. Jumlah 0 menandakan belum diterima/koreksi dan mengosongkan waktu; nominal uang dicatat melalui alur transaksi yang menyusul. Uji simpan bersamaan dengan versi lama harus ditolak, retry request yang sama tidak menambah baris, viewer tidak dapat menyimpan, serta ID kegiatan/peserta lintas proyek ditolak. Uji browser dengan login/RPC sintetis lulus untuk pratinjau/commit CSV, retry dengan UUID/payload yang sama, perubahan hadir terpisah dari transport, konversi WIB ke UTC, pencarian, viewer baca saja, dan 360 px tanpa gulir horizontal halaman. Tampilan desktop/mobile diperiksa melalui screenshot. Pratinjau cetak draf daftar hadir/distribusi tersedia pada bagian berikut; penautan transaksi belum tersedia. Uji Google sungguhan untuk fitur ini masih tertunda.

## Penyuntingan dan pratinjau cetak kegiatan

Perbarui `Activities.gs`, `Budgets.gs`, dan `Code.gs` pada deployment sintetis. Penyuntingan memakai skema kegiatan dan agenda yang sudah ada; pastikan setiap baris memiliki `row_version` integer. Pemilik/editor membuka detail lalu **Sunting kegiatan**. Form menyimpan ID kegiatan, versi induk, dan versi seluruh sesi yang dibaca. Sesi dapat diubah, ditambah, atau dihapus. Konflik mempertahankan isian; batalkan dan muat ulang sebelum membuka versi terbaru. Retry dengan UUID/payload yang sama tidak menerapkan perubahan dua kali. Penyuntingan hanya tersedia untuk kegiatan draf pada proyek draf/aktif.

Tambahkan `ActivityReports.gs`, siapkan seluruh tab kegiatan, agenda, logbook, peserta/distribusi, personel dan proyek sesuai panduan di atas, lalu aktifkan `ACTIVITY_REPORTS_ENABLED=true`. Perbarui web app serta build Pages. **Pratinjau dokumen kegiatan** menampilkan rundown, logbook terkait, daftar hadir, daftar snack, konsumsi, dan transport. Paket hanya memakai data tersimpan untuk kegiatan yang dibuka. Semua pembaca proyek dapat mempratinjau; viewer tetap tidak dapat menyunting.

Pilih **Cetak draf** untuk dialog cetak browser dan penyimpanan PDF. Tabel A4 mengulang header pada halaman lanjutan; shell dan tombol aplikasi tidak ikut dicetak. Kolom tanda tangan dibiarkan kosong. Distribusi hanya memuat penerimaan positif dan total unit, bukan nominal rupiah. Draf ini belum menjadi snapshot/arsip final di Drive. Uji browser sintetis lulus untuk penyuntingan, konflik versi, penggantian sesi, retry, akses viewer, Escape/pemulihan fokus dialog, dan pratinjau mobile. PDF QA dengan 45 peserta serta 12 catatan logbook panjang menghasilkan 10 halaman A4; semua halaman dirender dan diperiksa. Keenam bagian, header tabel berulang, serta pengecualian shell/tombol dari cetak sudah diverifikasi tanpa halaman kosong. Pengujian Google sungguhan dan pencocokan dengan format resmi LPJ masih tertunda.

## Menyiapkan uji draf transaksi LPJ-05

Tambahkan `Transactions.gs` dan perbarui `Code.gs`. Gunakan proyek/spreadsheet sintetis dengan semua tab RAB, kegiatan, penugasan, peserta/distribusi, audit dan jurnal yang sudah ada. Buat tab berikut; tabel pajak/kwitansi boleh kosong, tetapi header tetap diperlukan untuk memeriksa hubungan yang mengunci penyuntingan.

| Tab | Header |
| --- | --- |
| `payees` | `payee_id, payee_kind, person_id, legal_name, tax_profile_ref, row_version, created_at, updated_at` |
| `transactions` | `transaction_id, project_id, budget_item_id, activity_id, payment_date, expense_kind, description, status, row_version, created_at, updated_at, confirmed_by_user_id, confirmed_at` |
| `payment_details` | `payment_detail_id, transaction_id, payee_id, receipt_amount, withheld_tax_amount, added_tax_amount, net_paid_amount, row_version, created_at, updated_at` |
| `tax_assessments` | `tax_assessment_id, payment_detail_id, tax_rule_version_id, tax_kind, tax_treatment, tax_base_amount, amount, status, verified_by_user_id, verified_at, override_reason, decision_source_ref, evidence_attachment_id, evidence_row_version, evidence_drive_file_id, evidence_modified_at, rule_snapshot, row_version, created_at, updated_at, verification_context_digest` |
| `receipts` | `receipt_id, payment_detail_id, project_id, receipt_no, issued_on, status, row_version, created_at, updated_at, sequence_no, issued_by_user_id, template_version, document_snapshot, snapshot_digest` |

Isi payee sintetis dengan UUID stabil, jenis `PERSON`, `ORGANIZATION`, atau `GROUP`, dan nama. Payee `PERSON` dapat merujuk `person_id` dari Master Personel. Pemilik melihat pilihan payee valid; anggota hanya melihat personel/peserta proyek dan payee yang sudah dipakai pada proyeknya. Profil pajak tidak ditampilkan ke browser. Pengelolaan payee melalui UI menyusul.

Sahkan satu RAB agar menjadi versi aktif. Set `TRANSACTIONS_ENABLED=true`, perbarui web app dan build Pages, lalu buka detail proyek → **Transaksi proyek → Tambah transaksi**. Pilih item RAB dan kegiatan bila ada, isi tanggal/tujuan/jenis belanja, lalu pilih 1–30 penerima berbeda. Input nilai kwitansi dan usulan potongan dalam rupiah utuh. Simpan dan periksa contoh Rp900.000, potongan Rp45.000, netto Rp855.000. Server menghitung netto; nilai draf belum masuk total terkonfirmasi.

Uji retry setelah respons terputus: UUID/payload tetap sama dan tidak menambah transaksi atau pembayaran. Uji penyuntingan dua versi bersaing: versi lama ditolak tanpa menimpa perubahan terbaru. Rincian pembayaran juga diperiksa versinya; data yang sudah tertaut penilaian pajak, kwitansi atau distribusi tidak boleh disunting lewat alur ini. Setelah revisi RAB disahkan, draf lama tetap menunjuk item/versi sebelumnya; draf baru harus memilih versi aktif. Viewer hanya membaca dan ID lintas proyek ditolak.

Potongan pada draf ini masih usulan sampai ditinjau melalui alur pajak di bawah. Pajak tambahan nonzero ditolak. Unggah langsung dari aplikasi, setoran dan rekap tahap menyusul. Penerbitan kwitansi tersedia pada alur di bawah. Pengujian browser dengan login/RPC sintetis lulus untuk tambah/sunting draf, retry dengan UUID/payload yang sama, pemulihan konflik versi induk/pembayaran, penambahan/penghapusan penerima, pencarian, akses viewer, dan tampilan 360 px tanpa gulir horizontal. Tampilan desktop/mobile diperiksa melalui screenshot. Belum ada pembaruan atau pengujian deployment Google untuk fitur ini.

## Menyiapkan penilaian dan verifikasi pajak LPJ-06

### Penautan bukti transaksi LPJ-05/06/09

Tambahkan `Attachments.gs`, perbarui `Code.gs`, `Transactions.gs`, dan `Taxes.gs`, lalu siapkan header `attachments` pada tabel di bawah beserta tab transaksi/pembayaran, proyek, penilaian, kwitansi, alokasi setoran, distribusi, audit dan jurnal. Scope Drive tetap baca-saja; layanan tidak mengunggah, menyalin, menghapus, atau membagikan file.

Di Script Properties privat, set `ATTACHMENTS_ENABLED=true` dan `EVIDENCE_FOLDERS_JSON` sebagai objek JSON dari UUID proyek ke ID folder bukti, misalnya `{"20000000-0000-4000-8000-000000000001":"synthetic-evidence-folder-A"}` (ganti nilai contoh dengan ID folder sintetis sungguhan). Jangan masukkan konfigurasi ini ke repository atau config Pages. Setiap proyek memakai folder berbeda. Folder dan berkas harus privat, tidak dibuang, dapat dibaca deployer, dan berkas berada langsung di folder tersebut. Terima PDF/JPEG/PNG maksimal 20 MiB, tanpa shortcut/subfolder.

Pada irisan ini pemilik menyiapkan berkas melalui Drive dan memberi ID/tautan kepada editor proyek bila diperlukan. Hak aplikasi tidak otomatis memberikan akses Drive: pertahankan matriks akses langsung; jangan membagikan folder lintas proyek untuk melewati pembatasan aplikasi. Hanya pemilik mendapat tautan folder dari RPC. Editor dapat membaca metadata bukti dan menautkan ID yang diotorisasi melalui konteks proyek; membuka isi file melalui Drive tetap bergantung izin akun Google tersebut.

Publikasikan ulang web app dan build Pages. Buka transaksi → **Bukti transaksi** → **Tautkan bukti**. Penggantian melalui **Ganti bukti versi …** mempertahankan attachment_id dan menaikkan versi; hanya transaksi draf/proyek aktif atau draf tanpa kwitansi/setoran/distribusi tertaut yang dapat diubah. Penautan bukan verifikasi. Setelah bukti berubah, muat ulang penilaian pajak dan tinjau kembali keputusan. Jangan menimpa baris attachment atau assessment langsung di Sheet untuk menyiasati konflik.

Saat fitur aktif atau pemetaan folder terisi, verifikasi pajak juga menolak bukti yang keluar dari folder atau berubah akses/jenis/ukuran. Sebelum mengaktifkan pada data lama, pindahkan bukti sintetis ke folder proyek yang benar atau ganti tautannya melalui UI; bukti lama di luar folder akan tidak tersedia. Menonaktifkan penautan tidak menghapus pemeriksaan folder yang sudah dikonfigurasi.

Uji pemilik/editor/viewer dan lintas proyek, file publik/di luar folder/di sampah/shortcut/terlalu besar, konflik transaksi serta attachment, dua simpan dengan versi sama, retry setelah respons terputus, dan kegagalan batch. Periksa bahwa perubahan bukti tidak mengubah snapshot/netto keputusan lama dan token pajak lama ditolak. Uji server memakai Drive/Sheets sintetis; uji scope, folder, izin turunan, akses langsung dan deployment Google sungguhan masih tertunda. Unggah langsung dari aplikasi dan salinan arsip final menyusul.

### Penilaian pajak

Tambahkan `Taxes.gs` dan `TaxRules.gs`, perbarui `Code.gs` dan `Transactions.gs`, serta salin manifest terbaru. Manifest menambahkan scope Drive baca-saja untuk memeriksa bukti; pemilik perlu mengotorisasi scope baru saat memperbarui web app. [API metadata File dan scope](https://developers.google.com/apps-script/reference/drive/file). Gunakan deployment dan bukti sintetis privat.

Siapkan atau perluas header berikut. Pertahankan PK pada kolom pertama dan isi `row_version` sebagai integer. Tab transaksi/pembayaran, payee, personel, proyek, kwitansi, distribusi, audit dan jurnal yang sudah ada tetap diperlukan.

| Tab | Header |
| --- | --- |
| `tax_rule_versions` | `tax_rule_version_id, rule_code, version_no, tax_kind, expense_kind, payee_kind, eligibility, base_kind, rate_bps, effective_from, effective_to, source_ref, row_version, created_at, updated_at` |
| `tax_assessments` | `tax_assessment_id, payment_detail_id, tax_rule_version_id, tax_kind, tax_treatment, tax_base_amount, amount, status, verified_by_user_id, verified_at, override_reason, decision_source_ref, evidence_attachment_id, evidence_row_version, evidence_drive_file_id, evidence_modified_at, rule_snapshot, row_version, created_at, updated_at, verification_context_digest` |
| `attachments` | `attachment_id, project_id, activity_id, transaction_id, attachment_kind, drive_file_id, row_version, created_at, updated_at` |
| `tax_remittance_allocations` | `tax_remittance_allocation_id, tax_remittance_id, tax_assessment_id, amount, row_version, created_at, updated_at` |

Setelah `TAXES_ENABLED=true` dan build Pages terbaru dipublikasikan, pemilik mengelola aturan melalui menu **Aturan pajak**. Gunakan **Aturan baru** untuk kode baru dan **Buat versi baru** untuk revisi. Server menetapkan ID dan nomor versi, mempertahankan versi lama, dan menyimpan audit serta jurnal retry. Tanggal mulai/akhir bersifat inklusif, referensi wajib, basis `RECEIPT_AMOUNT`, dan tarif dalam basis point integer. Eligibility di Sheet tersimpan sebagai JSON `{}` atau `{"civil_service_grades":["III/a"]}`; di form golongan dipisahkan koma. Fixture honor 500 basis point (5%) dengan Rp900.000 menghasilkan usulan Rp45.000; ini contoh aritmetika sintetis, bukan aturan pajak produksi. Honor tetap memerlukan personel dosen/pegawai dengan golongan dan payee `tax_profile_ref` terisi. Data profil lainnya ditinjau pemilik berdasarkan sumber/bukti. Tidak ada tarif pajak bawaan, dan konsumsi/snack atau beberapa kode aturan yang sama-sama cocok tetap meminta verifikasi.

Sebelum memperbarui layanan lama, tinjau versi dengan kode sama dan periode beririsan. Preview sekarang memilih versi tertinggi per kode yang mencakup tanggal pembayaran, kemudian memeriksa golongan. Versi lama dapat menjadi acuan di luar periode versi baru jika periodenya masih mencakup tanggal tersebut. Jangan memakai nomor versi sebagai cara menyimpan beberapa golongan paralel; gunakan kode berbeda untuk aturan berbeda. Penilaian yang merujuk versi tergantikan ditandai untuk tinjauan ulang, tanpa mengubah keputusan/netto lama secara otomatis. Baris lama jangan ditimpa atau dihapus.

Uji sebagai pemilik: buat aturan, buka riwayat, buat revisi, dan pastikan baris terdahulu tetap utuh. Coba simpan dari dua tab dengan versi acuan sama: hanya satu yang diterima, tab lain mendapat konflik dan mempertahankan isian. Setelah respons terputus, retry tidak menambah versi kedua. Anggota harus ditolak pada `taxes.list_rules` maupun `taxes.save_rule_version` meski memanggil RPC langsung. Jalankan juga preview pembayaran sebelum/sesudah batas tanggal serta pemeriksaan tinjauan ulang keputusan lama. UI/RPC dan kegagalan batch diuji lokal dengan layanan sintetis; deployment Google untuk pengelolaan aturan belum diuji.

Di `attachments`, tautkan bukti dummy pada `project_id` dan `transaction_id` yang benar, isi `drive_file_id`, jenis bukti, dan versi. Gunakan berkas yang dapat dibaca deployer, tidak berada di sampah, dan dengan kelas akses `PRIVATE`. Pemeriksaan ini tidak menggantikan uji izin individu/berkas induk. Jangan mengubah izin berkas nyata untuk menjalankan fixture. Penautan melalui UI mengikuti langkah di atas; unggah langsung dari aplikasi menyusul.

Set `TAXES_ENABLED=true`, perbarui web app dan build Pages. Pada pembayaran, pilih **Tinjau pajak**. Editor hanya membaca usulan. Pemilik memilih aturan atau keputusan manual, jenis pajak, dasar/nominal, bukti, referensi, dan alasan bila diperlukan. Buka bukti terpilih sebelum menyimpan keputusan. Tidak dikenai pajak harus bernominal 0 dan beralasan. Koreksi sebelumnya juga wajib beralasan. Satu penilaian per pembayaran didukung; penilaian majemuk, pembayaran yang tertaut kwitansi/setoran/distribusi, serta transaksi yang bukan draf tidak diubah lewat alur ini.

Uji perubahan versi, profil, aturan, atau bukti setelah pratinjau: request harus mendapat `CONFLICT` dan isian tetap tersedia. Muat ulang penilaian untuk memakai konteks terbaru. Retry setelah respons terputus memakai UUID/payload yang sama. Verifikasi memperbarui potongan/netto dan versi pembayaran/transaksi secara atomik, tetapi transaksi tetap draf dan total terkonfirmasi tetap tidak berubah. Bukti yang diubah setelah keputusan memerlukan tinjauan ulang. Metadata/rujukan bukti yang disimpan belum berupa snapshot atau arsip file final.

Panel probe Tahap 0 sekarang memakai `stage0.tax_probe`. `taxes.verify` adalah mutasi sungguhan dan tidak lagi mengembalikan sukses yang hanya berarti lolos uji hak. Perbarui juga panel `Index.html`/Pages Tahap 0 bila masih dipakai. Uji browser dengan login/RPC sintetis lulus untuk keputusan pemilik, editor yang hanya mempratinjau, pembatasan viewer, konflik/pemuatan ulang, pemilihan bukti, retry dengan UUID/payload yang sama, alasan koreksi, netto dari server, serta desktop dan 360 px tanpa gulir horizontal. Scope/Drive/Sheets dalam pengujian server masih disimulasikan. Kwitansi bernomor, pajak tambahan, setoran, dan rekap tahap tetap menyusul. Pengujian deployment Google sungguhan masih tertunda.

## Menyiapkan konfirmasi transaksi LPJ-05/06/09

Tambahkan `TransactionConfirmation.gs`, perbarui `Code.gs`, `Transactions.gs`, `Taxes.gs` dan `DeploymentSetup.gs`. Sebelum memublikasikan backend baru, tambahkan kolom **di ujung header**, tanpa menyisipkan di tengah data: `confirmed_by_user_id` dan `confirmed_at` pada `transactions`, serta `verification_context_digest` pada `tax_assessments`. Jangan mengisi digest untuk keputusan lama dengan nilai buatan; penilaian tersebut perlu ditinjau dan diverifikasi ulang melalui UI. Data dan nominal lama tetap tersimpan.

Gunakan proyek sintetis aktif dengan plafon/versi valid dan transaksi yang mengacu ke RAB yang pernah disahkan. Aktifkan `TRANSACTIONS_ENABLED` dan `TAXES_ENABLED`, siapkan pemetaan folder bukti, lalu verifikasi semua pembayaran. Pilih **Tinjau konfirmasi**, baca ringkasan/daftar penghalang dari server, buka bukti, dan centang pernyataan pemeriksaan sebelum **Konfirmasi transaksi**. Nol potongan tetap membutuhkan keputusan pajak yang sesuai beserta referensi/alasan dan bukti. Konfirmasi tidak menerbitkan kwitansi bernomor atau paket final.

Uji contoh Rp900.000 dengan potongan Rp45.000: netto Rp855.000, total draf turun Rp900.000 dan total terkonfirmasi naik Rp900.000 sekali. Coba dua permintaan berbeda dengan token sama dan retry UUID yang sama setelah respons terputus. Ubah file/attachment, profil, kandidat atau isi aturan, nominal, versi, status proyek, atau hubungan dokumen sesudah pratinjau; konfirmasi harus ditolak dan pemilik meninjau ulang. Uji beberapa penerima: satu penilaian yang belum lengkap menahan seluruh transaksi, dan verifikasi penerima berikutnya tidak membatalkan yang pertama. Gagal batch tidak boleh menyimpan status atau audit sebagian. Setelah terkonfirmasi, alur draf tidak dapat mengubah transaksi, bukti atau pajak.

Uji lokal memakai Sheets/Drive sintetis. Pengujian keuangan dan matriks akses pada deployment Google sungguhan tetap perlu dilakukan dengan akun pemilik/editor/viewer; publikasi kode atau probe tanpa login tidak menutup penerimaan tersebut.

## Prototipe awal HTML Service

Langkah deployment di bawah berlaku untuk reproduksi prototipe awal. Gunakan proyek Apps Script tersendiri, ubah `webapp.access` di manifest menjadi `DOMAIN`, gunakan scope Sheets baca saja, dan hapus scope Drive untuk skenario prototipe baca-saja tersebut.

Prototipe LPJ-09 membaca dua proyek sintetis, A tahun 2023 dan B tahun 2025. Anggota A adalah `EDITOR` proyek A dan anggota B adalah `VIEWER` proyek B. PPK, Bendahara Pengeluaran, dan mahasiswa terkait melalui `people` dan `project_people`. Fixture akun aplikasi hanya berisi pemilik dan dua anggota.

HTML Service memanggil `dispatch` melalui `google.script.run`. Setiap RPC memakai email dari `Session.getActiveUser()` dan membaca status akun serta keanggotaan dari spreadsheet privat. `projects.list` mengembalikan seluruh proyek yang diizinkan dalam fixture kecil ini. `stage0.write_probe` dan `stage0.tax_probe` hanya mengembalikan hasil pemeriksaan hak. Pemilik mengubah peran dan status pencabutan melalui spreadsheet. Berkas ini memakai panel HTML sederhana untuk uji transport serta otorisasi.

## Uji lokal

Gunakan Node.js 24 dan `pnpm install --frozen-lockfile`, lalu jalankan `pnpm test` dan `pnpm build` dari akar repositori. Pada 18 November 2026, seluruh 29 pengujian dan build lulus secara lokal. Pengujian server menjalankan berkas `.gs` dengan layanan Google disimulasikan, memakai TSV yang sama dengan panduan deployment. Pengujian ini mencakup akses, proyek, impor personel, RAB, kegiatan/rundown, logbook, peserta/distribusi, pembacaan CSV peserta, penyuntingan kegiatan, paket pratinjau, draf transaksi, serta penilaian/verifikasi pajak; hasilnya belum menggantikan uji deployment Google sungguhan. Workflow **Check LPJ contracts and build** menjalankan pemeriksaan yang sama pada push dan pull request.

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
| Pemilik | Daftar memuat 2023 dan 2025. Buka proyek dan periksa peran `OWNER`. | Lulus | Lulus menurut laporan pengguna |
| Anggota A | Daftar hanya memuat 2023. Baca A sebagai `EDITOR` dan jalankan uji hak tulis untuk A. Keduanya berhasil. | Lulus | Lulus menurut laporan pengguna |
| Anggota B | Daftar hanya memuat 2025. Baca B sebagai `VIEWER`. Uji hak tulis untuk B menghasilkan `FORBIDDEN`. | Lulus | Lulus menurut laporan pengguna |
| Lintas proyek | Sebagai B, masukkan ID A dan tekan **Baca proyek**. Ulangi sebagai A dengan ID B. Server mengembalikan `FORBIDDEN`. | Lulus | Belum dijalankan |
| Verifikasi pajak | Sebagai masing-masing anggota, tekan **Uji hak verifikasi pajak** untuk proyek yang ditugaskan. Server mengembalikan `FORBIDDEN`. | Lulus | Belum dijalankan |
| Turun ke baca saja | Biarkan tab A terbuka. Sebagai pemilik, ubah `project_role` A menjadi `VIEWER` dan tunggu Sheets menyimpan perubahan. Pada tab yang sama, baca A dan ulangi uji hak tulis. Baca berhasil dan uji hak tulis menghasilkan `FORBIDDEN`. | Lulus | Belum dijalankan |
| Pencabutan | Sebagai pemilik, isi `revoked_at` A dengan waktu UTC ISO 8601 dan tunggu Sheets menyimpan perubahan. Sebagai A, jalankan ulang baca proyek dan daftar proyek pada tab lama. Baca menghasilkan `FORBIDDEN` dan daftar kosong. Buka kembali tautan `/exec?project_id=<ID-A>` dan pastikan baca juga ditolak. | Lulus untuk RPC | Tab dan tautan lama belum diuji |
| Akun tanpa undangan dan personel LPJ | Pastikan detail proyek menampilkan PPK, Bendahara Pengeluaran, dan mahasiswa proyek itu. Coba URL uji dengan akun kampus yang tidak ada di `users`. Server mengembalikan `FORBIDDEN` bila identitas tersedia. Gunakan akun tanpa undangan sebagai pengganti akun personel. | Lulus | Belum dijalankan |
| Identitas kosong dan akun luar | Buka `/exec` tanpa sesi dan dengan akun luar bila tersedia. Google seharusnya meminta login atau menolak akses. Jika RPC menerima email kosong, hasilnya `UNAUTHENTICATED`. Jika RPC menerima email luar, hasilnya `FORBIDDEN`. Catat apakah penolakan terjadi di Google atau di aplikasi. | Lulus untuk RPC | Belum dijalankan |
| Akses langsung ke berkas | Buka URL spreadsheet, folder bukti, dan berkas dummy sebagai pemilik lalu sebagai anggota A dan B. Pemilik dapat membukanya dan kedua anggota ditolak langsung. | Memerlukan akun Google | Belum dijalankan |

Untuk GitHub Pages, uji ulang matriks otorisasi dari origin `github.io` memakai transport yang mendukung identitas Google di server. Catat hasil aktual dan keputusan transport di [arsitektur](../ARCHITECTURE.md).


## Menyiapkan kwitansi bernomor (LPJ-05/08/09)

Tambahkan `Receipts.gs`; perbarui `Code.gs`, `Transactions.gs`, `TransactionConfirmation.gs` dan `DeploymentSetup.gs`. Pada tab receipts lama dengan sembilan kolom, tambahkan tepat lima header di akhir J1:N1: `sequence_no, issued_by_user_id, template_version, document_snapshot, snapshot_digest`. Pertahankan header dan seluruh data lama. Baris kwitansi lama tanpa snapshot/sequence perlu rekonsiliasi tersendiri; jangan mengisinya dengan nilai rekaan. Tidak ada scope atau flag baru; gunakan TRANSACTIONS_ENABLED/TAXES_ENABLED yang sudah aktif.

Publikasikan backend dan Pages. Pada transaksi terkonfirmasi, pemilik memilih **Tinjau kwitansi**, meninjau nominal/tanggal/penerima/PPK/bendahara, lalu **Terbitkan kwitansi**. Perubahan sumber atau preview kedaluwarsa memerlukan muat ulang. Bila hasil simpan belum diketahui, gunakan **Coba terbitkan kembali** dengan UUID/payload yang sama. Nomor berurutan per proyek berbentuk 0001/KWT/2026; tanggal mengikuti pembayaran. Contoh bruto Rp900.000 dan potongan Rp45.000 menghasilkan netto Rp855.000, terbilang delapan ratus lima puluh lima ribu rupiah. Anggota berizin dapat **Lihat kwitansi** dan mencetak snapshot tanpa hak menerbitkan.

Lima tes kwitansi melengkapi total 50 tes: terbilang sampai batas integer aman, otorisasi, retry, dua penerima/nomor, sumber berubah, lock/batch gagal dan snapshot tetap setelah master/bukti berubah. Uji browser sintetis mencakup gagal muat/penghalang, konflik, respons terputus, fokus/Escape, viewer/editor dan layar 360 px. PDF sintetis normal satu halaman A4, isian maksimum dua halaman dengan tanda tangan utuh dan nomor pada halaman lanjutan. Isi PDF diperiksa terhadap nominal/terbilang/NIP dan ketiadaan tombol UI. Pengesahan format resmi, arsip PDF final/salinan bukti serta alur keuangan Google sungguhan tetap belum diverifikasi.


## Menyiapkan rekap realisasi tahap (LPJ-07/08/09)

Tambahkan StageReports.gs dan perbarui Code.gs serta build Pages. Tidak ada migrasi skema/scope/flag baru; gunakan TRANSACTIONS_ENABLED=true. Proyek memerlukan plafon/status/row_version valid dan report_stages lengkap dari wizard (termasuk row_version). Jangan mengarang nilai untuk fixture proyek lama; buat proyek uji lengkap melalui wizard. Publikasikan backend dan Pages, lalu buka detail proyek → **Realisasi per tahap**. Pilih tahap dan **Muat ulang realisasi** setelah transaksi dikonfirmasi.

Uji sintetis: plafon Rp17.500.000 dengan 70% menghasilkan target Rp12.250.000; 60% menghasilkan Rp10.500.000. Honor Rp900.000 dipotong Rp45.000 tetap realisasi bruto Rp900.000, netto Rp855.000. Tahap 100% mencakup transaksi tahap sebelumnya sekali. Batas tanggal inklusif, multi-penerima, draf/VOID, transaksi di luar batas, RAB lama dan lintas proyek diperiksa. ID/nominal/FK rusak dan total overflow ditolak; preview tidak menulis data. Total 55 tes lulus. Uji browser sintetis desktop/360 px memeriksa pemilik/viewer, gagal muat/pemulihan, pergantian tahap tanpa nominal lama, pencarian/halaman, keadaan kosong, dan penjelasan tahap final. Pencatatan penerimaan dana aktual, setoran pajak, cetak/finalisasi rekap dan uji Google sungguhan tetap belum tersedia atau belum diverifikasi.
