require('dotenv').config();

const express = require('express');
const cors = require('cors');
const pool = require('./src/config/database');

const verifyFirebaseToken = require(
    './src/middleware/authMiddleware'
);

const classroomRoutes = require(
    './src/routes/classrooms.routes'
);

const studentRoutes = require(
    './src/routes/students.routes'
);

const studentRemovalRoutes = require(
    './src/routes/studentRemoval.routes'
);

const userRoutes = require('./src/routes/users.routes');
const postRoutes = require('./src/routes/posts.routes');

const app = express();

/* ==========================================
   CONFIGURACIÓN CORS - NEXORA
   ========================================== */

// Dominios autorizados para consumir la API.
// Puedes agregar dominios adicionales desde .env
// utilizando CORS_ORIGINS separados por comas.

const defaultOrigins = [
    'https://education.astracode.org',
    'http://localhost:5173',
    'http://127.0.0.1:5173'
];

const extraOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);

const allowedOrigins = [
    ...new Set([...defaultOrigins, ...extraOrigins])
];

const corsOptions = {
    origin: (origin, callback) => {

        // Peticiones sin encabezado Origin:
        // Postman, aplicaciones nativas, servidor a servidor.
        if (!origin) {
            return callback(null, true);
        }

        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        console.warn(`CORS: origen no autorizado: ${origin}`);

        // No incluir cabeceras CORS para orígenes
        // que no estén en la lista permitida.
        return callback(null, false);
    },

    methods: [
        'GET',
        'POST',
        'PUT',
        'PATCH',
        'DELETE',
        'OPTIONS'
    ],

    allowedHeaders: [
        'Content-Type',
        'Authorization'
    ],

    optionsSuccessStatus: 204
};

// Aplicar CORS antes de registrar las rutas.
app.use(cors(corsOptions));

// Procesar solicitudes JSON.
app.use(express.json());

/* ==========================================
   RUTAS DE LA API
   ========================================== */

app.use('/api/users', userRoutes);
app.use('/api/classrooms', classroomRoutes);
app.use('/api/classrooms', studentRoutes);
app.use('/api/classrooms', postRoutes);
app.use('/api/classrooms', studentRemovalRoutes);

/* ==========================================
   CONFIGURACIÓN DEL SERVIDOR
   ========================================== */

const PORT = process.env.PORT || 3000;

/* ==========================================
   ENDPOINT DE COMPROBACIÓN
   ========================================== */

app.get('/api/health', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                NOW() AS fecha_servidor,
                to_regclass('public.app_user') IS NOT NULL AS usuarios,
                to_regclass('public.school') IS NOT NULL AS colegios,
                to_regclass('public.classroom') IS NOT NULL AS clases,
                to_regclass('public.student') IS NOT NULL AS estudiantes
        `);

        res.json({
            ok: true,
            database: 'connected',
            schema: result.rows[0]
        });

    } catch (error) {
        console.error('Error PostgreSQL:', error.message);

        res.status(500).json({
            ok: false,
            database: 'disconnected'
        });
    }
});

/* ==========================================
   PRUEBA DE AUTENTICACIÓN FIREBASE
   ========================================== */

app.get(
    '/api/auth/check',
    verifyFirebaseToken,
    (req, res) => {
        res.json({
            ok: true,
            message: 'Usuario autenticado correctamente',
            user: {
                uid: req.firebaseUser.uid,
                email: req.firebaseUser.email || null,
                emailVerified:
                    req.firebaseUser.email_verified || false
            }
        });
    }
);

/* ==========================================
   ROLES DE AUTORREGISTRO
   ========================================== */

const SELF_REGISTER_ROLES = [
    'TEACHER',
    'STUDENT',
    'PARENT'
];

/* ==========================================
   INICIAR SERVIDOR
   ========================================== */

app.listen(PORT, async () => {
    console.log(
        `Servidor Nexora corriendo en el puerto ${PORT}`
    );

    console.log('Orígenes CORS permitidos:', allowedOrigins);

    try {
        // Comprobar conexión a Neon PostgreSQL.
        await pool.query('SELECT NOW()');

        console.log(
            'Conexión a Neon PostgreSQL exitosa'
        );

    } catch (err) {
        console.error(
            'Error al conectar con Neon:',
            err
        );
    }
});
