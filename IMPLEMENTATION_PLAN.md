# Rencana implementasi LPJ Litapdimas

Status: rancangan tahap pengerjaan berdasarkan [PRD](PRD.md), [arsitektur](ARCHITECTURE.md), dan [panduan UI](DESIGN.md).

## Progres 18 November 2026

- Tahap 0: login dan akses dasar tiga akun dilaporkan berhasil. Uji penolakan akses Google sungguhan dan izin langsung berkas masih tertunda; tahap belum ditutup.
- Tahap 1 (LPJ-01–03, LPJ-09): wizard/aktivasi, pencarian dan impor personel, serta draf/pengesahan/riwayat RAB sudah diimplementasikan. Pengujian lokal memakai layanan Google yang disimulasikan; alur tulis pada deployment sintetis dan penautan transaksi ke RAB belum diverifikasi.
- Tahap 2 (LPJ-04, LPJ-09): RPC daftar/detail/pembuatan kegiatan dan rundown tersedia, disertai pemeriksaan akses proyek, validasi sesi, audit, batch atomik, serta idempotensi. UI, penyuntingan, peserta, distribusi, logbook, dan keluaran dokumen belum tersedia.
- Pemeriksaan otomatis: `pnpm test` dan `pnpm build`; workflow CI menjalankannya pada push dan pull request. [Pelacak progres GitHub](https://github.com/syamsudintekno/LPJ-Litapdimas/issues/1).

| Urutan | Hasil | Pemeriksaan sebelum dinyatakan selesai |
| --- | --- | --- |
| 0. Uji akses dari GitHub Pages | Bukti bahwa akun Google yang diundang bisa masuk dari `github.io` dan akses proyek ditegakkan server | Matriks uji di bawah. Catat konfigurasi layanan, hasil, dan keputusan transport di arsitektur. |
| 1. Proyek dan personel | Wizard, Master Personel, impor dengan pratinjau, dan versi RAB. LPJ-01–03, fondasi LPJ-09 | Isian wajib menahan aktivasi. Impor ulang tidak menduplikasi orang. Revisi menghasilkan versi baru dan riwayat versi sebelumnya dapat dilihat. |
| 2. Satu kegiatan lengkap | Kegiatan, agenda, daftar peserta dan distribusi, logbook. LPJ-04 | Satu fixture FGD menghasilkan rundown, logbook, daftar hadir serta daftar distribusi dari ID kegiatan yang sama. Status hadir dan distribusi dapat berbeda. |
| 3. Transaksi, pajak, dan tahap | Verifikasi bukti oleh pemilik, kwitansi, pencairan dan rekap tahap. LPJ-05–07 | Uji contoh pada bagian berikut, dua permintaan terpisah yang bersamaan, serta percobaan ulang request yang sama. |
| 4. Paket final dan audit | Pratinjau, PDF, snapshot, audit dan pemulihan. LPJ-08–09 | Arsip lama terbaca sesudah personel/aturan berubah. Kegagalan pembuatan salah satu file tidak menghasilkan paket final yang tampak lengkap. Uji pulihkan fixture dari cadangan. |

## Uji akses dan hosting

Tahap 1 mencakup wizard pembuatan dan aktivasi proyek (LPJ-01), pencarian dan impor CSV/XLSX Master Personel (LPJ-02), serta draf, pengesahan, dan riwayat versi RAB (LPJ-03). Uji integrasi di deployment sintetis mengikuti [penyiapan wizard](stage0/README.md#menyiapkan-uji-wizard-lpj-01), [penyiapan impor](stage0/README.md#menyiapkan-uji-impor-master-personel-lpj-02), dan [penyiapan RAB](stage0/README.md#menyiapkan-uji-versi-rab-lpj-03). Penautan transaksi ke item RAB diuji bersama alur transaksi.

Uji antarmuka dari GitHub Pages dengan Apps Script sebagai kandidat layanan server dan Google Sheets privat berisi data sintetis. Jalankan uji tanpa mengaktifkan billing. Gunakan satu akun pemilik, dua akun anggota peneliti, satu akun Google tanpa undangan, dan dua proyek uji dari tahun berbeda. Catat cara layanan memverifikasi identitas, konfigurasi akses dari origin GitHub Pages, serta kebutuhan izin Sheets dan Drive. Simpan email akun uji dan ID berkas di lingkungan privat.

| Kasus | Hasil yang harus diamati |
| --- | --- |
| Akun Google A diberi akses Proyek A | Server mengenali akun dan memberi data Proyek A sesuai perannya. |
| Akun Google B diberi akses Proyek B dan meminta ID Proyek A langsung melalui RPC | Ditolak. Otorisasi berlaku di server pada setiap panggilan. |
| Anggota peneliti meminta verifikasi pajak | Ditolak meski request dikirim langsung. |
| Akses anggota dicabut setelah proyek selesai | Permintaan baru, termasuk dengan tautan lama, ditolak. Jika hak diturunkan ke baca saja, permintaan tulis ditolak. |
| Identitas kosong atau akun luar yang tidak berwenang | Ditolak. |
| Akun anggota membuka URL Sheets atau folder bukti secara langsung | Hak langsung terbatas sesuai peran. Anggota tidak dapat menggunakan akses file untuk melewati pembatasan proyek. |

Jika kandidat layanan gagal, dokumentasikan konfigurasi dan hasil yang gagal, lalu evaluasi transport atau mekanisme identitas. Uji lokal dengan fixture dapat berjalan sambil uji akun berlangsung.

## Contoh penerimaan finansial

- **Tahap kumulatif.** Siapkan plafon sintetis Rp10.000.000 dan dua tahap 70%/100%. Buat transaksi terkonfirmasi Rp7.000.000 sebelum batas tahap 70% dan Rp3.000.000 sesudahnya. Laporan 70% menampilkan Rp7.000.000 dan laporan final Rp10.000.000. Pencairan aktual tersimpan sebagai catatan terpisah.
- **Honor.** Rp900.000 dengan potongan Rp45.000 menghasilkan netto Rp855.000. Rekap menunjukkan Rp900.000 meski bukti setoran Rp45.000 sudah ditautkan. Terbilang sesuai netto dan kwitansi menampilkan dua penandatangan.
- **Transport.** Catat satu pembayaran Rp2.000.000 dan tautkan daftar penerima. Pemberian label uang saku pada bukti tidak membuat pos belanja kedua.
- **Konsumsi.** Bila status vendor, klasifikasi, atau bukti kurang, transaksi meminta verifikasi. Versi pajak dengan masa berlaku tumpang tindih tidak boleh dipilih otomatis.
- **Nomor bukti.** Dua permintaan penerbitan yang valid dan bersamaan mendapat nomor berbeda. Mengulang request yang sama mengembalikan bukti yang sama.
