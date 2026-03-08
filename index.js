const admin = require("firebase-admin");
const cron = require("node-cron");
const express = require("express");

const app = express();

// ============================================================
// INITIALISATION FIREBASE
// La clé est lue depuis la variable d'environnement FIREBASE_KEY
// On ne met JAMAIS la clé directement dans le code
// ============================================================
const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ============================================================
// ROUTE DE SANTÉ
// ============================================================
app.get("/", (req, res) => {
  res.send("Serveur notifications épargne — OK");
});

// ============================================================
// FONCTION : envoyer les notifications mensuelles
// ============================================================
async function envoyerRappelsEpargne() {
  console.log("Début envoi rappels épargne...");

  try {
    const usersSnap = await db.collection("users")
      .where("epargne_statut", "==", "active")
      .get();

    if (usersSnap.empty) {
      console.log("Aucun abonnement actif.");
      return;
    }

    console.log(usersSnap.size + " abonnement(s) actif(s).");

    for (const userDoc of usersSnap.docs) {
      const userData  = userDoc.data();
      const userId    = userDoc.id;
      const montant   = userData.epargne_montant   || 0;
      const frequence = userData.epargne_frequence || "Mensuelle";
      const fcmToken  = userData.fcm_token;

      if (!fcmToken) {
        console.log("Pas de token FCM pour " + userId);
        continue;
      }

      try {
        await admin.messaging().send({
          token: fcmToken,
          notification: {
            title: "Votre épargne est due !",
            body: "Prélèvement " + frequence + " de " + montant + " XOF.",
          },
          data: {
            type:      "epargne_rappel",
            montant:   montant.toString(),
            frequence: frequence,
            userId:    userId,
          },
          android: {
            notification: {
              color:       "#C7A263",
              clickAction: "FLUTTER_NOTIFICATION_CLICK",
            },
            priority: "high",
          },
          apns: {
            payload: {
              aps: { badge: 1, sound: "default" },
            },
          },
        });

        await db.collection("users").doc(userId)
          .collection("notifications").add({
            type:      "epargne_rappel",
            montant:   montant,
            frequence: frequence,
            lu:        false,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
          });

        console.log("Notification envoyée à " + userId);

      } catch (err) {
        console.error("Erreur pour " + userId + ": " + err.message);
        if (
          err.code === "messaging/invalid-registration-token" ||
          err.code === "messaging/registration-token-not-registered"
        ) {
          await db.collection("users").doc(userId).update({
            fcm_token: admin.firestore.FieldValue.delete(),
          });
        }
      }
    }

    console.log("Tous les rappels envoyés.");

  } catch (error) {
    console.error("Erreur générale:", error);
  }
}

// ============================================================
// CRON : 1er du mois à 9h00 heure Dakar
// ============================================================
cron.schedule("0 9 1 * *", function() {
  console.log("Déclenchement automatique 1er du mois...");
  envoyerRappelsEpargne();
}, {
  timezone: "Africa/Dakar",
});

// ============================================================
// ROUTE TEST MANUEL
// Va sur https://ton-serveur.render.com/test-notif pour tester
// ============================================================
app.get("/test-notif", async (req, res) => {
  console.log("Test manuel déclenché...");
  await envoyerRappelsEpargne();
  res.send("Test notifications envoyées");
});

// ============================================================
// DÉMARRAGE
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log("Serveur démarré sur le port " + PORT);
});