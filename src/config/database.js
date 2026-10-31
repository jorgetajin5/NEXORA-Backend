
const { Pool } = require('pg');

// Reutilizar una sola instancia de conexión
// para todas las funcionalidades del backend.
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

pool.on('error', (error) => {
    console.error(
        'Error inesperado en PostgreSQL:',
        error.message
    );
});

module.exports = pool;
