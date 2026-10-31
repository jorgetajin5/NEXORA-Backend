
const pool = require('../config/database');

/**
 * GET /api/classrooms/mine
 *
 * Obtiene las clases activas del docente
 * o director autenticado.
 */
const getMyClassrooms = async (req, res) => {
    try {
        // Identificar al usuario desde Firebase
        const userResult = await pool.query(
            `SELECT u.id, r.code AS role
             FROM app_user u
             JOIN role r ON r.id = u.role_id
             WHERE u.firebase_uid = $1
               AND u.status = 'active'`,
            [req.firebaseUser.uid]
        );

        if (userResult.rows.length === 0) {
            return res.status(403).json({
                ok: false,
                message: 'Usuario no registrado o inactivo'
            });
        }

        const user = userResult.rows[0];

        // Solo docentes y directores
        if (!['TEACHER', 'DIRECTOR'].includes(user.role)) {
            return res.status(403).json({
                ok: false,
                message: 'Este listado es para docentes y directores'
            });
        }

        // Obtener clases donde participa como personal activo
        const result = await pool.query(
            `SELECT
                c.id,
                c.name AS title,
                COALESCE(c.grade_level, 'Clase') AS category,
                c.class_code AS code,
                c.join_mode AS "joinMode",
                c.school_id AS "schoolId",
                c.status,

                (
                    SELECT COUNT(*)::INTEGER
                    FROM student_classroom sc
                    WHERE sc.classroom_id = c.id
                      AND sc.status = 'active'
                ) AS students

             FROM classroom c

             JOIN classroom_user cu
                ON cu.classroom_id = c.id

             WHERE cu.user_id = $1
               AND cu.status = 'active'
               AND c.status = 'active'

             ORDER BY c.created_at DESC, c.id DESC`,
            [user.id]
        );

        return res.json({
            ok: true,
            classes: result.rows
        });

    } catch (error) {
        console.error(
            'Error consultando clases:',
            error.message
        );

        return res.status(500).json({
            ok: false,
            message: 'No se pudieron consultar las clases'
        });
    }
};


/*
 * POST /api/classrooms
 *
 * Crear una clase como docente o director.
 * Una clase puede existir sin colegio asociado.
 */

const createClassroom = async (req, res) => {
    try {
        const {
            name,
            description,
            schoolId,
            joinMode,
            gradeLevel,
            section,
            academicYear
        } = req.body;

        // Validar nombre
        if (
            typeof name !== 'string' ||
            !name.trim() ||
            name.trim().length > 120
        ) {
            return res.status(400).json({
                ok: false,
                message: 'El nombre de la clase es obligatorio (máximo 120 caracteres).'
            });
        }

        // Validar modo de ingreso
        const mode = joinMode || 'approval';

        if (!['automatic', 'approval'].includes(mode)) {
            return res.status(400).json({
                ok: false,
                message: 'Modo de ingreso no válido.'
            });
        }

        // Obtener usuario autenticado en PostgreSQL
        const userResult = await pool.query(
            `SELECT
                u.id,
                r.code AS role
             FROM app_user u
             JOIN role r ON r.id = u.role_id
             WHERE u.firebase_uid = $1
               AND u.status = 'active'`,
            [req.firebaseUser.uid]
        );

        if (userResult.rows.length === 0) {
            return res.status(403).json({
                ok: false,
                message: 'Usuario no registrado o inactivo.'
            });
        }

        const user = userResult.rows[0];

        // 4. Verificar permisos
        if (!['TEACHER', 'DIRECTOR'].includes(user.role)) {
            return res.status(403).json({
                ok: false,
                message: 'No tienes permisos para crear clases.'
            });
        }

        // Registrar clase en PostgreSQL
        const result = await pool.query(
            `INSERT INTO classroom (
                name,
                description,
                school_id,
                created_by,
                join_mode,
                grade_level,
                section,
                academic_year
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING
                id,
                name,
                description,
                school_id AS "schoolId",
                class_code AS "classCode",
                join_mode AS "joinMode",
                grade_level AS "gradeLevel",
                section,
                academic_year AS "academicYear",
                status,
                created_at AS "createdAt"`,
            [
                name.trim(),
                typeof description === 'string'
                    ? description.trim()
                    : null,
                schoolId || null,
                user.id,
                mode,
                gradeLevel || null,
                section || null,
                academicYear || null
            ]
        );

        // El trigger de PostgreSQL registra al creador como propietario de la clase.
        

        return res.status(201).json({
            ok: true,
            message: 'Clase creada correctamente.',
            classroom: result.rows[0]
        });

    } catch (error) {
        console.error('Error creando clase:', error.code, error.message);

        if (error.code === '23503' || error.code === '22P02') {
            return res.status(400).json({
                ok: false,
                message: 'El colegio indicado no es válido.'
            });
        }

        if (error.code === 'P0001') {
            return res.status(403).json({
                ok: false,
                message: 'No tienes permiso para asociar esta clase al colegio.'
            });
        }

        return res.status(500).json({
            ok: false,
            message: 'No se pudo crear la clase.'
        });
    }
};



/*
 * GET /api/classrooms/:id
 * Consultar los detalles de una clase.
 */
const getClassroomById = async (req, res) => {
    try {
        const { id } = req.params;

        const uuidRegex =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

        if (!uuidRegex.test(id)) {
            return res.status(400).json({
                ok: false,
                message: 'Identificador de clase inválido.'
            });
        }

        const result = await pool.query(
            `SELECT
                c.id,
                c.name,
                c.description,
                c.grade_level AS "gradeLevel",
                c.section,
                c.academic_year AS "academicYear",
                c.class_code AS "classCode",
                c.join_mode AS "joinMode",
                c.join_enabled AS "joinEnabled",
                c.school_id AS "schoolId",
                s.name AS "schoolName",
                c.created_by AS "createdBy",
                c.status,
                c.created_at AS "createdAt",

                cu.member_role AS "memberRole",

                (
                    SELECT COUNT(*)::INTEGER
                    FROM student_classroom sc
                    WHERE sc.classroom_id = c.id
                      AND sc.status = 'active'
                ) AS students

             FROM classroom c

             JOIN classroom_user cu
                ON cu.classroom_id = c.id
               AND cu.status = 'active'

             JOIN app_user u
                ON u.id = cu.user_id
               AND u.status = 'active'

             LEFT JOIN school s
                ON s.id = c.school_id

             WHERE c.id = $1
               AND u.firebase_uid = $2
               AND c.status = 'active'`,
            [id, req.firebaseUser.uid]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                ok: false,
                message: 'Clase no encontrada o sin acceso autorizado.'
            });
        }

        return res.json({
            ok: true,
            classroom: result.rows[0]
        });

    } catch (error) {
        console.error('Error consultando clase:', error.code);

        return res.status(500).json({
            ok: false,
            message: 'No se pudo consultar la clase.'
        });
    }
};


/**
 * PATCH /api/classrooms/:id/join-settings
 * Cambiar el modo de ingreso de estudiantes.
 */
const updateJoinSettings = async (req, res) => {
    try {
        const { id } = req.params;
        const { joinMode, joinEnabled } = req.body || {};

        const uuidRegex =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

        if (!uuidRegex.test(id)) {
            return res.status(400).json({
                ok: false,
                message: 'Identificador de clase inválido.'
            });
        }

        // Validar el modo de ingreso
        if (!['automatic', 'approval'].includes(joinMode)) {
            return res.status(400).json({
                ok: false,
                message: 'Modo de ingreso inválido.'
            });
        }

        // Validar el estado de inscripciones
        if (typeof joinEnabled !== 'boolean') {
            return res.status(400).json({
                ok: false,
                message: 'El estado de inscripción debe ser booleano.'
            });
        }

        // Identificar al usuario autenticado
        const userResult = await pool.query(
            `SELECT id
             FROM app_user
             WHERE firebase_uid = $1
               AND status = 'active'`,
            [req.firebaseUser.uid]
        );

        if (!userResult.rows.length) {
            return res.status(403).json({
                ok: false,
                message: 'Usuario no autorizado.'
            });
        }

        const userId = userResult.rows[0].id;

        // Función de PostgreSQL V3.
        // Comprueba los permisos antes de actualizar.
        await pool.query(
            `SELECT configure_classroom_join(
                $1::uuid,
                $2::uuid,
                $3::text,
                $4::boolean
            )`,
            [userId, id, joinMode, joinEnabled]
        );

        // Obtener los valores actualizados
        const result = await pool.query(
            `SELECT
                id,
                join_mode AS "joinMode",
                join_enabled AS "joinEnabled"
             FROM classroom
             WHERE id = $1`,
            [id]
        );

        return res.json({
            ok: true,
            message: 'Configuración actualizada correctamente.',
            settings: result.rows[0]
        });

    } catch (error) {
        console.error(
            'Error configurando clase:',
            error.code,
            error.message
        );

        if (error.code === 'P0001') {
            return res.status(403).json({
                ok: false,
                message: 'No tienes permiso para configurar esta clase.'
            });
        }

        if (error.code === '23514') {
            return res.status(400).json({
                ok: false,
                message: 'Configuración inválida.'
            });
        }

        return res.status(500).json({
            ok: false,
            message: 'No se pudo actualizar la configuración.'
        });
    }
};



/**
 * POST /api/classrooms/join
 *
 * Permite a un estudiante con cuenta Firebase
 * ingresar a una clase mediante su código.
 */
const joinClassroomByCode = async (req, res) => {
    try {
        const { classCode } = req.body || {};

        // Valida el código recibido
        if (
            typeof classCode !== 'string' ||
            !classCode.trim() ||
            classCode.trim().length > 64
        ) {
            return res.status(400).json({
                ok: false,
                message: 'Ingresa un código de clase válido.'
            });
        }

        const code = classCode.trim().toUpperCase();

        // Identifica al usuario autenticado desde su token Firebase
        const userResult = await pool.query(
            `SELECT
                u.id,
                r.code AS role
             FROM app_user u
             JOIN role r
                 ON r.id = u.role_id
             WHERE u.firebase_uid = $1
               AND u.status = 'active'`,
            [req.firebaseUser.uid]
        );

        if (!userResult.rows.length) {
            return res.status(403).json({
                ok: false,
                message: 'Usuario no registrado o inactivo.'
            });
        }

        const user = userResult.rows[0];

        // Solo estudiantes pueden utilizar el ingreso mediante código
        if (user.role !== 'STUDENT') {
            return res.status(403).json({
                ok: false,
                message: 'Esta función es exclusiva para estudiantes.'
            });
        }

        // Utilizar la función PostgreSQL
        // La base de datos comprueba:
        // - Existencia del código
        // - Clase activa
        // - Inscripciones habilitadas
        // - Modo automatic o approval
        // - Matrículas existentes o restringidas
        const result = await pool.query(
            `SELECT
                result_status AS status,
                result_id AS id
             FROM join_classroom_by_code(
                 $1::uuid,
                 $2::text
             )`,
            [
                user.id,
                code
            ]
        );

        const joinResult = result.rows[0];

        if (!joinResult) {
            return res.status(500).json({
                ok: false,
                message: 'No se pudo procesar el ingreso.'
            });
        }

        // 5. Inscripción automática o ya activa
        if (joinResult.status === 'active') {
            return res.json({
                ok: true,
                status: 'active',
                enrollmentId: joinResult.id,
                message: 'Ya formas parte de esta clase.'
            });
        }

        // 6. Solicitud pendiente de aprobación
        if (joinResult.status === 'pending') {
            return res.json({
                ok: true,
                status: 'pending',
                requestId: joinResult.id,
                message: 'Solicitud enviada. Espera la aprobación del docente.'
            });
        }

        return res.status(500).json({
            ok: false,
            message: 'Estado de ingreso no reconocido.'
        });

    } catch (error) {
        // PostgreSQL utiliza P0001 para las excepciones
        // generadas por sus funciones y triggers.
        if (error.code === 'P0001') {
            return res.status(400).json({
                ok: false,
                message: 'No fue posible ingresar. Verifica el código, el estado de la clase y tus permisos.'
            });
        }

        console.error(
            'Error ingresando a clase:',
            error.code || error.message
        );

        return res.status(500).json({
            ok: false,
            message: 'No se pudo procesar el ingreso a la clase.'
        });
    }
};


/**
 * GET /api/classrooms/student/mine
 *
 * Clases inscritas y solicitudes pendientes
 * del estudiante autenticado.
 */
const getStudentClassrooms = async (req, res) => {
    try {
        // Comprueba la cuenta y su rol
        const userResult = await pool.query(
            `SELECT u.id
             FROM app_user u
             JOIN role r ON r.id = u.role_id
             WHERE u.firebase_uid = $1
               AND u.status = 'active'
               AND r.code = 'STUDENT'`,
            [req.firebaseUser.uid]
        );

        if (!userResult.rows.length) {
            return res.status(403).json({
                ok: false,
                message: 'Esta sección es exclusiva para alumnos.'
            });
        }

        const userId = userResult.rows[0].id;

        // Obtiene las clases con matrícula activa
        const classesResult = await pool.query(
            `SELECT
                c.id,
                c.name AS title,
                c.grade_level AS "gradeLevel",
                c.section,
                c.academic_year AS "academicYear",
                sch.name AS "schoolName",
                sc.joined_at AS "joinedAt"

             FROM student s

             JOIN student_classroom sc
                 ON sc.student_id = s.id
                AND sc.status = 'active'

             JOIN classroom c
                 ON c.id = sc.classroom_id
                AND c.status = 'active'

             LEFT JOIN school sch
                 ON sch.id = c.school_id

             WHERE s.user_id = $1
               AND s.status = 'active'

             ORDER BY
                c.name ASC,
                c.id ASC`,
            [userId]
        );

        // Obtiene solicitudes aún pendientes
        const requestsResult = await pool.query(
            `SELECT
                r.id,
                c.id AS "classroomId",
                c.name AS title,
                r.status,
                r.requested_at AS "requestedAt"

             FROM student s

             JOIN classroom_join_request r
                 ON r.student_id = s.id
                AND r.status = 'pending'

             JOIN classroom c
                 ON c.id = r.classroom_id
                AND c.status = 'active'

             WHERE s.user_id = $1
               AND s.status = 'active'

             ORDER BY r.requested_at DESC`,
            [userId]
        );

        return res.json({
            ok: true,
            classes: classesResult.rows,
            requests: requestsResult.rows
        });

    } catch (error) {
        console.error(
            'Error consultando clases del alumno:',
            error.code || error.message
        );

        return res.status(500).json({
            ok: false,
            message: 'No se pudieron consultar tus clases.'
        });
    }
};


module.exports = {
    getMyClassrooms,
    createClassroom,
    getClassroomById,
    updateJoinSettings,
    joinClassroomByCode,
    getStudentClassrooms
};