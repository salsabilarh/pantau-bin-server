require('dotenv').config();
const express = require('express');
const admin = require('firebase-admin');
const fetch = require('node-fetch'); // Untuk kirim notifikasi ke Expo

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

let serviceAccount;

try {
  serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_KEY);
} catch (err) {
  console.error("Gagal parse SERVICE_ACCOUNT_KEY. Periksa formatnya!", err);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://pantaubin-default-rtdb.firebaseio.com"
});

const db = admin.database();

// Endpoint: Simpan token dari Expo app
app.post('/register-token', async (req, res) => {
  const { token, userId } = req.body;

  if (!token || !userId) {
    return res.status(400).json({ error: 'token dan userId wajib diisi' });
  }

  try {
    await db.ref(`device_tokens/${userId}`).set({ token });
    console.log("Token Expo diterima:", token, "untuk user:", userId);
    res.json({ success: true, message: 'Token berhasil disimpan' });
  } catch (error) {
    res.status(500).json({ error: 'Gagal menyimpan token', detail: error.message });
  }
});

// Fungsi untuk kirim notifikasi via Expo Push API
async function sendNotification(tokens, title, body) {
  if (!tokens || tokens.length === 0) {
    console.log("Tidak ada token yang tersedia.");
    return;
  }

  const messages = tokens.map(token => ({
    to: token,
    sound: 'default',
    title: title,
    body: body,
    data: { title, body }
  }));

  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages.length === 1 ? messages[0] : messages),
    });

    const data = await response.json();
    console.log("Notifikasi dikirim (Expo):", data);
  } catch (error) {
    console.error('Gagal kirim notifikasi via Expo:', error);
  }
}

// Fungsi untuk cek volume kompartemen
async function checkCompartments() {
  const ref = db.ref('compartments');
  const snapshot = await ref.once('value');
  const data = snapshot.val();

  if (!data) {
    console.log("Data kompartemen tidak ditemukan.");
    return;
  }

  const threshold = 80;
  const compartmentsToCheck = ['botol', 'kaleng', 'kertas', 'lainnya'];
  const fullCompartments = compartmentsToCheck.filter(key => data[key] >= threshold);

  if (fullCompartments.length > 0) {
    const tokensRef = db.ref('device_tokens');
    const tokensSnapshot = await tokensRef.once('value');
    const tokensData = tokensSnapshot.val() || {};

    const tokens = Object.values(tokensData)
      .map(item => item.token)
      .filter(token => token && typeof token === 'string');

    if (tokens.length === 0) {
      console.log("Tidak ada token pengguna terdaftar.");
      return;
    }

    for (const compartment of fullCompartments) {
      const name = getSensorName(compartment);
      const volume = data[compartment];
      await sendNotification(
        tokens,
        `Kompartemen ${name} Penuh!`,
        `Volume ${name} telah mencapai ${volume}%. Segera kosongkan.`
      );
    }
  } else {
    console.log("Semua kompartemen masih di bawah ambang batas.");
  }
}

// Helper nama sensor
function getSensorName(key) {
  return key === 'botol' ? 'Botol' :
         key === 'kaleng' ? 'Kaleng' :
         key === 'kertas' ? 'Kertas' :
         key === 'lainnya' ? 'Lainnya' :
         key;
}

// Jalankan pemeriksaan otomatis tiap 1 menit
setInterval(checkCompartments, 60 * 1000);

// Endpoint untuk trigger manual (untuk testing)
app.post('/trigger-check', async (req, res) => {
  await checkCompartments();
  res.json({ success: true, message: 'Pemeriksaan manual selesai' });
});

// Endpoint: Lihat semua token yang tersimpan di database
app.get('/check-tokens', async (req, res) => {
  try {
    const snapshot = await db.ref('device_tokens').once('value');
    const tokensData = snapshot.val();

    if (!tokensData) {
      return res.status(404).json({ success: false, message: 'Belum ada token tersimpan.' });
    }

    const result = Object.entries(tokensData).map(([userId, data]) => ({
      userId,
      token: data.token,
    }));

    res.json({ success: true, tokens: result });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal membaca token.', error: err.message });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  console.log("Server pemantauan sampah aktif...");
  checkCompartments(); // Langsung cek saat server mulai
});
