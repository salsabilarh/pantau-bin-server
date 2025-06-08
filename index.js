const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://pantaubin-default-rtdb.firebaseio.com"
});

const db = admin.database();

// Kirim notifikasi FCM
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

// Cek volume kompartemen
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

function getSensorName(key) {
  return key === 'botol' ? 'Botol' :
         key === 'kaleng' ? 'Kaleng' :
         key === 'kertas' ? 'Kertas' :
         key === 'lainnya' ? 'Lainnya' :
         key;
}

// Jalankan setiap 1 menit
setInterval(checkCompartments, 60 * 1000);

console.log("Server pantau volume sampah aktif...");
checkCompartments();
