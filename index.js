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
  console.error("Gagal parse SERVICE_ACCOUNT_KEY:", err);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://pantaubin-default-rtdb.firebaseio.com"
});

const db = admin.database();

// Endpoint: Simpan token dari client
app.post('/register-token', async (req, res) => {
  const { token, userId } = req.body;

  if (!token || !userId) {
    return res.status(400).json({ error: 'token dan userId wajib diisi' });
  }

  try {
    const currentTokenSnap = await db.ref(`device_tokens/${userId}/token`).once("value");
    const currentToken = currentTokenSnap.val();

    if (currentToken === token) {
      return res.json({ success: true, message: 'Token sudah tersimpan dan sama' });
    }

    await db.ref(`device_tokens/${userId}`).set({ token });
    console.log("Token Expo diperbarui:", token, "untuk user:", userId);
    res.json({ success: true, message: 'Token berhasil disimpan' });
  } catch (error) {
    res.status(500).json({ error: 'Gagal menyimpan token', detail: error.message });
  }
});

// Fungsi kirim notifikasi ke token-token
async function sendNotification(tokens, title, body) {
  if (!tokens.length) return;

  const messages = tokens.map(token => ({
    to: token,
    sound: 'default',
    title,
    body,
    data: { title, body }
  }));

  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages.length === 1 ? messages[0] : messages),
    });

    const data = await res.json();
    console.log("Notifikasi dikirim:", data);
  } catch (err) {
    console.error("Gagal kirim notifikasi:", err);
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

// Simpan volume terakhir agar bisa deteksi naik dari <=80 ke >80
const currentVolume = {}; // e.g. { botol: 78 }

// Real-time listener tiap perubahan nilai kompartemen
const compartmentsRef = db.ref("compartments");

compartmentsRef.on("child_changed", async (snapshot) => {
  const key = snapshot.key;
  const volume = snapshot.val();

  if (!key || volume == null) return;

  const previous = currentVolume[key] ?? 0;
  currentVolume[key] = volume;

  const threshold = 80;

  // Kirim notifikasi hanya saat terjadi transisi dari ≤80 ke >80
  if (previous <= threshold && volume > threshold) {
    try {
      const tokenSnap = await db.ref("device_tokens").once("value");
      const tokensData = tokenSnap.val() || {};
      const tokens = Object.values(tokensData)
        .map(entry => entry.token)
        .filter(token => typeof token === 'string' && token.startsWith("ExponentPushToken"));

      if (!tokens.length) {
        console.log("Tidak ada token yang tersimpan.");
        return;
      }

      const name = getSensorName(key);
      const title = `Kompartemen ${name} Penuh!`;
      const body = `Volume ${name} sudah mencapai ${volume}%. Segera kosongkan.`;

      await sendNotification(tokens, title, body);
      console.log(`Notifikasi dikirim untuk ${key} pada volume ${volume}%`);
    } catch (err) {
      console.error("Gagal memproses notifikasi:", err);
    }
  } else {
    console.log(`${key} volume berubah ${previous}% → ${volume}%. Tidak kirim notifikasi.`);
  }
});

// Endpoint cek token yang tersimpan
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

// Mulai server
app.listen(port, () => {
  console.log(`Server berjalan di port ${port}`);
});
