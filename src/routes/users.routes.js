const express = require('express');
const router = express.Router();

const verifyFirebaseToken = require(
    '../middleware/authMiddleware'
);

const {
    syncUser,
    getMyProfile
} = require('../controllers/userController');

// Sincronización de usuarios
router.post(
    '/sync',
    verifyFirebaseToken,
    syncUser
);

// Consultar perfil del usuario autenticado
router.get(
    '/me',
    verifyFirebaseToken,
    getMyProfile
);

module.exports = router;
