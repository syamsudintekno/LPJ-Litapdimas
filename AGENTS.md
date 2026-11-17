# Instruksi proyek LPJ Litapdimas

## Rujukan

- [PRD](PRD.md) menetapkan cakupan, alur, dan kriteria penerimaan. Kaitkan perubahan dengan ID LPJ-01 hingga LPJ-09.
- [Arsitektur](ARCHITECTURE.md) menetapkan nama tabel dan field, ERD, kontrak RPC, dan otorisasi.
- [Panduan UI](DESIGN.md) menetapkan komponen, token, CSS Modules, Inter, dan Lucide React.
- [Rencana implementasi](IMPLEMENTATION_PLAN.md) menetapkan urutan dan verifikasi. Bila rujukan bertentangan, jelaskan konflik dan usulkan perubahan dokumen terkait.

## Aturan implementasi

- Akun aplikasi hanya untuk pemilik dan anggota peneliti yang diundang. Verifikasi bukti, pengelolaan aturan pajak, dan finalisasi dilakukan pemilik. PPK, Bendahara Pengeluaran, dan mahasiswa adalah personel LPJ tanpa akses aplikasi.

- Jaga kalkulasi finansial, verifikasi pajak, kontrol akses, dan status final di server. UI memanggil adapter RPC.
- Gunakan nama dan tipe dari kontrak. Simpan uang dalam rupiah integer, persentase dalam basis point, dan ID sebagai teks.
- Rekap 100% kumulatif dan menghitung transaksi terkonfirmasi satu kali. Setoran pajak dilacak terhadap transaksi asal. Kwitansi memuat PPK dan Bendahara Pengeluaran dari proyek terkait.
- Konsumsi dan snack yang belum jelas masuk antrean verifikasi. Simpan versi aturan, hasil konfirmasi, dan bukti. Aplikasi harus dapat mereproduksi dokumen final dari snapshot.
- Repo publik hanya berisi data sintetis untuk contoh dan pengujian. Simpan kredensial, data personel, bukti transaksi dan arsip final di lingkungan berakses terbatas.
- Jika perubahan membutuhkan fitur di luar PRD, revisi cakupan terlebih dahulu. Untuk perubahan lintas lapisan, selaraskan PRD, kontrak, UI, dan kriteria penerimaan terkait.
- Dalam ringkasan perubahan, sebutkan ID kebutuhan yang disentuh, pemeriksaan yang berhasil, dan hasil yang belum dapat diverifikasi.
