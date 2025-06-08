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

// Endpoint: Simpan token Expo dari client
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

// Kirim notifikasi via Expo Push API
async function sendNotification(tokens, title, body) {
  if (!tokens || tokens.length === 0) return;

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
    console.error('Gagal kirim notifikasi Expo:', error);
  }
}

// Helper untuk sensor name
function getSensorName(key) {
  return key === 'botol' ? 'Botol' :
         key === 'kaleng' ? 'Kaleng' :
         key === 'kertas' ? 'Kertas' :
         key === 'lainnya' ? 'Lainnya' : key;
}

// Cache notifikasi terakhir per kompartemen (anti-spam)
const lastNotified = {}; // { botol: timestamp, kaleng: timestamp, ... }
const cooldownMs = 10 * 60 * 1000; // 10 menit cooldown per kompartemen

// Real-time listener ke Firebase
const compartmentsRef = db.ref("compartments");

compartmentsRef.on("value", async (snapshot) => {
  const data = snapshot.val();
  if (!data) return;

  const now = Date.now();
  const threshold = 80;
  const compartmentsToCheck = ['botol', 'kaleng', 'kertas', 'lainnya'];

  const fullCompartments = compartmentsToCheck.filter(key =>
    data[key] >= threshold && (!lastNotified[key] || now - lastNotified[key] > cooldownMs)
  );

  if (fullCompartments.length === 0) return;

  const tokensSnapshot = await db.ref('device_tokens').once('value');
  const tokensData = tokensSnapshot.val() || {};
  const tokens = Object.values(tokensData)
    .map(item => item.token)
    .filter(token => token && typeof token === 'string');

  if (tokens.length === 0) {
    console.log("❌ Tidak ada token terdaftar.");
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

    lastNotified[key] = now;
  }
});

// Endpoint debug untuk cek token
app.get('/check-tokens', async (req, res) => {
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
});

// Start Express
app.listen(port, () => {
  console.log(`🚀 Server berjalan di port ${port}`);
});
