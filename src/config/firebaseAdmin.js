
const {
    initializeApp,
    applicationDefault,
    getApps
} = require('firebase-admin/app');

const { getAuth } = require('firebase-admin/auth');

// Inicializar Firebase Admin solo una vez
if (!getApps().length) {
    initializeApp({
        credential: applicationDefault(),
        projectId: process.env.FIREBASE_PROJECT_ID
    });
}

// Exportar el servicio de autenticación
const firebaseAuth = getAuth();

module.exports = firebaseAuth;
