// app.js
const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs/promises');
const { log } = require('console');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Paths
const filePath = path.join(__dirname, 'data', 'pasien.json');
const filePathRiwayat = path.join(__dirname, 'data', 'riwayat.json');

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
    const raw = await fs.readFile(filePathRiwayat, 'utf8');
    const dataRiwayat = JSON.parse(raw);
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
  const sistolik = Number(data.tekanan); // mengasumsikan hanya angka

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
    // Urutkan berdasarkan triase
    const p = prioritas[a.triase] - prioritas[b.triase];
    if (p !== 0) return p;

    // Jika triase sama → urutkan berdasarkan waktuMenunggu (lebih kecil = prioritas)
    return a.waktuMenunggu - b.waktuMenunggu;
  });
}

async function cariPasien(nama) {
  console.log('Ini pencarian Pasien');
  try {
    const file = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(file);
    return data.find((p) => p.nama === nama);
  } catch (err) {
    console.error('Gagal mencari pasien:', err);
    return undefined;
  }
}

async function deletePasien(nama) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    let data = JSON.parse(raw);

    console.log('Data pasien dalam delete');
    console.log(data);

    // Filter: buang yang punya nama tertentu
    data = data.filter((p) => p.nama !== nama);

    // Tulis ulang
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    console.log(`Pasien ${nama} berhasil dihapus.`);
  } catch (err) {
    console.error('Gagal menghapus pasien:', err);
  }
}

// ---------- Background Interval: Decrement waktuMenunggu & notif ----------
setInterval(async () => {
  try {
    let raw = await fs.readFile(filePath, 'utf8');

    if (!raw) return;

    // Kurangi waktuMenunggu tiap pasien, lalu urutkan
    let dataPasien = JSON.parse(raw).map((obj) => ({
      ...obj,
      waktuMenunggu: obj.waktuMenunggu - 1,
    }));

    dataPasien = urutkanTriase(dataPasien);

    // Cek notifikasi & batas
    const batas = 0; // batas waktu menunggu dalam menit
    dataPasien.forEach((pasien) => {
      if (pasien.waktuMenunggu <= batas && !pasien.notif) {
        io.emit('notif', pasien);
        pasien.notif = true; // set agar tidak mengirim ulang
      } else if (pasien.waktuMenunggu < 0) {
        pasien.waktuMenunggu = 0;
      }
    });

    // Simpan perubahan
    await fs.writeFile(filePath, JSON.stringify(dataPasien, null, 2));
    console.log('Data pasien berhasil disimpan!');
  } catch (err) {
    // Jika file belum ada atau terjadi error baca/tulis, laporkan
    console.error('Interval error (decrement/writing):', err);
  }
}, 1000);

// ---------- Socket.IO ----------
io.on('connection', (socket) => {
  console.log('Client terhubung:', socket.id);

  socket.on('disconnect', () => {
    console.log('Client terputus');
  });

  // Kirim data realtime tiap detik ke client yang terhubung
  setInterval(async () => {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const dataPasien = JSON.parse(raw);
      socket.emit('dataRealtime', dataPasien);
    } catch (err) {
      console.error('Gagal mengirim dataRealtime:', err);
      socket.emit('dataRealtime', []); // fallback agar client tetap menerima sesuatu
    }
  }, 1000);

  // Event: pasien baru masuk
  socket.on('pasienBaru', async (data) => {
    try {
      // Baca file (asumsi file sudah ada dan berisi array)
      const raw = await fs.readFile(filePath, 'utf8');
      const pasienList = JSON.parse(raw);

      const dataClassified = klasifikasiTriase(data);
      pasienList.push(dataClassified);

      await fs.writeFile(filePath, JSON.stringify(pasienList, null, 2));
    } catch (err) {
      console.error('Gagal menambahkan pasien baru:', err);
    }
  });

  // Event: accPasien (pindahkan ke riwayat dan hapus dari pasien.json)
  socket.on('accPasien', async (data) => {
    try {
      // Baca riwayat
      const rawRiwayat = await fs.readFile(filePathRiwayat, 'utf8');
      const pasienRiwayatList = JSON.parse(rawRiwayat);

      // Cari pasien dari pasien.json
      const pasienDipilih = await cariPasien(data.nama);

      // Hapus pasien dari pasien.json
      await deletePasien(data.nama);

      // Tambah ke riwayat
      pasienRiwayatList.push(pasienDipilih);
      await fs.writeFile(filePathRiwayat, JSON.stringify(pasienRiwayatList, null, 2));
    } catch (err) {
      console.error('Gagal memproses accPasien:', err);
    }
  });
});

// ---------- Start Server ----------
const PORT = 3000;
server.listen(PORT, () => {
  log(`Server berjalan di port ${PORT}`);
});
