# Si Jantan · Verifikasi Klaim JPKM Jawa Barat

Proyek uji lokal Windows. Antarmuka Vite + React, API Node.js, penyimpanan SQLite, PDF.js untuk halaman sumber, serta Tesseract.js untuk OCR lokal dalam bahasa Indonesia dan Inggris.

## Menjalankan

1. Di terminal, buka `C:\JPKM Jabar\SiJantan`. Pada komputer baru, siapkan Node.js 24 atau lebih baru dan jalankan `npm ci`.
2. Jalankan `npm start` atau buka `Jalankan.cmd`, lalu akses **http://127.0.0.1:8766**. Jalankan `npm run build` setelah mengubah antarmuka.
3. Untuk pengembangan, jalankan `npm run dev` di terminal kedua dan akses **http://127.0.0.1:5173**. Vite meneruskan permintaan API ke Node.js.

Port backend dapat diubah lewat `SIJANTAN_PORT`. Gunakan nilai yang sama pada terminal Vite dan backend. Node.js membuka database yang sama di `%LOCALAPPDATA%\SiJantanVerifikasi`, atau folder yang ditentukan melalui `SIJANTAN_DATA`. Episode yang sudah diimpor tetap menggunakan hasil bacaan dan PDF yang tersimpan. Model OCR berada di `ocr-data` dari proyek lokal Akurat iDRG. Pembacaan PDF berlangsung di perangkat ini.

## Alur kerja

- **Administrasi.** Impor PDF untuk satu episode atau paket pengajuan. Pilih jenis layanan dan kategori sasaran, lalu buka halaman sumber setiap indikator. Pemeriksaan status JKN dan dokumen paket mengikuti Standar Pelayanan Dinkes Jawa Barat, Keputusan Kepala Dinas Nomor KPG.03.01.01/Kep.10537-Diskes/2025. [Standar Pelayanan](https://ppid-diskes.jabarprov.go.id/assets/ppid/standar-pelayanan1.pdf)
- **Audit Coding.** Konfirmasi kode pada Berkas Klaim Individual dan periksa peringatan beserta acuan yang terdaftar. Jika nomor atau ketentuan spesifik belum tercatat, konfirmasi acuan yang berlaku.
- **Verifikasi Medis.** Klik nomor halaman pada indikator untuk membuka bukti klinis yang terdeteksi. Triase diperiksa untuk IGD dan Rawat Inap. Aplikasi membedakan dokumen triase yang ditemukan dan pilihan kategori yang terbaca. Evaluasi riwayat lintas episode, PRB, dan aturan berbasis komponen tarif terstruktur memerlukan data tambahan.
- **Kelola PDF.** Gunakan **Hapus PDF ini** di panel **Bukti PDF** untuk memindahkan lampiran yang dipilih. Perubahan lampiran membuka ulang verifikasi episode. Gunakan **Hapus berkas episode** atau **Reset daftar PDF** di **Daftar kerja** untuk memindahkan seluruh episode yang dipilih, atau semua episode dan paket. Berkas bisa dipulihkan lewat **Sampah**.
- **Hasil klaim.** Verifikator menetapkan Layak Klaim, Pending Klaim, Dispute, atau Tidak Layak. Keputusan tercantum pada rekap. Gunakan filter status dan tanggal pelayanan atau unduh CSV.
- **Berita acara.** Pilih episode yang sudah ditetapkan, isi identitas dan periode dokumen, lalu simpan. Cetak atau pilih Simpan PDF dari dialog cetak. Arsip berita acara menyimpan hasil pada saat dokumen dibuat. Format cetak diberi label uji coba sampai format resmi dan susunan penanda tangan dikonfirmasi.
