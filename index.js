require('dotenv').config();
const express = require('express');
const admin = require('firebase-admin');
const fetch = require('node-fetch');

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

  if (!token.startsWith('ExponentPushToken')) {
    return res.status(400).json({ error: 'Token tidak valid (bukan Expo).' });
  }

  try {
    await db.ref(`device_tokens/${userId}`).set({ token });
    console.log("✅ Token Expo diterima:", token, "untuk user:", userId);
    res.json({ success: true, message: 'Token berhasil disimpan' });
  } catch (error) {
    res.status(500).json({ error: 'Gagal menyimpan token', detail: error.message });
  }
});

// Fungsi kirim notifikasi via Expo Push API
async function sendNotification(tokens, title, body) {
  if (!tokens || tokens.length === 0) {
    console.log("⚠️ Tidak ada token untuk dikirim.");
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
    console.log("📤 Notifikasi dikirim (Expo):", data);
  } catch (error) {
    console.error("❌ Gagal kirim notifikasi:", error);
  }
}

// Cache notifikasi terakhir per kompartemen (hindari spam)
const lastNotified = {};

// Jalankan listener real-time
const compartmentsRef = db.ref("compartments");
compartmentsRef.on("value", async (snapshot) => {
  const data = snapshot.val();
  if (!data) return;

  const threshold = 80;
  const now = Date.now();
  const compartments = ['botol', 'kaleng', 'kertas', 'lainnya'];

  const fullCompartments = compartments.filter(key => {
    const alreadyNotified = lastNotified[key];
    return data[key] >= threshold && (!alreadyNotified || now - alreadyNotified > 10 * 60 * 1000); // cooldown 10 menit
  });

  if (fullCompartments.length === 0) return;

  // Ambil token dari database
  const tokensSnapshot = await db.ref('device_tokens').once('value');
  const tokensData = tokensSnapshot.val() || {};
  const tokens = Object.values(tokensData)
    .map(item => item.token)
    .filter(token => typeof token === 'string');

  if (tokens.length === 0) {
    console.log("⚠️ Tidak ada token pengguna.");
    return;
  }

  for (const key of fullCompartments) {
    const name = getSensorName(key);
    const volume = data[key];

    await sendNotification(
      tokens,
      `Kompartemen ${name} Penuh!`,
      `Volume ${name} mencapai ${volume}%. Segera kosongkan.`
    );

    lastNotified[key] = now; // Simpan waktu notifikasi
  }
});

// Helper: Ubah key menjadi nama sensor
function getSensorName(key) {
  return key === 'botol' ? 'Botol' :
         key === 'kaleng' ? 'Kaleng' :
         key === 'kertas' ? 'Kertas' :
         key === 'lainnya' ? 'Lainnya' : key;
}

// Endpoint untuk cek semua token
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
  console.log(`🚀 Server listening on port ${port}`);
});
