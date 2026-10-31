
const pool = require('../config/database');

const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Comprueba permisos en PostgreSQL, no en el frontend.
const getAuthorizedStaff = async (firebaseUid, classroomId) => {
    const result = await pool.query(
        `SELECT u.id
         FROM app_user u
         WHERE u.firebase_uid = $1
           AND u.status = 'active'
           AND is_classroom_staff(u.id, $2::uuid)`,
        [firebaseUid, classroomId]
    );

    return result.rows[0]?.id || null;
};

/**
 * GET /api/classrooms/:id/join-requests
 *
 * Listar solicitudes pendientes de la clase.
 */
const getJoinRequests = async (req, res) => {
    try {
        const classroomId = req.params.id;

        if (!UUID_REGEX.test(classroomId)) {
            return res.status(400).json({
                ok: false,
                message: 'Identificador de clase inválido.'
            });
        }

        const actorId = await getAuthorizedStaff(
            req.firebaseUser.uid,
            classroomId
        );

        if (!actorId) {
            return res.status(403).json({
                ok: false,
                message: 'No tienes permiso para consultar estas solicitudes.'
            });
        }

        const result = await pool.query(
            `SELECT
                r.id,
                r.classroom_id AS "classroomId",
                s.id AS "studentId",
                s.first_name AS "firstName",
                s.last_name AS "lastName",
                r.status,
                r.requested_at AS "requestedAt"

             FROM classroom_join_request r

             JOIN student s
                ON s.id = r.student_id

             WHERE r.classroom_id = $1
               AND r.status = 'pending'
               AND s.status = 'active'

             ORDER BY r.requested_at ASC, r.id ASC`,
            [classroomId]
        );

        return res.json({
            ok: true,
            total: result.rows.length,
            requests: result.rows
        });

    } catch (error) {
        console.error(
            'Error consultando solicitudes:',
            error.code || error.message
        );

        return res.status(500).json({
            ok: false,
            message: 'No se pudieron consultar las solicitudes.'
        });
    }
};

/**
 * PATCH /api/classrooms/:id/join-requests/:requestId
 *
 * Resolver una solicitud pendiente.
 *
 * decision: "approved" o "rejected"
 */
const reviewJoinRequest = async (req, res) => {
    try {
        const { id: classroomId, requestId } = req.params;
        const { decision } = req.body || {};

        if (
            !UUID_REGEX.test(classroomId) ||
            !UUID_REGEX.test(requestId)
        ) {
            return res.status(400).json({
                ok: false,
                message: 'Identificadores inválidos.'
            });
        }

        if (!['approved', 'rejected'].includes(decision)) {
            return res.status(400).json({
                ok: false,
                message: 'La decisión debe ser approved o rejected.'
            });
        }

        const actorId = await getAuthorizedStaff(
            req.firebaseUser.uid,
            classroomId
        );

        if (!actorId) {
            return res.status(403).json({
                ok: false,
                message: 'No tienes permiso para resolver esta solicitud.'
            });
        }

        // El UPDATE y los triggers de PostgreSQL
        // se ejecutan dentro de la misma transacción.
        const result = await pool.query(
            `UPDATE classroom_join_request
             SET
                status = $1,
                reviewed_by = $2,
                reviewed_at = NOW()
             WHERE id = $3
               AND classroom_id = $4
               AND status = 'pending'
             RETURNING
                id,
                classroom_id AS "classroomId",
                student_id AS "studentId",
                status,
                reviewed_at AS "reviewedAt"`,
            [
                decision,
                actorId,
                requestId,
                classroomId
            ]
        );

        if (!result.rows.length) {
            return res.status(409).json({
                ok: false,
                message: 'La solicitud no está disponible o ya fue resuelta.'
            });
        }

        // Si la decisión es approved, el trigger
        // approve_classroom_join() crea la matrícula.
        return res.json({
            ok: true,
            message: decision === 'approved'
                ? 'Solicitud aprobada. El estudiante ya está inscrito.'
                : 'Solicitud rechazada correctamente.',
            request: result.rows[0]
        });

    } catch (error) {
        // Excepciones de los triggers PostgreSQL V3
        if (error.code === 'P0001') {
            return res.status(409).json({
                ok: false,
                message: 'No se pudo resolver la solicitud. Verifica el estado del alumno y sus matrículas.'
            });
        }

        console.error(
            'Error resolviendo solicitud:',
            error.code || error.message
        );

        return res.status(500).json({
            ok: false,
            message: 'No se pudo resolver la solicitud.'
        });
    }
};

module.exports = {
    getJoinRequests,
    reviewJoinRequest
};
