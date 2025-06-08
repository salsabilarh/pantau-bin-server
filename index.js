require('dotenv').config();
const express = require('express');
const admin = require('firebase-admin');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json()); // untuk parsing JSON di request body

const serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_KEY);

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
    res.json({ success: true, message: 'Token berhasil disimpan' });
  } catch (error) {
    res.status(500).json({ error: 'Gagal menyimpan token', detail: error.message });
  }
});

// Fungsi untuk kirim notifikasi FCM
async function sendNotification(tokens, title, body) {
  if (tokens.length === 0) {
    console.log("Tidak ada device token.");
    return;
  }

  const message = {
    notification: { title, body },
    tokens: tokens,
  };

  try {
    const response = await admin.messaging().sendMulticast(message);
    console.log(`Notifikasi terkirim ke ${response.successCount} device(s).`);
  } catch (error) {
    console.error("Gagal kirim notifikasi:", error);
  }
}

// Fungsi untuk cek volume kompartemen
async function checkCompartments() {
  const ref = db.ref('compartments');
  ref.once('value', async (snapshot) => {
    const data = snapshot.val();

    if (!data) {
      console.log("Data tidak ditemukan.");
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
        .filter(Boolean);

      for (const compartment of fullCompartments) {
        const name = getSensorName(compartment);
        const volume = data[compartment];
        await sendNotification(
          tokens,
          `Kompartemen ${name} Penuh!`,
          `Volume ${name} telah mencapai ${volume}%. Segera kosongkan.`
        );
      }
    }
  });
}

// Fungsi helper untuk nama sensor
function getSensorName(key) {
  return key === 'botol' ? 'Botol' :
         key === 'kaleng' ? 'Kaleng' :
         key === 'kertas' ? 'Kertas' :
         key === 'lainnya' ? 'Lainnya' :
         key;
}

// Jalankan setiap 1 menit
setInterval(checkCompartments, 60 * 1000);

// Jalankan Express server
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  console.log("Server pantau volume sampah aktif...");
  checkCompartments(); // Jalankan langsung saat startup
});
