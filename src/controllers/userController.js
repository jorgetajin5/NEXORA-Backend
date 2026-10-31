
const pool = require('../config/database');

// Roles permitidos durante el autorregistro.
// DIRECTOR y ADMIN requieren asignación autorizada.
const SELF_REGISTER_ROLES = [
    'TEACHER',
    'STUDENT',
    'PARENT'
];

// POST /api/users/sync
const syncUser = async (req, res) => {
    const firebaseUser = req.firebaseUser;

    const requestedRole = String(
        req.body?.role || ''
    ).toUpperCase();

    const firstName = String(
        req.body?.firstName ||
        firebaseUser.name ||
        'Usuario'
    ).trim().slice(0, 120) || 'Usuario';

    const lastName = String(
        req.body?.lastName || ''
    ).trim().slice(0, 120);

    let client;

    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // Buscar cuenta existente en PostgreSQL
        let result = await client.query(
            `SELECT id, status
             FROM app_user
             WHERE firebase_uid = $1
             FOR UPDATE`,
            [firebaseUser.uid]
        );

        let userId;

        if (result.rows.length === 0) {

            // Validar rol de nueva cuenta
            if (!SELF_REGISTER_ROLES.includes(requestedRole)) {
                const error = new Error(
                    'Rol de registro no permitido'
                );
                error.status = 400;
                throw error;
            }

            // Crear usuario
            result = await client.query(
                `INSERT INTO app_user
                    (
                        firebase_uid,
                        role_id,
                        email,
                        email_verified,
                        last_login_at
                    )
                 SELECT
                    $1,
                    r.id,
                    $2,
                    $3,
                    NOW()
                 FROM role r
                 WHERE r.code = $4
                 RETURNING id`,
                [
                    firebaseUser.uid,
                    firebaseUser.email || null,
                    firebaseUser.email_verified === true,
                    requestedRole
                ]
            );

            if (!result.rows.length) {
                throw new Error(
                    'El rol solicitado no existe en PostgreSQL.'
                );
            }

            userId = result.rows[0].id;

        } else {

            if (result.rows[0].status !== 'active') {
                const error = new Error(
                    'Cuenta deshabilitada'
                );
                error.status = 403;
                throw error;
            }

            userId = result.rows[0].id;

            // Actualizar datos de Firebase
            // sin modificar el rol existente
            await client.query(
                `UPDATE app_user
                 SET
                    email = $2,
                    email_verified = $3,
                    last_login_at = NOW()
                 WHERE id = $1`,
                [
                    userId,
                    firebaseUser.email || null,
                    firebaseUser.email_verified === true
                ]
            );
        }

        // Crear perfil si todavía no existe
        await client.query(
            `INSERT INTO user_profile
                (user_id, first_name, last_name)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id) DO NOTHING`,
            [userId, firstName, lastName]
        );

        // Obtener perfil con rol
        result = await client.query(
            `SELECT
                u.id,
                u.firebase_uid AS uid,
                u.email,
                u.status,
                p.first_name AS "firstName",
                p.last_name AS "lastName",
                r.code AS "roleCode"
             FROM app_user u
             JOIN user_profile p ON p.user_id = u.id
             JOIN role r ON r.id = u.role_id
             WHERE u.id = $1`,
            [userId]
        );

        await client.query('COMMIT');

        return res.json({
            ok: true,
            user: result.rows[0]
        });

    } catch (error) {

        if (client) {
            await client.query('ROLLBACK').catch(() => {});
        }

        console.error(
            'Error sincronizando usuario:',
            error.message
        );

        return res.status(error.status || 500).json({
            ok: false,
            message: error.status
                ? error.message
                : 'Error al sincronizar el usuario'
        });

    } finally {
        if (client) client.release();
    }
};


// GET /api/users/me
const getMyProfile = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT
                u.id,
                u.firebase_uid AS uid,
                u.email,
                u.status,
                p.first_name AS "firstName",
                p.last_name AS "lastName",
                r.code AS "roleCode",

                CASE r.code
                    WHEN 'TEACHER' THEN 'docente'
                    WHEN 'STUDENT' THEN 'alumno'
                    WHEN 'PARENT' THEN 'padre'
                    WHEN 'DIRECTOR' THEN 'director'
                    ELSE 'administrador'
                END AS rol

             FROM app_user u

             JOIN user_profile p
                ON p.user_id = u.id

             JOIN role r
                ON r.id = u.role_id

             WHERE u.firebase_uid = $1
               AND u.status = 'active'`,
            [req.firebaseUser.uid]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                ok: false,
                message: 'Perfil no registrado en PostgreSQL'
            });
        }

        return res.json({
            ok: true,
            user: result.rows[0]
        });

    } catch (error) {
        console.error(
            'Error consultando perfil:',
            error.message
        );

        return res.status(500).json({
            ok: false,
            message: 'Error al consultar perfil'
        });
    }
};

// Exportar controladores
module.exports = {
    syncUser,
    getMyProfile
};
