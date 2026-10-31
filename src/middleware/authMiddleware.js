
const firebaseAuth = require('../config/firebaseAdmin');

/**
 * Middleware para validar tokens de Firebase.
 * Protege los endpoints de Nexora.
 */
const verifyFirebaseToken = async (req, res, next) => {

    const authorization = req.headers.authorization || '';

    // Verificar que se envió un Bearer Token
    if (!authorization.startsWith('Bearer ')) {
        return res.status(401).json({
            ok: false,
            message: 'Token de autenticación requerido.'
        });
    }

    const token = authorization.slice(7).trim();

    if (!token) {
        return res.status(401).json({
            ok: false,
            message: 'Token de autenticación requerido.'
        });
    }

    try {
        // Validar token mediante Firebase Admin
        const decodedToken = await firebaseAuth.verifyIdToken(token);

        // Guardar identidad autenticada en la petición
        req.firebaseUser = decodedToken;

        // Continuar hacia el endpoint
        next();

    } catch (error) {
        console.error(
            'Error verificando token Firebase:',
            error.code || error.message
        );

        return res.status(401).json({
            ok: false,
            message: 'Token inválido o expirado.'
        });
    }
};

module.exports = verifyFirebaseToken;
