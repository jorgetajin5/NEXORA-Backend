require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();

//Permite las peticiones HTTP del frontend
app.use(cors());
app.use(express.json());

//Conexión a postgreSQL en Neon
const pool = new Pool ({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false} //Para servicios en la nube
});

const PORT = process.env.PORT || 3000;

// Endpoint para sincronizar usuarios de Firebase a PostgreSQL
app.post('/api/users', async(req, res) => {
    const { uid, firstName, lastName, email, rol } = req.body;

    try{
        const result = await pool.query(
            'INSERT INTO users (uid, firstName, lastName, email, rol) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (uid) DO NOTHING RETURNING *',
            [uid, firstName, lastName, email, rol]
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error en la base de datos: ', error);
        res.status(500).json({ error: 'Error al registrar usuario en PostgreSQL'});
    }

});

// Endpoint para obtener los datos de un usuario específico
app.get('/api/users/:uid', async (req, res) => {
    const { uid } = req.params;

    try{
        const result = await pool.query(
            'SELECT * FROM users WHERE uid = $1',
            [uid]
        )

        // devuelve los datos, si encuentra coincidencias
        res.json(result.rows[0]);

    } catch ( error ) {
        console.error('Error al buscar el usuario: ', error);
        res.status(500).json({ error: 'Error al consultar PostgreSQL.'});
    }
});




app.listen(PORT, async () => {
    console.log(`Servidor Nexora corriendo en el puerto ${PORT}`);

    try{
        //Prueba de conexión al arrancar
        await pool.query('SELECT NOW()');
        console.log('Conexión a Neon PostgreSQL exitosa');
    } catch (err) {
        console.error('Error al conectar con Neon: ', err);
    }
})
