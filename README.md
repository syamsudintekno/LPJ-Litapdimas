# LPJ Litapdimas

Aplikasi React untuk penyusunan LPJ penelitian. Antarmuka di GitHub Pages, layanan RPC di Google Apps Script, tabel di Google Sheets privat, bukti dan arsip di Google Drive privat.

## Menjalankan dan membangun

Gunakan Node.js 24 dan pnpm. Jalankan `pnpm install --frozen-lockfile`, `pnpm dev`, atau `pnpm build`. Sediakan `config.json` lokal berisi `apps_script_url` dan `google_client_id`; berkas ini diabaikan Git. URL endpoint dan Google Client ID untuk hosting disiapkan workflow Pages melalui repository variables. Kredensial OAuth dan data LPJ tidak masuk repositori.

Atas arahan pengguna pada 19 November 2026, pengujian penerimaan dikerjakan pengguna. CI hanya membangun. Tes tetap tersedia melalui `pnpm test` atau workflow **Check LPJ contracts and build** yang dipicu manual dengan `run_tests=true`.

## Penggunaan

1. Pemilik mengimpor personel, membuat proyek melalui wizard, menetapkan tim/pejabat/tahap dan mengaktifkan proyek. Mahasiswa diketik langsung. Identitas, tim dan tahap proyek dapat disunting sebelum ada arsip final; perubahan memakai versi data terbaru.
2. Susun dan sahkan RAB, buat kegiatan/rundown, isi peserta, distribusi dan logbook. Pemilik mendaftarkan penerima pembayaran melalui bagian pengelolaan proyek.
3. Catat transaksi, unggah atau tautkan bukti, periksa pajak, konfirmasi transaksi dan terbitkan kwitansi. Seluruh nominal dihitung server dalam rupiah integer.
4. Catat penerimaan dana aktual dan bukti, alokasikan setoran pajak ke potongan asal, serta tautkan distribusi ke transaksi terkonfirmasi. Rekap 100% selalu kumulatif dan setoran tidak menambah realisasi.
5. Tinjau paket tahap, lengkapi penghalang, cocokkan format resmi, lalu finalkan. PDF, snapshot dan salinan bukti disimpan privat. Arsip dibaca dari snapshot, bukan master terkini.
6. Pemilik mengelola undangan/peran/pencabutan, melihat audit, membuat cadangan lengkap, atau memulihkan ke salinan baru. Pemulihan tidak menimpa workspace aktif.

## Penyiapan layanan lengkap

Unggah seluruh `.gs`, `Index.html` dan manifest dari `stage0/` ke Apps Script. Manifest memerlukan akses Drive tulis untuk unggahan, arsip dan cadangan. Setelah kode diperbarui, **pemilik menjalankan `prepareWorkspace` sekali dari editor dan menyetujui izin Google**, lalu memperbarui deployment pada URL yang sama. Helper menambah tabel/header yang kurang dan mempertahankan data yang sudah ada. Spreadsheet harus berada dalam satu folder LPJ privat. Langkah rinci dan pemulihan ada di [panduan deployment](stage0/README.md).

PPK, bendahara dan mahasiswa adalah personel dokumen tanpa akun aplikasi. Akun hanya untuk pemilik dan anggota peneliti yang diundang. Folder/Sheets tidak perlu dibagikan ke anggota untuk memakai RPC.

## Dokumen proyek

[PRD](PRD.md), [arsitektur dan kontrak](ARCHITECTURE.md), [aturan desain](DESIGN.md), [rencana implementasi](IMPLEMENTATION_PLAN.md), dan [status penyelesaian](COMPLETION_STATUS.md). Repo publik hanya memuat sumber serta fixture sintetis. Persetujuan format LPJ, perlakuan pajak, uji akun/akses dan uji pemulihan tetap tanggung jawab pemilik sesuai alur aplikasi.
