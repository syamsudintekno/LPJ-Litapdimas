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

Untuk LPJ-06/09, pemilik mengelola aturan global lintas proyek sebagai versi yang tidak ditimpa. Setiap versi memiliki periode inklusif dan referensi. Pada kode sama, versi tertinggi yang mencakup tanggal pembayaran menjadi acuan sebelum pemeriksaan golongan; aturan dari kode berbeda yang sama-sama cocok memerlukan tinjauan. Perubahan aturan tidak otomatis mengubah keputusan terdahulu, tetapi penilaian yang merujuk versi tergantikan perlu ditinjau ulang. Anggota tidak dapat mengelola aturan.

1. Pemilik mengimpor personel dan mengisi wizard LPJ.
2. Pemilik menyetujui RAB dan mencatat penerimaan dana. Anggota peneliti mengisi kegiatan, peserta, rundown, serta logbook.
3. Anggota peneliti memasukkan transaksi dan bukti. Pemilik meninjau penerima, nilai kwitansi dan pajak.
4. Pemilik memilih tahap, memeriksa rekap serta lampiran, lalu memfinalkan paket LPJ.

Irisan bukti LPJ-05/06/09 menerima penautan PDF/JPG/PNG yang sudah diunggah melalui Drive ke folder bukti proyek yang ditetapkan pemilik. Pemilik/editor menautkan atau mengganti bukti pada transaksi draf sesuai izin server; viewer tidak mengakses panel bukti. Penautan tidak berarti verifikasi dan tidak mengubah keputusan pajak/netto terdahulu. Perubahan bukti memerlukan tinjauan ulang pemilik. Unggah langsung dari aplikasi dan arsip salinan final belum termasuk irisan ini.

Pada irisan konfirmasi LPJ-05/06/09, pemilik meninjau seluruh pembayaran dan bukti sebelum mengonfirmasi transaksi pada proyek aktif. Server memeriksa ulang RAB, nominal, penilaian pajak, profil penerima, aturan dan bukti terkini. Satu pembayaran yang belum memenuhi syarat menahan seluruh transaksi. Konfirmasi menyimpan pelaku/waktu dan memindahkan nilai kwitansi ke total terkonfirmasi satu kali; percobaan ulang tidak menggandakan realisasi.

Pada irisan kwitansi LPJ-05/08/09, pemilik meninjau pembayaran terkonfirmasi dan menerbitkan satu kwitansi aktif per pembayaran. Nomor berurutan unik dalam proyek, dialokasikan atomik; retry tidak menerbitkan nomor kedua. Snapshot membekukan nominal, terbilang netto, tanggal pembayaran, identitas proyek/penerima, PPK dan Bendahara Pengeluaran. Perubahan master tidak mengubah kwitansi terbit. Anggota berizin membaca salinan cetaknya. Cetak A4 tersedia; pengesahan format resmi, arsip PDF final dan salinan bukti masih memerlukan tahap finalisasi.

Irisan rekap tahap LPJ-07/08/09 menyediakan pratinjau terkini bagi pembaca proyek. Tahap berasal dari skema wizard; target dihitung dari plafon dan basis point, dibulatkan ke rupiah terdekat (setengah ke atas). Rekap kumulatif mencakup transaksi CONFIRMED sejak awal proyek sampai tanggal batas inklusif. Pembayaran multi-penerima dijumlahkan di bawah satu transaksi; draf, VOID dan transaksi sesudah batas dikecualikan. Bruto, potongan, netto, selisih target dan sisa plafon terlihat terpisah. Kwitansi terbit atau setoran pajak tidak menjadi belanja tambahan. Status FINALIZED pada tahap tidak menjadikan pratinjau sumber terkini sebagai arsip final. Pencatatan penerimaan dana aktual, rekonsiliasi setoran dan finalisasi paket tetap langkah lanjutan.

## Batas lingkup

Di luar v1: portal publik, pencairan dana dari aplikasi, integrasi Litapdimas/Coretax/perbankan, pengiriman SPT, tanda tangan elektronik tersertifikasi, OCR, akses offline, dan pemilikan hibah lintas institusi. Perluasan fitur dimulai dari revisi PRD yang disetujui. Data produksi, bukti, dan daftar personel tidak masuk repositori publik.

## Keputusan yang perlu divalidasi

- Verifikasi perlakuan pajak konsumsi/snack serta dokumen yang perlu memuat penandatangan selain aturan tetap PPK dan bendahara pada kwitansi.
- Cocokkan format cetak, jadwal FGD dan referensi ekspose dengan dokumen sumber sebelum pengesahan template.
- Uji identitas akun Google dan otorisasi per proyek dari antarmuka GitHub Pages sebelum memakai data LPJ. Data tabel tersimpan di Google Sheets privat. Rancangan dan kontrak teknis ada di [ARCHITECTURE.md](ARCHITECTURE.md). Aturan antarmuka ada di [DESIGN.md](DESIGN.md).
