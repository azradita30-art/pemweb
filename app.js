const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Konfigurasi Socket.io khusus Vercel
const io = new Server(server, {
  cors: { origin: "*" },
  transports: ['polling'] // Serverless Vercel lebih stabil dengan polling
});

// Database Sementara (Data akan reset jika server idle/restart)
let dataPasien = [];
let dataRiwayat = [];

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Routes ----------
app.get('/', (req, res) => {
  res.render('dashboard');
});

app.get('/riwayat', (req, res) => {
  res.render('riwayat', { data_riwayat: dataRiwayat });
});

// ---------- Logic Triase ----------
function klasifikasiTriase(data) {
  const spo2Num = Number(data.spo2);
  const nadiNum = Number(data.denyut);
  const sistolik = Number(data.tekanan);

  let triase = 'hijau';
  if (spo2Num < 90 || nadiNum > 120 || nadiNum < 50 || sistolik < 90 || sistolik > 180) triase = 'merah';
  else if (spo2Num < 95 || nadiNum >= 100 || sistolik >= 140) triase = 'kuning';

  let waktu = triase === 'merah' ? 10 : (triase === 'kuning' ? 20 : 30);

  return { ...data, spo2: spo2Num, denyut: nadiNum, tekanan: sistolik, waktuMenunggu: waktu, triase, notif: false };
}

// ---------- Socket.IO ----------
io.on('connection', (socket) => {
  // Kirim data awal saat user connect
  socket.emit('dataRealtime', dataPasien);

  socket.on('pasienBaru', (data) => {
    const hasil = klasifikasiTriase(data);
    dataPasien.push(hasil);
    // Urutkan (Merah dulu)
    const prioritas = { merah: 1, kuning: 2, hijau: 3 };
    dataPasien.sort((a, b) => prioritas[a.triase] - prioritas[b.triase]);
    io.emit('dataRealtime', dataPasien);
  });

  socket.on('accPasien', (data) => {
    const index = dataPasien.findIndex(p => p.nama === data.nama);
    if (index !== -1) {
      const pasien = dataPasien.splice(index, 1)[0];
      dataRiwayat.push(pasien);
      io.emit('dataRealtime', dataPasien);
    }
  });
});

// Timer Pengurang Waktu (Berjalan selama ada user aktif)
setInterval(() => {
  if (dataPasien.length > 0) {
    dataPasien = dataPasien.map(p => ({
      ...p,
      waktuMenunggu: Math.max(0, p.waktuMenunggu - 1)
    }));
    io.emit('dataRealtime', dataPasien);
  }
}, 60000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = server;