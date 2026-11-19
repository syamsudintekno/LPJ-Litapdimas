# Panduan UI LPJ Litapdimas

Rujukan cakupan dan istilah ada di [PRD.md](PRD.md). Nama field dan status teknis mengikuti [ARCHITECTURE.md](ARCHITECTURE.md).

## Sistem visual

Prototipe awal HTML Service memakai panel uji dengan token warna dasar. Sistem visual berikut berlaku untuk UI aplikasi di GitHub Pages.

Gunakan React, komponen internal, **CSS Modules**, dan **Kubai Icons React** untuk ikon. Gunakan **Inter** dengan fallback system-ui. Simpan token di `src/styles/tokens.css`, aturan global di `globals.css`, dan aturan cetak di `print.css`. Aturan komponen berada di file `*.module.css`. Hindari inline CSS dan penambahan UI kit atau paket ikon kedua. Gunakan atribut data atau kelas untuk variasi status dan ukuran.

### Standar ikon Kubai

Gunakan [Kubai Icons](https://github.com/kubai087/kubai-icons) melalui paket `kubai-icons-react` (versi terkunci di `package.json`, lisensi MIT untuk paket dan ikon). Kubai merupakan satu-satunya pustaka ikon UI; jangan menambahkan Lucide, icon font, atau CDN ikon lain.

- Semua halaman aplikasi memakai ekspor semantik dari `src/components/ui/Icons.jsx`. Adapter memakai impor statis per ikon agar bundel hanya membawa ikon yang digunakan.
- Gunakan varian `soft`, warna `currentColor`, ukuran 16–20 px pada tombol/navigasi, 20–24 px pada judul bagian, dan 28–32 px pada kartu ringkasan. Ukuran melalui prop `size`; tata letak melalui CSS Modules.
- Terapkan ikon pada navigasi, ringkasan proyek, wizard/aktivasi, master/impor personel, RAB, kegiatan/rundown, peserta/distribusi, logbook, transaksi, penilaian pajak, dan toolbar pratinjau dokumen. Pilih makna yang konsisten: tambah, hapus, sunting, simpan, muat ulang, impor, pratinjau, dan cetak. Hindari pengulangan ikon di setiap sel tabel atau field.
- Ikon pendamping bersifat dekoratif (`aria-hidden`, `focusable="false"`). Pertahankan label teks tombol dan status; tombol tanpa teks wajib punya nama aksesibel pada tombolnya. Ikon tidak menambah tab stop.
- Adapter memakai `trigger="none"`: ikon statis tanpa animasi hover/tap atau status toggle internal. Ini juga mempertahankan tampilan tenang pada preferensi reduced motion dan cetak.
- Logo resmi institusi tetap memakai aset resmi. Isi dokumen A4 dan kolom tanda tangan tidak diberi ikon dekoratif; ikon hanya berada pada toolbar yang disembunyikan saat cetak. Panel uji HTML Service bukan halaman UI aplikasi.

### Referensi pengembangan frontend

Gunakan [CoreUI Free React Admin Template](https://github.com/coreui/coreui-free-react-admin-template) sebagai referensi tata letak dashboard. Untuk konteks saat mengembangkan halaman baru, rujuk [panduan AI-assisted development](https://github.com/coreui/coreui-free-react-admin-template/blob/main/README.md#ai-friendly-development), [arsitektur template](https://github.com/coreui/coreui-free-react-admin-template/blob/main/ARCHITECTURE.md), dan [panduan pengembangan](https://github.com/coreui/coreui-free-react-admin-template/blob/main/DEVELOPMENT.md).

Terapkan pola sidebar yang dapat dilipat, header yang menunjukkan konteks halaman, dan kartu ringkasan berbasis data server. Implementasikan pola tersebut dengan komponen internal React, CSS Modules, token LPJ, dan ikon Kubai Icons React sesuai sistem visual di atas.

| Token | Nilai | Penggunaan |
| --- | --- | --- |
| `--color-bg` | `#F8FAFC` | Latar halaman |
| `--color-surface` | `#FFFFFF` | Formulir, tabel, dialog |
| `--color-text` | `#0F172A` | Teks utama |
| `--color-muted` | `#475569` | Teks penjelas |
| `--color-border` | `#CBD5E1` | Garis pemisah |
| `--color-primary` | `#115E59` | Tombol utama, tautan, fokus |
| `--color-success` | `#166534` | Terverifikasi dan final |
| `--color-warning` | `#92400E` | Perlu verifikasi |
| `--color-danger` | `#B91C1C` | Validasi gagal dan aksi pembatalan |

Skala jarak 4, 8, 12, 16, 24, 32, 48 px. Radius elemen 8 px, panel 12 px. Ukuran teks 14 px untuk tabel, 16 px untuk formulir, 24 px untuk judul halaman. Gunakan angka tabular dan perataan kanan untuk rupiah. Format tampilan memakai locale `id-ID`. Label status ditulis lengkap dan memakai warna sebagai petunjuk tambahan.

## Komponen dan alur

| Komponen | Aturan |
| --- | --- |
| AppShell | Pemilih proyek dan tahun selalu terlihat pada halaman yang membutuhkan konteks. Menu berdasarkan hak akses dan ruang lingkup PRD. Pada layar sempit gunakan navigasi lipat. |
| Button dan IconButton | Satu aksi utama per formulir. Ikon Kubai 16–20 px. Tombol ikon punya nama aksesibel. Tampilkan progres simpan dan cegah kirim berulang. |
| FormField dan PersonPicker | Label terlihat, bantuan dekat field, dan pesan kesalahan spesifik. Tampilkan nama, kategori dan unit seperlunya untuk membedakan orang dengan nama sama. |
| SetupWizard | Langkah Identitas → Tim → Pejabat → Tahap LPJ → Tinjau. Tombol kembali mempertahankan draf. Ringkasan menampilkan data yang harus dilengkapi sebelum aktivasi. |
| Mahasiswa dalam wizard | Tambah Mahasiswa membuka isian nama, NIP dan NIM berupa teks, bukan dropdown Master Personel. Nama wajib dan sedikitnya salah satu nomor harus diisi. Label NIP/NIM terpisah; nol awal dipertahankan. Jumlah mahasiswa dinamis, setiap blok bernomor dan dapat dihapus. Kembali/lanjut mempertahankan isian; ringkasan menampilkan nama dan nomor sebelum simpan. Data dicatat otomatis setelah proyek disimpan, tanpa mengharuskan input awal melalui Google Sheets. |
| DataTable | Header semantik, filter eksplisit dan navigasi halaman. Pada ponsel, tabel padat boleh bergulir horizontal dalam wrapper berlabel. Utamakan kolom identitas, status, dan nominal. |
| RAB proyek | Tampilkan plafon resmi, total rincian versi terpilih, dan selisih bersama. Riwayat versi dapat dipilih dari detail proyek. Pemilik mengonfirmasi pengesahan setelah meninjau rincian. |
| Kegiatan dan rundown | Bagian detail proyek menampilkan konteks tahun/proyek, pencarian, dan daftar per halaman. Pemilik/editor dapat membuat draf jika server mengizinkan; viewer membaca daftar dan detail. Sesi dinamis memuat jam, judul, dan pembicara opsional dari personel proyek. Validasi waktu mengarahkan fokus ke sesi bermasalah. Bila hasil simpan belum diketahui, pertahankan isian dan request ID untuk coba ulang sampai server memberi hasil. |
| Logbook penelitian | Detail proyek menampilkan catatan bertanggal, kegiatan opsional, uraian, dan hasil. Pemilik/editor menambah atau menyunting sesuai izin server; viewer membaca. Pisahkan label Uraian dan Hasil, pertahankan baris baru, serta tampilkan pencarian dan halaman daftar. Konflik versi mempertahankan isian dan menjelaskan cara memuat versi terbaru. Retry saat hasil simpan belum diketahui mengunci isian dan memakai request yang sama. |
| Peserta dan distribusi | Di detail kegiatan, tampilkan pratinjau CSV atau personel proyek sebelum menambah peserta. Pisahkan formulir dan status hadir dari snack, konsumsi, serta transport. Tampilkan jumlah unit dan waktu penerimaan dalam WIB; jangan menampilkan unit sebagai rupiah. Viewer hanya membaca. Pencarian dan halaman daftar membatasi kepadatan. Pratinjau tabel pada ponsel boleh bergulir dalam wrapper berlabel tanpa melebarkan halaman. |
| Dokumen kegiatan | Tombol pratinjau membuka dialog dengan enam bagian draf dari satu kegiatan. Label Draf terlihat di layar/cetak. Dialog mendukung Escape dan mengembalikan fokus ke tombol pemicu. Cetak A4 menghilangkan shell/tombol, mengulang header tabel pada halaman lanjutan, dan menyediakan kolom tanda tangan kosong. Isi logbook panjang boleh terpecah antarhalaman tanpa terpotong. Pratinjau bukan arsip final. |
| Draf transaksi | Detail proyek memisahkan total nilai kwitansi draf dari terkonfirmasi. Form memilih item/versi RAB, kegiatan opsional, tanggal, jenis belanja, dan penerima dinamis. Label nilai kwitansi, usulan potongan, serta jumlah diterima dibedakan. Netto dan total memakai respons server. Draf tetap berlabel belum diverifikasi; Konfirmasi tersedia melalui tinjauan pemilik; nomor kwitansi diterbitkan melalui tinjauan tersendiri. Konflik mempertahankan isian dan menjelaskan cara memuat versi terbaru. |
| Penilaian pajak | Setiap pembayaran dapat ditinjau pemilik/editor. Pisahkan usulan aturan dari keputusan tercatat, tampilkan referensi dan alasan koreksi, serta penanda tinjauan ulang. Editor hanya mempratinjau; formulir keputusan dan tautan bukti Drive hanya untuk pemilik. Bukti, referensi, versi, serta alasan keputusan manual/koreksi wajib diperiksa server. Retry mengunci isian dan memakai request sama. Verifikasi pajak tidak mengubah transaksi menjadi terkonfirmasi. |
| Bukti transaksi | Panel pada transaksi untuk pemilik/editor, dengan ikon Kubai, tautan folder proyek, daftar bukti dan status ketersediaan. Terima ID/tautan berkas Drive; jelaskan PDF/JPG/PNG maksimal 20 MiB dan keharusan berada langsung di folder proyek. Pisahkan penautan dari verifikasi. Penggantian mempertahankan ID attachment dan menaikkan versi. Konflik mempertahankan isian berkas dan memuat daftar terbaru; retry yang hasilnya belum diketahui mengunci isian dan memakai request sama. Viewer tidak mendapat panel. Fokus kembali ke pemicu saat ditutup, atau ke judul transaksi sesudah berhasil dan daftar dimuat ulang. |
| Konfirmasi transaksi | Pemilik membuka Tinjau konfirmasi pada transaksi draf. Tampilkan nominal kwitansi/potongan/netto dari server, seluruh penerima dan tautan bukti, serta daftar penghalang jika belum lengkap. Pernyataan pemeriksaan bukti wajib dicentang sebelum Konfirmasi transaksi. Setelah konflik, muat ulang tinjauan dan minta pemeriksaan ulang; setelah respons tidak pasti, kunci isian dan gunakan request sama saat retry. Hasil sukses menampilkan status/waktu konfirmasi, memperbarui total dan mengembalikan fokus ke judul transaksi. Bedakan konfirmasi dari penerbitan kwitansi dan finalisasi. |
| Aturan pajak | Halaman global khusus pemilik, dengan ikon Kubai, pencarian, delapan kode per halaman dan riwayat versi yang dapat dibuka. Form membedakan basis point dari persen, menampilkan periode inklusif dan referensi wajib, serta menjelaskan prioritas versi pada periode yang beririsan. Kode dan jenis tetap saat membuat versi lanjutan. Versi lama tetap terbaca. Konflik mempertahankan isian dan memuat daftar terbaru; pemilik meninjau acuan versi sebelum simpan ulang. Hasil simpan yang belum diketahui mengunci formulir dan memakai UUID/payload sama saat retry. |
| ImportPreview | Tampilkan valid, duplikat dan perlu koreksi dengan nomor baris. Pesan menyebut nama kolom dan tindakan perbaikan. NIP/NIM/ID numerik dari Excel meminta format Text dan pengisian ulang dari sumber asli; jangan menjanjikan pemulihan digit yang hilang. Petunjuk Text sebelum mengisi ditampilkan dekat unggahan. Pisahkan pratinjau dari tindakan impor. |
| TaxSummary | Tampilkan nominal kwitansi, potongan, tambahan pajak bila ada, dan jumlah diterima dengan label tersendiri. Pemilik dapat memeriksa dasar aturan, penanda verifikasi, bukti dan alasan koreksi. |
| StatusBadge dan Notice | Label teks untuk Draf, Perlu verifikasi, Terverifikasi, dan Final. Kesalahan simpan tetap terlihat sampai ditangani. |
| DocumentPreview | Tampilkan tahap, tanggal batas, versi dokumen dan kelengkapan. Gunakan halaman A4, ulangi header tabel bila perlu, dan periksa blok tanda tangan serta pemenggalan baris. Tampilan cetak menghilangkan navigasi dan tombol. |

## Syarat penerimaan UI

- Formulir, tab, pemilih personel, dialog, dan navigasi berfungsi dengan keyboard. Fokus terlihat, urutan tab mengikuti alur, dan fokus kembali ke pemicu setelah dialog ditutup.
- Sediakan tampilan loading, kosong, gagal dan siap pada layar yang mengambil data. Kesalahan validasi mengarahkan pengguna ke field terkait tanpa menghapus isian.
- Pada lebar 360 px, wizard dan formulir transaksi dapat diselesaikan tanpa gulir horizontal halaman. Desktop menunjukkan konteks proyek, tabel, dan tindakan utama dengan jelas.
- Pratinjau kwitansi menerapkan identitas PPK dan bendahara dari proyek terkait, format rupiah konsisten dan hasil cetak dapat diperiksa dengan fixture sintetis.


## Kwitansi bernomor (LPJ-05/08/09)

ReceiptPreview memakai CSS Modules, Inter dan ikon Kubai dekoratif pada toolbar dengan label teks. Pemilik membuka Tinjau kwitansi setelah transaksi terkonfirmasi; pembaca proyek membuka Lihat kwitansi yang sudah terbit. Dialog memuat penghalang, loading/gagal/retry, draf jelas sebelum nomor terbit, dan salinan snapshot sesudahnya. Escape/fokus kembali tersedia; simpan/hasil tidak pasti mengunci tutup, muat ulang dan cetak sampai retry terselesaikan. Konflik meminta tinjauan baru.

Cetak A4 menyembunyikan shell dan toolbar, mempertahankan label bruto/potongan/netto dan terbilang netto dari server, serta menampilkan PPK, Bendahara Pengeluaran, penerima dan NIP teks opsional. Blok tanda tangan tidak terpecah. Isian normal satu halaman; isian maksimum boleh dua halaman, dengan nomor pada footer halaman lanjutan. Pratinjau tidak mengganti pengesahan format institusi atau membuat arsip PDF final.


## Realisasi per tahap (LPJ-07/08/09)

Bagian detail proyek memakai StageRealization, CSS Modules, Inter dan ikon Kubai dari adapter bersama. Pemilik/editor/viewer dapat memilih tahap dari wizard dan memuat ulang. Tampilkan label Draf rekap terkini, batas inklusif dan waktu WIB. Ringkasan memisahkan plafon, target kumulatif, bruto, potongan, netto, kurang/lebih dari target dan sisa/kelebihan plafon. Jelaskan transaksi yang dikecualikan dan bahwa setoran tidak menambah realisasi. Tahap FINALIZED tetap diberi penjelasan bahwa tampilan ini bukan salinan arsip final.

Pergantian tahap menghilangkan nominal tahap sebelumnya selama loading. Kegagalan menampilkan pesan dan aksi muat ulang. Pencarian tujuan/item/tanggal dan halaman delapan baris hanya menyaring rincian; ringkasan tetap seluruh tahap. Tabel semantik mempunyai caption/header dan wrapper fokus berlabel yang dapat digulir pada ponsel tanpa melebarkan halaman. Angka rupiah tidak terpotong; tujuan/item panjang membungkus. Pilihan tahap tetap dapat diakses dengan keyboard saat pemuatan.
