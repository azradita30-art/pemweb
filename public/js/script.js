// Inisialisasi Socket.IO dengan mode polling agar stabil di Vercel
// public/js/script.js
const socket = io({
    transports: ['polling'],
    upgrade: false,
    secure: true // Memaksa koneksi aman/HTTPS
});

// Tambahkan log ini untuk mengecek di console browser
socket.on('connect', () => {
    console.log('Terhubung ke Server melalui Socket.id:', socket.id);
});

socket.on('connect_error', (error) => {
    console.error('Gagal konek:', error);
});

// 1. Menangani Form Input Pasien Baru
const formPasien = document.getElementById('formPasien');
if (formPasien) {
    formPasien.addEventListener('submit', (e) => {
        e.preventDefault();

        // Ambil data dari input form
        const data = {
            nama: document.getElementById('nama').value,
            umur: document.getElementById('umur').value,
            spo2: document.getElementById('spo2').value,
            denyut: document.getElementById('denyut').value,
            tekanan: document.getElementById('tekanan').value
        };

        // Kirim data ke backend
        socket.emit('pasienBaru', data);

        // Reset form setelah kirim
        formPasien.reset();
        alert('Data pasien berhasil dikirim!');
    });
}

// 2. Menerima Data Realtime dari Server
socket.on('dataRealtime', (dataPasien) => {
    const tableBody = document.getElementById('tableBody');
    if (!tableBody) return;

    // Bersihkan tabel sebelum diisi ulang
    tableBody.innerHTML = '';

    // Loop data pasien dan masukkan ke baris tabel
    dataPasien.forEach((pasien) => {
        const row = document.createElement('tr');
        
        // Memberi warna baris berdasarkan triase
        const warnaTriase = {
            'merah': 'table-danger',
            'kuning': 'table-warning',
            'hijau': 'table-success'
        };

        row.className = warnaTriase[pasien.triase] || '';

        row.innerHTML = `
            <td>${pasien.nama}</td>
            <td>${pasien.umur} thn</td>
            <td>${pasien.spo2}%</td>
            <td>${pasien.denyut} bpm</td>
            <td>${pasien.tekanan} mmHg</td>
            <td><strong>${pasien.triase.toUpperCase()}</strong></td>
            <td>${pasien.waktuMenunggu} menit</td>
            <td>
                <button onclick="accPasien('${pasien.nama}')" class="btn btn-sm btn-primary">Selesai</button>
            </td>
        `;
        tableBody.appendChild(row);
    });
});

// 3. Fungsi untuk ACC/Selesai (Pindah ke Riwayat)
function accPasien(nama) {
    if (confirm(`Selesaikan penanganan untuk pasien ${nama}?`)) {
        socket.emit('accPasien', { nama: nama });
    }
}

// 4. Notifikasi jika waktu tunggu habis (Batas 0 menit)
socket.on('notif', (pasien) => {
    alert(`PERINGATAN: Pasien ${pasien.nama} (${pasien.triase}) harus segera ditangani!`);
});