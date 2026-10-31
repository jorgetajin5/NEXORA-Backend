
const pool = require('../config/database');

/**
 * GET /api/classrooms/:id/students
 *
 * Obtener estudiantes con matrícula activa
 * en una clase determinada.
 */
const getClassroomStudents = async (req, res) => {
    try {
        const classroomId = req.params.id;

        const uuidRegex =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

        // Valida identificador de la clase
        if (!uuidRegex.test(classroomId)) {
            return res.status(400).json({
                ok: false,
                message: 'Identificador de clase inválido.'
            });
        }

        // Verifica permisos del usuario autenticado
        const actorResult = await pool.query(
            `SELECT u.id
             FROM app_user u
             WHERE u.firebase_uid = $1
               AND u.status = 'active'
               AND is_classroom_staff(u.id, $2::uuid)`,
            [req.firebaseUser.uid, classroomId]
        );

        if (!actorResult.rows.length) {
            return res.status(403).json({
                ok: false,
                message: 'No tienes acceso a los estudiantes de esta clase.'
            });
        }

        // onsulta matrículas activas
        const result = await pool.query(
            `SELECT
                s.id,
                s.first_name AS "firstName",
                s.last_name AS "lastName",
                (s.user_id IS NOT NULL) AS "hasAccount",
                sc.status,
                sc.joined_at AS "joinedAt"

             FROM student_classroom sc

             JOIN student s
                ON s.id = sc.student_id

             WHERE sc.classroom_id = $1
               AND sc.status = 'active'
               AND s.status = 'active'

             ORDER BY
                s.last_name ASC,
                s.first_name ASC,
                s.id ASC`,
            [classroomId]
        );

        // Respuesta para React
        return res.json({
            ok: true,
            total: result.rows.length,
            students: result.rows
        });

    } catch (error) {
        console.error(
            'Error consultando estudiantes:',
            error.code
        );

        return res.status(500).json({
            ok: false,
            message: 'No se pudieron consultar los estudiantes.'
        });
    }
};


/**
 * POST /api/classrooms/:id/students
 *
 * Registrar un estudiante sin cuenta Firebase
 * e inscribirlo en la clase.
 */
const createStudent = async (req, res) => {
    try {
        const classroomId = req.params.id;

        const uuidRegex =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

        // Valida el identificador de clase
        if (!uuidRegex.test(classroomId)) {
            return res.status(400).json({
                ok: false,
                message: 'Identificador de clase inválido.'
            });
        }

        // Obtiene los datos del formulario
        const {
            firstName,
            lastName,
            personalCode
        } = req.body || {};

        // Valida los datos recibidos
        if (
            typeof firstName !== 'string' ||
            !firstName.trim() ||
            firstName.trim().length > 120 ||
            (lastName != null && typeof lastName !== 'string') ||
            (personalCode != null && typeof personalCode !== 'string')
        ) {
            return res.status(400).json({
                ok: false,
                message: 'Datos del estudiante inválidos.'
            });
        }

        const first = firstName.trim();
        const last = (lastName || '').trim();
        const code = (personalCode || '').trim() || null;

        if (
            last.length > 120 ||
            (code && code.length > 64)
        ) {
            return res.status(400).json({
                ok: false,
                message: 'Uno de los campos supera la longitud permitida.'
            });
        }

        // Identificar al usuario autenticado
        const actorResult = await pool.query(
            `SELECT u.id
             FROM app_user u
             WHERE u.firebase_uid = $1
               AND u.status = 'active'
               AND is_classroom_staff(u.id, $2::uuid)`,
            [
                req.firebaseUser.uid,
                classroomId
            ]
        );

        if (!actorResult.rows.length) {
            return res.status(403).json({
                ok: false,
                message: 'No tienes permiso para registrar alumnos en esta clase.'
            });
        }

        const actorId = actorResult.rows[0].id;

        // Ejecuta la función PostgreSQL
        const result = await pool.query(
            `SELECT create_student_no_account(
                $1::uuid,
                $2::text,
                $3::text,
                $4::text,
                $5::uuid
            ) AS "studentId"`,
            [
                actorId,
                first,
                last,
                code,
                classroomId
            ]
        );

        // Responde al frontend
        return res.status(201).json({
            ok: true,
            message: 'Estudiante registrado correctamente.',
            studentId: result.rows[0].studentId
        });

    } catch (error) {

        if (error.code === '23505') {
            return res.status(409).json({
                ok: false,
                message: 'No se pudo crear un expediente nuevo. Revisa si el estudiante ya está registrado.'
            });
        }

        if (error.code === 'P0001') {
            return res.status(403).json({
                ok: false,
                message: 'Operación no autorizada.'
            });
        }

        console.error(
            'Error registrando estudiante:',
            error.code || error.message
        );

        return res.status(500).json({
            ok: false,
            message: 'No se pudo registrar el estudiante.'
        });
    }
};


/**
 * POST /api/classrooms/:id/students/search
 *
 * Buscar estudiantes existentes que el docente
 * está autorizado a gestionar.
 */
const searchStudents = async (req, res) => {
    try {
        const classroomId = req.params.id;
        const { firstName, lastName } = req.body || {};

        const uuidRegex =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

        // 1. Validar identificador de clase
        if (!uuidRegex.test(classroomId)) {
            return res.status(400).json({
                ok: false,
                message: 'Clase inválida.'
            });
        }

        // Valida datos de búsqueda
        if (
            typeof firstName !== 'string' ||
            typeof lastName !== 'string' ||
            !firstName.trim() ||
            firstName.length > 120 ||
            lastName.length > 120
        ) {
            return res.status(400).json({
                ok: false,
                message: 'Ingresa nombres y apellidos válidos.'
            });
        }

        // Identifica al usuario autenticado
        const actorResult = await pool.query(
            `SELECT u.id
             FROM app_user u
             WHERE u.firebase_uid = $1
               AND u.status = 'active'
               AND is_classroom_staff(u.id, $2::uuid)`,
            [
                req.firebaseUser.uid,
                classroomId
            ]
        );

        if (!actorResult.rows.length) {
            return res.status(403).json({
                ok: false,
                message: 'No tienes acceso a esta clase.'
            });
        }

        const actorId = actorResult.rows[0].id;

        // Busca expedientes existentes
        const result = await pool.query(
            `SELECT
                s.student_id AS id,
                s.first_name AS "firstName",
                s.last_name AS "lastName",
                s.has_personal_code AS "hasPersonalCode",

                EXISTS (
                    SELECT 1
                    FROM student_classroom sc
                    WHERE sc.student_id = s.student_id
                      AND sc.classroom_id = $4
                      AND sc.status = 'active'
                ) AS "alreadyEnrolled"

             FROM search_accessible_students(
                $1::uuid,
                $2::text,
                $3::text
             ) s`,
            [
                actorId,
                firstName.trim(),
                lastName.trim(),
                classroomId
            ]
        );

        // Devuelve resultados al frontend
        return res.json({
            ok: true,
            students: result.rows
        });

    } catch (error) {
        console.error(
            'Error buscando estudiantes:',
            error.code || error.message
        );

        return res.status(500).json({
            ok: false,
            message: 'No se pudo realizar la búsqueda.'
        });
    }
};



/**
 * POST /api/classrooms/:id/students/enroll-existing
 *
 * Inscribir en una clase a un estudiante
 * que ya tiene expediente académico.
 */
const enrollExistingStudent = async (req, res) => {
    try {
        const classroomId = req.params.id;
        const { studentId } = req.body || {};

        const uuidRegex =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

        // Valida los identificadores
        if (
            !uuidRegex.test(classroomId) ||
            typeof studentId !== 'string' ||
            !uuidRegex.test(studentId)
        ) {
            return res.status(400).json({
                ok: false,
                message: 'Identificadores inválidos.'
            });
        }

        // Identificar al usuario autenticado
        // y verificar que administra esta clase
        const actorResult = await pool.query(
            `SELECT u.id
             FROM app_user u
             WHERE u.firebase_uid = $1
               AND u.status = 'active'
               AND is_classroom_staff(u.id, $2::uuid)`,
            [
                req.firebaseUser.uid,
                classroomId
            ]
        );

        if (!actorResult.rows.length) {
            return res.status(403).json({
                ok: false,
                message: 'No tienes permiso para esta operación.'
            });
        }

        const actorId = actorResult.rows[0].id;

        // Ejecuta función PostgreSQL para inscribir un expediente existente.
        // PostgreSQL comprueba que el docente tiene autorización sobre el estudiante
        const result = await pool.query(
            `SELECT enroll_existing_student(
                $1::uuid,
                $2::uuid,
                $3::uuid
            ) AS "enrollmentId"`,
            [
                actorId,
                studentId,
                classroomId
            ]
        );

        // Responde al frontend
        return res.json({
            ok: true,
            message: 'Estudiante inscrito correctamente.',
            enrollmentId: result.rows[0].enrollmentId
        });

    } catch (error) {

        // Excepción de autorización de PostgreSQL
        if (error.code === 'P0001') {
            return res.status(403).json({
                ok: false,
                message: 'No se pudo autorizar la inscripción.'
            });
        }

        console.error(
            'Error inscribiendo estudiante:',
            error.code || error.message
        );

        return res.status(500).json({
            ok: false,
            message: 'No se pudo completar la inscripción.'
        });
    }
};


module.exports = {
    getClassroomStudents,
    createStudent,
    searchStudents,
    enrollExistingStudent
};