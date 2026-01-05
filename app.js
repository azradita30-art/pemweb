// app.js
const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
// const fs = require('fs/promises'); // FS dimatikan untuk Vercel (Serverless tidak bisa tulis file)
const { log } = require('console');

const app = express();
const server = http.createServer(app);
const socket = io();
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['polling'], // <--- WAJIB UNTUK VERCEL
  allowEIO3: true          // Kompatibilitas tambahan
});

// ---------- IN-MEMORY DATABASE (Pengganti File JSON) ----------
// Karena Vercel tidak bisa tulis file (fs.writeFile), kita simpan data di variabel.
// PERINGATAN: Data akan hilang jika server restart/redeploy.
let DB_PASIEN = []; 
let DB_RIWAYAT = [];

// Express setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Routes ----------
app.get('/', (req, res) => {
  res.render('dashboard');
});

app.get('/riwayat', async (req, res) => {
  try {
    // Diganti: ambil langsung dari variabel
    const dataRiwayat = DB_RIWAYAT;
    console.log('Data riwayat di app.js');
    console.log(dataRiwayat);
    res.render('riwayat', { data_riwayat: dataRiwayat });
  } catch (err) {
    console.error('Gagal membaca riwayat:', err);
    res.render('riwayat', { data_riwayat: [] });
  }
});

// ---------- Triase / Utility Functions ----------
function klasifikasiTriase(data) {
  console.log('Ini data klasifikasi');
  console.log(data);

  const spo2Num = Number(data.spo2);
  const nadiNum = Number(data.denyut);
  const sistolik = Number(data.tekanan);

  let triase;
  let waktuMenunggu;

  // ======== CEK MERAH ========
  if (spo2Num < 90) triase = 'merah';
  else if (nadiNum > 120 || nadiNum < 50) triase = 'merah';
  else if (sistolik < 90 || sistolik > 180) triase = 'merah';

  // ======== CEK KUNING ========
  else if (spo2Num >= 90 && spo2Num < 95) triase = 'kuning';
  else if (nadiNum >= 100 && nadiNum <= 120) triase = 'kuning';
  else if (sistolik >= 140 && sistolik <= 180) triase = 'kuning';

  // ======== JIKA TIDAK MERAH ATAU KUNING → HIJAU ========
  else triase = 'hijau';

  // ======== Tentukan waktu menunggu ========
  waktuMenunggu = 30; // default hijau
  if (triase === 'kuning') waktuMenunggu = 20;
  else if (triase === 'merah') waktuMenunggu = 10;

  return {
    nama: data.nama,
    umur: data.umur,
    spo2: spo2Num,
    denyut: nadiNum,
    tekanan: sistolik,
    waktuMenunggu,
    notif: false,
    triase,
  };
}

function urutkanTriase(data) {
  const prioritas = { merah: 1, kuning: 2, hijau: 3 };

  return data.sort((a, b) => {
    const p = prioritas[a.triase] - prioritas[b.triase];
    if (p !== 0) return p;
    return a.waktuMenunggu - b.waktuMenunggu;
  });
}

// Fungsi ini sekarang mencari di variabel array, bukan file
async function cariPasien(nama) {
  console.log('Ini pencarian Pasien');
  return DB_PASIEN.find((p) => p.nama === nama);
}

// Fungsi ini menghapus dari variabel array
async function deletePasien(nama) {
  try {
    console.log('Data pasien dalam delete');
    // Filter array
    DB_PASIEN = DB_PASIEN.filter((p) => p.nama !== nama);
    console.log(`Pasien ${nama} berhasil dihapus.`);
  } catch (err) {
    console.error('Gagal menghapus pasien:', err);
  }
}

// ---------- Background Interval: Decrement waktuMenunggu & notif ----------
// Catatan Vercel: Interval ini mungkin pause jika tidak ada request masuk.
setInterval(() => {
  try {
    if (DB_PASIEN.length === 0) return;

    // Kurangi waktuMenunggu
    let dataPasien = DB_PASIEN.map((obj) => ({
      ...obj,
      waktuMenunggu: obj.waktuMenunggu - 1,
    }));

    dataPasien = urutkanTriase(dataPasien);

    // Cek notifikasi & batas
    const batas = 0; 
    dataPasien.forEach((pasien) => {
      if (pasien.waktuMenunggu <= batas && !pasien.notif) {
        io.emit('notif', pasien);
        pasien.notif = true; 
      } else if (pasien.waktuMenunggu < 0) {
        pasien.waktuMenunggu = 0;
      }
    });

    // Simpan ke Variabel Global
    DB_PASIEN = dataPasien;
    // console.log('Data pasien berhasil diupdate di memori'); 
  } catch (err) {
    console.error('Interval error:', err);
  }
}, 60000); // 1 menit

// ---------- Socket.IO ----------
io.on('connection', (socket) => {
  console.log('Client terhubung:', socket.id);

  socket.on('disconnect', () => {
    console.log('Client terputus');
  });

  // Kirim data realtime tiap detik ke client yang terhubung
  // Kita simpan ID interval agar bisa dibersihkan saat disconnect (Best Practice)
  const realtimeInterval = setInterval(() => {
    try {
      socket.emit('dataRealtime', DB_PASIEN);
    } catch (err) {
      console.error('Gagal mengirim dataRealtime:', err);
      socket.emit('dataRealtime', []); 
    }
  }, 1000);

  // Bersihkan interval jika client putus agar server tidak berat
  socket.on('disconnect', () => {
    clearInterval(realtimeInterval);
  });

  // Event: pasien baru masuk
  socket.on('pasienBaru', (data) => {
    try {
      const dataClassified = klasifikasiTriase(data);
      DB_PASIEN.push(dataClassified);
      console.log('Pasien baru ditambahkan ke Memori');
    } catch (err) {
      console.error('Gagal menambahkan pasien baru:', err);
    }
  });

  // Event: accPasien
  socket.on('accPasien', async (data) => {
    try {
      const pasienDipilih = await cariPasien(data.nama);
      if (pasienDipilih) {
        await deletePasien(data.nama);
        DB_RIWAYAT.push(pasienDipilih);
      }
    } catch (err) {
      console.error('Gagal memproses accPasien:', err);
    }
  });
});

// ---------- Start Server ----------
// Vercel menyuntikkan port lewat process.env.PORT
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  log(`Server berjalan di port ${PORT}`);
});

// Export app diperlukan oleh Vercel dalam beberapa kasus setup
module.exports = app;