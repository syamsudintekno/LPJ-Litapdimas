# Panduan UI LPJ Litapdimas

Rujukan cakupan dan istilah ada di [PRD.md](PRD.md). Nama field dan status teknis mengikuti [ARCHITECTURE.md](ARCHITECTURE.md).

## Sistem visual

Prototipe awal HTML Service memakai panel uji dengan token warna dasar. Sistem visual berikut berlaku untuk UI aplikasi di GitHub Pages.

Gunakan React, komponen internal, **CSS Modules**, dan **Lucide React** untuk ikon. Gunakan **Inter** dengan fallback system-ui. Simpan token di `src/styles/tokens.css`, aturan global di `globals.css`, dan aturan cetak di `print.css`. Aturan komponen berada di file `*.module.css`. Hindari inline CSS dan penambahan UI kit atau paket ikon kedua. Gunakan atribut data atau kelas untuk variasi status dan ukuran.

### Referensi pengembangan frontend

Gunakan [CoreUI Free React Admin Template](https://github.com/coreui/coreui-free-react-admin-template) sebagai referensi tata letak dashboard. Untuk konteks saat mengembangkan halaman baru, rujuk [panduan AI-assisted development](https://github.com/coreui/coreui-free-react-admin-template/blob/main/README.md#ai-friendly-development), [arsitektur template](https://github.com/coreui/coreui-free-react-admin-template/blob/main/ARCHITECTURE.md), dan [panduan pengembangan](https://github.com/coreui/coreui-free-react-admin-template/blob/main/DEVELOPMENT.md).

Terapkan pola sidebar yang dapat dilipat, header yang menunjukkan konteks halaman, dan kartu ringkasan berbasis data server. Implementasikan pola tersebut dengan komponen internal React, CSS Modules, token LPJ, dan ikon Lucide React sesuai sistem visual di atas.

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
| Button dan IconButton | Satu aksi utama per formulir. Ikon Lucide 16–20 px. Tombol ikon punya nama aksesibel. Tampilkan progres simpan dan cegah kirim berulang. |
| FormField dan PersonPicker | Label terlihat, bantuan dekat field, dan pesan kesalahan spesifik. Tampilkan nama, kategori dan unit seperlunya untuk membedakan orang dengan nama sama. |
| SetupWizard | Langkah Identitas → Tim → Pejabat → Tahap LPJ → Tinjau. Tombol kembali mempertahankan draf. Ringkasan menampilkan data yang harus dilengkapi sebelum aktivasi. |
| DataTable | Header semantik, filter eksplisit dan navigasi halaman. Pada ponsel, tabel padat boleh bergulir horizontal dalam wrapper berlabel. Utamakan kolom identitas, status, dan nominal. |
| ImportPreview | Tampilkan valid, duplikat dan perlu koreksi dengan nomor baris. Pisahkan pratinjau dari tindakan impor. |
| TaxSummary | Tampilkan nominal kwitansi, potongan, tambahan pajak bila ada, dan jumlah diterima dengan label tersendiri. Pemilik dapat memeriksa dasar aturan, penanda verifikasi, bukti dan alasan koreksi. |
| StatusBadge dan Notice | Label teks untuk Draf, Perlu verifikasi, Terverifikasi, dan Final. Kesalahan simpan tetap terlihat sampai ditangani. |
| DocumentPreview | Tampilkan tahap, tanggal batas, versi dokumen dan kelengkapan. Gunakan halaman A4, ulangi header tabel bila perlu, dan periksa blok tanda tangan serta pemenggalan baris. Tampilan cetak menghilangkan navigasi dan tombol. |

## Syarat penerimaan UI

- Formulir, tab, pemilih personel, dialog, dan navigasi berfungsi dengan keyboard. Fokus terlihat, urutan tab mengikuti alur, dan fokus kembali ke pemicu setelah dialog ditutup.
- Sediakan tampilan loading, kosong, gagal dan siap pada layar yang mengambil data. Kesalahan validasi mengarahkan pengguna ke field terkait tanpa menghapus isian.
- Pada lebar 360 px, wizard dan formulir transaksi dapat diselesaikan tanpa gulir horizontal halaman. Desktop menunjukkan konteks proyek, tabel, dan tindakan utama dengan jelas.
- Pratinjau kwitansi menerapkan identitas PPK dan bendahara dari proyek terkait, format rupiah konsisten dan hasil cetak dapat diperiksa dengan fixture sintetis.
