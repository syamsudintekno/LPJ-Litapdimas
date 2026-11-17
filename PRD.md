# PRD — LPJ Litapdimas

Status: baseline desain untuk ditinjau. Pengguna awal sekitar lima orang dalam satu institusi.

## Tujuan

Peneliti dan pemilik menyiapkan LPJ penelitian lintas proyek dan tahun. Data kegiatan, personel, dan transaksi dipakai ulang untuk logbook, rundown, kwitansi, rekap realisasi, dan lampiran.

## Pengguna dan akses

Pemilik mengelola semua proyek, undangan, verifikasi data, dan arsip. Anggota peneliti yang diundang mendapat akses per proyek dan tahun anggaran untuk mengisi draf atau melihat data sesuai haknya. Pemilik dapat mencabut akses atau mengubahnya menjadi baca saja. PPK, Bendahara Pengeluaran, dan mahasiswa hanya tercatat sebagai personel LPJ. Mereka tidak memiliki akun atau tugas dalam aplikasi. Verifikasi data oleh pemilik mengikuti kwitansi dan bukti yang tersedia. Tanda tangan resmi tetap mengikuti dokumen LPJ.

## Lingkup v1 dan penerimaan

| ID | Alur pengguna | Kriteria penerimaan |
| --- | --- | --- |
| LPJ-01 | Pemilik membuat proyek LPJ melalui wizard | Judul, tahun anggaran, plafon, skema tahap, ketua, penanggung jawab, PPK, dan bendahara wajib sebelum aktivasi. Anggota peneliti, mahasiswa, dan pejabat tambahan berupa daftar dinamis. Dua mahasiswa adalah kebiasaan, jumlah aktual dapat berbeda. |
| LPJ-02 | Pemilik mengimpor Master Personel dan mencari nama dari wizard | CSV/XLSX dipratinjau sebelum impor. Baris dengan ID ganda atau konflik dilaporkan. Pengulangan impor dengan ID yang sama tidak menambah duplikat. Dosen, pegawai, mahasiswa, dan pihak eksternal dapat dicari sesuai hak akses. |
| LPJ-03 | Pemilik mencatat RAB usulan, mengesahkan satu versi, lalu membuat revisi bila diperlukan | Versi yang sudah disetujui dapat ditelusuri. Plafon resmi dan total rincian terlihat bersama selisihnya. Belanja dapat ditelusuri ke versi dan item RAB yang menjadi acuannya. |
| LPJ-04 | Anggota peneliti memasukkan kegiatan, sesi rundown, peserta, dan logbook | FGD dan kegiatan lain dapat ditambah sesuai kebutuhan. Impor CSV mendukung pratinjau dan deduplikasi per kegiatan. Kehadiran serta penerimaan konsumsi, snack, atau transport dicatat masing-masing. Logbook memuat uraian, hasil, tanggal, dan kegiatan terkait bila ada. |
| LPJ-05 | Anggota peneliti memasukkan transaksi dan bukti. Pemilik mencocokkan bukti | Kwitansi menampilkan jumlah, potongan, jumlah diterima, terbilang, tujuan pembayaran, tanggal, penerima, nomor bukti, PPK, dan Bendahara Pengeluaran. Terbilang mengikuti jumlah yang diterima. Uang saku yang merupakan transport dihitung sekali dan tertaut ke daftar penerimanya. |
| LPJ-06 | Pemilik mengelola aturan pajak dan memeriksa usulan pajak | Aturan punya masa berlaku serta referensi. Honor dengan data lengkap mendapat usulan menurut aturan dan golongan kepegawaian. Satu contoh bruto Rp900.000 dan potongan Rp45.000 menghasilkan netto Rp855.000 dan realisasi Rp900.000. Setoran terhubung ke potongan yang sama. Konsumsi/snack tanpa klasifikasi atau bukti memadai berstatus Perlu verifikasi. Koreksi memerlukan alasan. |
| LPJ-07 | Pemilik mencatat pencairan dan menyiapkan laporan tahap | Persentase tahap menjadi acuan pencairan dan target realisasi, sedangkan penerimaan aktual dicatat dengan tanggal dan bukti. Untuk Rp17.500.000, target 70% Rp12.250.000. Arsip 2023 mendukung 60%. Tahap 100% kumulatif sejak awal. Rekap hanya mengambil transaksi terverifikasi dalam cakupan dan masing-masing sekali. |
| LPJ-08 | Pemilik meninjau dan memfinalkan dokumen | Pratinjau tersedia untuk logbook, rundown, realisasi per tahap, kwitansi, daftar hadir, serta daftar snack, konsumsi, transport dan ekspose. Sistem menampilkan field wajib yang belum lengkap sebelum finalisasi. Ekspor PDF final menyimpan versi, salinan data dan identitas penandatangan. Perubahan master setelah finalisasi tidak mengubah arsip. |
| LPJ-09 | Pemilik mengelola akses, audit dan cadangan | Akses dibatasi ke akun berwenang dan proyek yang ditugaskan. Perubahan finansial serta finalisasi tercatat dengan pelaku, waktu, dan perubahan. Dua penyimpanan bersamaan tidak menerbitkan nomor bukti yang sama. Cadangan Sheets, bukti dan arsip dapat dipulihkan oleh pemilik. |

## Alur utama

1. Pemilik mengimpor personel dan mengisi wizard LPJ.
2. Pemilik menyetujui RAB dan mencatat penerimaan dana. Anggota peneliti mengisi kegiatan, peserta, rundown, serta logbook.
3. Anggota peneliti memasukkan transaksi dan bukti. Pemilik meninjau penerima, nilai kwitansi dan pajak.
4. Pemilik memilih tahap, memeriksa rekap serta lampiran, lalu memfinalkan paket LPJ.

## Batas lingkup

Di luar v1: portal publik, pencairan dana dari aplikasi, integrasi Litapdimas/Coretax/perbankan, pengiriman SPT, tanda tangan elektronik tersertifikasi, OCR, akses offline, dan pemilikan hibah lintas institusi. Perluasan fitur dimulai dari revisi PRD yang disetujui. Data produksi, bukti, dan daftar personel tidak masuk repositori publik.

## Keputusan yang perlu divalidasi

- Verifikasi perlakuan pajak konsumsi/snack serta dokumen yang perlu memuat penandatangan selain aturan tetap PPK dan bendahara pada kwitansi.
- Cocokkan format cetak, jadwal FGD dan referensi ekspose dengan dokumen sumber sebelum pengesahan template.
- Uji identitas dan otorisasi aplikasi dengan akun kampus sebelum menetapkan cara hosting. Rancangan dan kontrak teknis ada di [ARCHITECTURE.md](ARCHITECTURE.md). Aturan antarmuka ada di [DESIGN.md](DESIGN.md).
