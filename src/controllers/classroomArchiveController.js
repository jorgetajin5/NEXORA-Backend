
'use strict';

const pool = require('../config/database');

const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cambiar el estado de una clase.
 *
 * active   → archived
 * archived → active
 *
 * Solo el propietario puede realizar la operación.
 * No elimina los datos relacionados.
 */
async function changeClassroomStatus(
    req,
    res,
    next,
    fromStatus,
    toStatus
) {
    const classroomId = req.params.id;
    const firebaseUid = req.firebaseUser?.uid;

    if (!firebaseUid) {
        return res.status(401).json({
            ok: false,
            message: 'Sesión no válida.'
        });
    }

    if (!UUID_REGEX.test(classroomId || '')) {
        return res.status(400).json({
            ok: false,
            message: 'Identificador de clase inválido.'
        });
    }

    try {
        // La identidad proviene del token Firebase
        // verificado previamente por el middleware.
        //
        // Solo el propietario actual de la clase
        // puede cambiar su estado.

        const { rows } = await pool.query(
            `UPDATE classroom c

             SET status = $3::text

             FROM app_user u

             WHERE c.id = $1::uuid
               AND c.status = $4::text

               AND u.firebase_uid = $2::text
               AND u.status = 'active'

               AND c.created_by = u.id

               AND EXISTS (
                   SELECT 1
                   FROM classroom_user cu
                   WHERE cu.classroom_id = c.id
                     AND cu.user_id = u.id
                     AND cu.member_role = 'OWNER'
                     AND cu.status = 'active'
               )

             RETURNING
                 c.id,
                 c.name,
                 c.status,
                 c.join_enabled AS "joinEnabled"`,
            [
                classroomId,
                firebaseUid,
                toStatus,
                fromStatus
            ]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                ok: false,
                message:
                    'Clase no disponible en ese estado o no eres su propietario.'
            });
        }

        return res.json({
            ok: true,
            message:
                toStatus === 'archived'
                    ? 'Clase archivada correctamente.'
                    : 'Clase restaurada correctamente.',
            classroom: rows[0]
        });

    } catch (error) {
        console.error(
            'Error cambiando estado de clase:',
            error.code || error.message
        );

        return next(error);
    }
}

/**
 * PATCH /api/classrooms/:id/archive
 *
 * Archivar una clase activa.
 */
const archiveClassroom = (req, res, next) =>
    changeClassroomStatus(
        req,
        res,
        next,
        'active',
        'archived'
    );

/**
 * PATCH /api/classrooms/:id/restore
 *
 * Restaurar una clase archivada.
 */
const restoreClassroom = (req, res, next) =>
    changeClassroomStatus(
        req,
        res,
        next,
        'archived',
        'active'
    );

/**
 * GET /api/classrooms/archived/mine
 *
 * Obtener clases archivadas
 * pertenecientes al usuario autenticado.
 */
const getArchivedClassrooms = async (req, res, next) => {
    const firebaseUid = req.firebaseUser?.uid;

    if (!firebaseUid) {
        return res.status(401).json({
            ok: false,
            message: 'Sesión no válida.'
        });
    }

    try {
        const { rows } = await pool.query(
            `SELECT
                c.id,
                c.name AS title,
                c.grade_level AS category,
                c.class_code AS code,
                c.join_mode AS "joinMode",
                c.join_enabled AS "joinEnabled",
                c.status,

                (
                    SELECT COUNT(*)::integer
                    FROM student_classroom sc
                    WHERE sc.classroom_id = c.id
                      AND sc.status = 'active'
                ) AS students

             FROM classroom c

             JOIN app_user u
                ON u.id = c.created_by

             JOIN classroom_user cu
                ON cu.classroom_id = c.id
               AND cu.user_id = u.id
               AND cu.member_role = 'OWNER'
               AND cu.status = 'active'

             WHERE u.firebase_uid = $1
               AND u.status = 'active'
               AND c.status = 'archived'

             ORDER BY
                c.updated_at DESC,
                c.created_at DESC`,
            [firebaseUid]
        );

        return res.json({
            ok: true,
            total: rows.length,
            classes: rows
        });

    } catch (error) {
        console.error(
            'Error listando clases archivadas:',
            error.code || error.message
        );

        return next(error);
    }
};

module.exports = {
    archiveClassroom,
    restoreClassroom,
    getArchivedClassrooms
};
