# Rencana implementasi LPJ Litapdimas

Status: rancangan tahap pengerjaan berdasarkan [PRD](PRD.md), [arsitektur](ARCHITECTURE.md), dan [panduan UI](DESIGN.md).

| Urutan | Hasil | Pemeriksaan sebelum dinyatakan selesai |
| --- | --- | --- |
| 0. Uji akses dan hosting | Bukti bahwa akun kampus bisa masuk melalui konfigurasi kandidat dan akses proyek ditegakkan server | Matriks uji di bawah. Catat konfigurasi, hasil, serta keputusan hosting di arsitektur. |
| 1. Proyek dan personel | Wizard, Master Personel, impor dengan pratinjau, dan versi RAB. LPJ-01–03, fondasi LPJ-09 | Isian wajib menahan aktivasi. Impor ulang tidak menduplikasi orang. Revisi menghasilkan versi baru dan riwayat versi sebelumnya dapat dilihat. |
| 2. Satu kegiatan lengkap | Kegiatan, agenda, daftar peserta dan distribusi, logbook. LPJ-04 | Satu fixture FGD menghasilkan rundown, logbook, daftar hadir serta daftar distribusi dari ID kegiatan yang sama. Status hadir dan distribusi dapat berbeda. |
| 3. Transaksi, pajak, dan tahap | Verifikasi bendahara, kwitansi, pencairan dan rekap tahap. LPJ-05–07 | Uji contoh pada bagian berikut, dua permintaan terpisah yang bersamaan, serta percobaan ulang request yang sama. |
| 4. Paket final dan audit | Pratinjau, PDF, snapshot, audit dan pemulihan. LPJ-08–09 | Arsip lama terbaca sesudah personel/aturan berubah. Kegagalan pembuatan salah satu file tidak menghasilkan paket final yang tampak lengkap. Uji pulihkan fixture dari cadangan. |

## Uji akses dan hosting

Mulai dari Apps Script HTML Service sebagai kandidat dan Google Sheets berisi data sintetis. Gunakan dua akun kampus yang sah, satu akun luar bila diizinkan, dan dua proyek uji. Catat strategi eksekusi, kontrol akses deployment, serta kebutuhan izin Sheets dan Drive tanpa menyimpan email atau ID berkas asli di GitHub.

| Kasus | Hasil yang harus diamati |
| --- | --- |
| Akun kampus A diberi akses Proyek A | Server mengenali akun dan memberi data Proyek A sesuai perannya. |
| Akun kampus B diberi akses Proyek B dan meminta ID Proyek A langsung melalui RPC | Ditolak. Otorisasi berlaku di server pada setiap panggilan. |
| Pengguna tanpa peran bendahara meminta verifikasi pajak | Ditolak meski request dikirim langsung. |
| Identitas kosong atau akun luar yang tidak berwenang | Ditolak. |
| Akun operator membuka URL Sheets atau folder bukti secara langsung | Hak langsung terbatas sesuai peran. Operator tidak dapat menggunakan akses file untuk melewati pembatasan proyek. |

Jika kandidat gagal, dokumentasikan konfigurasi dan hasil yang gagal, lalu evaluasi opsi hosting/identitas sebelum membuat transport produksi. Paket UI dan pengujian domain dengan fixture dapat berjalan sambil uji akun berlangsung.

## Contoh penerimaan finansial

- **Tahap kumulatif.** Siapkan plafon sintetis Rp10.000.000 dan dua tahap 70%/100%. Buat transaksi terkonfirmasi Rp7.000.000 sebelum batas tahap 70% dan Rp3.000.000 sesudahnya. Laporan 70% menampilkan Rp7.000.000 dan laporan final Rp10.000.000. Pencairan aktual tersimpan sebagai catatan terpisah.
- **Honor.** Rp900.000 dengan potongan Rp45.000 menghasilkan netto Rp855.000. Rekap menunjukkan Rp900.000 meski bukti setoran Rp45.000 sudah ditautkan. Terbilang sesuai netto dan kwitansi menampilkan dua penandatangan.
- **Transport.** Catat satu pembayaran Rp2.000.000 dan tautkan daftar penerima. Pemberian label uang saku pada bukti tidak membuat pos belanja kedua.
- **Konsumsi.** Bila status vendor, klasifikasi, atau bukti kurang, transaksi meminta verifikasi. Versi pajak dengan masa berlaku tumpang tindih tidak boleh dipilih otomatis.
- **Nomor bukti.** Dua permintaan penerbitan yang valid dan bersamaan mendapat nomor berbeda. Mengulang request yang sama mengembalikan bukti yang sama.
