
const pool = require('../config/database');

const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PATCH /api/classrooms/:id/students/:studentId/remove
 *
 * Retirar a un estudiante de una clase sin
 * borrar su expediente ni otras matrículas.
 */
const removeClassroomStudent = async (req, res) => {
    try {
        const { id: classroomId, studentId } = req.params;

        if (
            !UUID_REGEX.test(classroomId) ||
            !UUID_REGEX.test(studentId)
        ) {
            return res.status(400).json({
                ok: false,
                message: 'Identificador de clase o estudiante inválido.'
            });
        }

        // Autorización, actualización e identificación
        // del responsable en una sola operación SQL.
        const result = await pool.query(
            `UPDATE student_classroom sc
             SET
                 SET 
                    status = 'left',
                    updated_by = u.id
             FROM app_user u
             WHERE sc.classroom_id = $1::uuid
               AND sc.student_id = $2::uuid
               AND sc.status = 'active'
               AND u.firebase_uid = $3
               AND u.status = 'active'
               AND is_classroom_staff(
                   u.id,
                   sc.classroom_id
               )
             RETURNING
                 sc.id,
                 sc.student_id AS "studentId",
                 sc.classroom_id AS "classroomId",
                 sc.status,
                 sc.ended_at AS "endedAt"`,
            [
                classroomId,
                studentId,
                req.firebaseUser.uid
            ]
        );

        if (!result.rows.length) {
            return res.status(404).json({
                ok: false,
                message:
                    'Matrícula activa no encontrada o sin permiso para retirarla.'
            });
        }

        return res.json({
            ok: true,
            message: 'Estudiante retirado de la clase correctamente.',
            enrollment: result.rows[0]
        });

    } catch (error) {
        console.error(
            'Error retirando estudiante:',
            error.code || error.message
        );

        return res.status(500).json({
            ok: false,
            message: 'No se pudo retirar al estudiante de la clase.'
        });
    }
};

module.exports = {
    removeClassroomStudent
};
