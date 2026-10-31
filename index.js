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

const studentRemovalRoutes =
    require('./src/routes/studentRemoval.routes');
    
const userRoutes = require('./src/routes/users.routes');
const postRoutes = require('./src/routes/posts.routes');

const app = express();

//Permite las peticiones HTTP del frontend
app.use(cors());
app.use(express.json());
app.use('/api/users', userRoutes);
app.use('/api/classrooms', classroomRoutes);
app.use('/api/classrooms', studentRoutes);
app.use('/api/classrooms', postRoutes);
app.use('/api/classrooms', studentRemovalRoutes);

const PORT = process.env.PORT || 3000;

// ENDPOINT para comprobación
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


// prueba de middleware

app.get('/api/auth/check', verifyFirebaseToken, (req, res) => {
    res.json({
        ok: true,
        message: 'Usuario autenticado correctamente',
        user: {
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email || null,
            emailVerified: req.firebaseUser.email_verified || false
        }
    });
});

// Sincronización con PostgresQL

const SELF_REGISTER_ROLES = ['TEACHER', 'STUDENT', 'PARENT'];

// Buscar estudiantes existentes



app.listen(PORT, async () => {
    console.log(`Servidor Nexora corriendo en el puerto ${PORT}`);

    try {
        //Prueba de conexión al arrancar
        await pool.query('SELECT NOW()');
        console.log('Conexión a Neon PostgreSQL exitosa');
    } catch (err) {
        console.error('Error al conectar con Neon: ', err);
    }
})
