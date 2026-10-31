
const pool = require('../config/database');


const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


/**
 * Consultar los permisos del usuario autenticado
 * sobre una clase.
 */
const getClassroomPermissions = async (
    firebaseUid,
    classroomId
) => {
    const result = await pool.query(
        `SELECT
            u.id,

            is_classroom_staff(
                u.id,
                $2::uuid
            ) AS "canPublish",

            (
                is_classroom_staff(u.id, $2::uuid)
                OR (
                    r.code = 'STUDENT'
                    AND EXISTS (
                        SELECT 1
                        FROM student s

                        JOIN student_classroom sc
                            ON sc.student_id = s.id
                           AND sc.status = 'active'

                        JOIN classroom c
                            ON c.id = sc.classroom_id
                           AND c.status = 'active'

                        WHERE s.user_id = u.id
                          AND s.status = 'active'
                          AND sc.classroom_id = $2::uuid
                    )
                )
            ) AS "canRead"

         FROM app_user u
         JOIN role r ON r.id = u.role_id

         WHERE u.firebase_uid = $1
           AND u.status = 'active'`,
        [firebaseUid, classroomId]
    );

    return result.rows[0] || null;
};


/**
 * POST /api/classrooms/:id/posts
 *
 * Crear una publicación en una clase.
 */
const createClassroomPost = async (req, res) => {
    try {
        const classroomId = req.params.id;
        const { content, audience = 'all' } = req.body || {};

        if (!UUID_REGEX.test(classroomId)) {
            return res.status(400).json({
                ok: false,
                message: 'Identificador de clase inválido.'
            });
        }

        // Validar contenido
        if (
            typeof content !== 'string' ||
            !content.trim() ||
            content.trim().length > 5000
        ) {
            return res.status(400).json({
                ok: false,
                message: 'La publicación debe contener entre 1 y 5000 caracteres.'
            });
        }

        // Por ahora publicaremos para todos
        // los participantes o solo estudiantes.
        if (!['all', 'students'].includes(audience)) {
            return res.status(400).json({
                ok: false,
                message: 'Audiencia no válida.'
            });
        }



        // Identificar usuario y verificar permisos
        const actor = await getClassroomPermissions(
            req.firebaseUser.uid,
            classroomId
        );

        if (!actor || !actor.canPublish) {
            return res.status(403).json({
                ok: false,
                message: 'No tienes permiso para publicar en esta clase.'
            });
        }

        // Crear publicación en PostgreSQL.
        // El trigger validate_post_author()
        // vuelve a comprobar la autorización.
        const result = await pool.query(
            `WITH new_post AS (
                INSERT INTO post (
                    author_id,
                    classroom_id,
                    content,
                    audience,
                    status
                )
                VALUES (
                    $1::uuid,
                    $2::uuid,
                    $3::text,
                    $4::text,
                    'published'
                )
                RETURNING *
            )
            SELECT
                p.id,
                p.classroom_id AS "classroomId",
                p.content,
                p.audience,
                p.status,
                p.author_id AS "authorId",
                CONCAT_WS(
                    ' ',
                    up.first_name,
                    NULLIF(up.last_name, '')
                ) AS "authorName",
                p.created_at AS "createdAt",
                TRUE AS "canDelete"

            FROM new_post p

            LEFT JOIN user_profile up
                ON up.user_id = p.author_id`,
            [
                actor.id,
                classroomId,
                content.trim(),
                audience
            ]
        );

        return res.status(201).json({
            ok: true,
            message: 'Publicación creada correctamente.',
            post: result.rows[0]
        });

    } catch (error) {
        if (error.code === 'P0001') {
            return res.status(403).json({
                ok: false,
                message: 'No tienes autorización para publicar en esta clase.'
            });
        }

        if (error.code === '23514') {
            return res.status(400).json({
                ok: false,
                message: 'Los datos de la publicación no son válidos.'
            });
        }

        console.error(
            'Error creando publicación:',
            error.code || error.message
        );

        return res.status(500).json({
            ok: false,
            message: 'No se pudo crear la publicación.'
        });
    }
};


/**
 * GET /api/classrooms/:id/posts
 *
 * Consultar publicaciones visibles en una clase.
 */
const getClassroomPosts = async (req, res) => {
    try {
        const classroomId = req.params.id;

        if (!UUID_REGEX.test(classroomId)) {
            return res.status(400).json({
                ok: false,
                message: 'Identificador de clase inválido.'
            });
        }

        // Comprobar acceso del usuario a la clase
        const actor = await getClassroomPermissions(
            req.firebaseUser.uid,
            classroomId
        );

        if (!actor || !actor.canRead) {
            return res.status(403).json({
                ok: false,
                message: 'No tienes acceso a las publicaciones de esta clase.'
            });
        }

        // Límite de publicaciones por petición
        const rawLimit = req.query.limit;

        const limit = rawLimit === undefined
            ? 20
            : Number(rawLimit);

        if (
            !Number.isInteger(limit) ||
            limit < 1 ||
            limit > 50
        ) {
            return res.status(400).json({
                ok: false,
                message: 'El límite debe estar entre 1 y 50.'
            });
        }

        // La función de PostgreSQL comprueba
        // la audiencia de cada publicación.


        const result = await pool.query(
            `SELECT
        p.id,
        p.classroom_id AS "classroomId",
        p.content,
        p.audience,
        p.status,
        p.author_id AS "authorId",

        CONCAT_WS(
            ' ',
            up.first_name,
            NULLIF(up.last_name, '')
        ) AS "authorName",

        p.created_at AS "createdAt",

        (
            SELECT COUNT(*)::integer
            FROM post_reaction pr
            WHERE pr.post_id = p.id
              AND pr.reaction_type = 'like'
        ) AS "likesCount",

        EXISTS (
            SELECT 1
            FROM post_reaction pr
            WHERE pr.post_id = p.id
              AND pr.user_id = $1::uuid
              AND pr.reaction_type = 'like'
        ) AS "likedByMe",

        (
            p.author_id = $1::uuid
            AND $4::boolean
        ) AS "canDelete"

    FROM get_classroom_feed(
        $1::uuid,
        $2::uuid,
        $3::integer
    ) p

    LEFT JOIN user_profile up
        ON up.user_id = p.author_id

    ORDER BY
        p.created_at DESC,
        p.id DESC`,
            [
                actor.id,
                classroomId,
                limit,
                actor.canPublish === true
            ]
        );



        return res.json({
            ok: true,
            total: result.rows.length,
            posts: result.rows
        });

    } catch (error) {
        console.error('Error consultando publicaciones:', {
            code: error.code,
            message: error.message,
            position: error.position,
            detail: error.detail
        });

        return res.status(500).json({
            ok: false,
            message: 'No se pudieron consultar las publicaciones.'
        });
    }
};




/**
 * Agregar o quitar una reacción "Me gusta".
 *
 * POST   -> Agregar reacción
 * DELETE -> Quitar reacción
 */
const updatePostLike = async (req, res, shouldLike) => {
    try {
        const { id: classroomId, postId } = req.params;

        const UUID_REGEX =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

        // Valida identificadores
        if (
            !UUID_REGEX.test(classroomId) ||
            !UUID_REGEX.test(postId)
        ) {
            return res.status(400).json({
                ok: false,
                message: 'Identificador inválido.'
            });
        }

        // Obtiene usuario autenticado
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

        const actorId = userResult.rows[0].id;

        // Confirma que la publicación pertenece a la clase y que el usuario puede verla.
        const accessResult = await pool.query(
            `SELECT p.id
             FROM post p
             WHERE p.id = $1::uuid
               AND p.classroom_id = $2::uuid
               AND can_access_post($3::uuid, p.id)`,
            [postId, classroomId, actorId]
        );

        if (!accessResult.rows.length) {
            return res.status(404).json({
                ok: false,
                message: 'Publicación no disponible.'
            });
        }

        // Registra o retirar la reacción
        if (shouldLike) {
            await pool.query(
                `INSERT INTO post_reaction (
                    post_id,
                    user_id,
                    reaction_type
                )
                VALUES ($1::uuid, $2::uuid, 'like')
                ON CONFLICT (post_id, user_id)
                DO UPDATE
                SET reaction_type = 'like'`,
                [postId, actorId]
            );
        } else {
            await pool.query(
                `DELETE FROM post_reaction
                 WHERE post_id = $1::uuid
                   AND user_id = $2::uuid
                   AND reaction_type = 'like'`,
                [postId, actorId]
            );
        }

        // Consultar estado real desde PostgreSQL
        const summary = await pool.query(
            `SELECT
                (
                    SELECT COUNT(*)::integer
                    FROM post_reaction
                    WHERE post_id = $1::uuid
                      AND reaction_type = 'like'
                ) AS "likesCount",

                EXISTS (
                    SELECT 1
                    FROM post_reaction
                    WHERE post_id = $1::uuid
                      AND user_id = $2::uuid
                      AND reaction_type = 'like'
                ) AS "likedByMe"`,
            [postId, actorId]
        );

        return res.json({
            ok: true,
            postId,
            ...summary.rows[0]
        });

    } catch (error) {
        if (error.code === 'P0001') {
            return res.status(403).json({
                ok: false,
                message: 'No tienes permiso para reaccionar a esta publicación.'
            });
        }

        console.error(
            'Error actualizando reacción:',
            error.code || error.message
        );

        return res.status(500).json({
            ok: false,
            message: 'No se pudo actualizar la reacción.'
        });
    }
};

// POST: dar "Me gusta"
const likeClassroomPost = (req, res) => {
    return updatePostLike(req, res, true);
};

// DELETE: quitar "Me gusta"
const unlikeClassroomPost = (req, res) => {
    return updatePostLike(req, res, false);
};


/**
 * DELETE /api/classrooms/:id/posts/:postId
 *
 * Eliminación lógica de una publicación.
 * Solo su autor, si continúa siendo personal
 * autorizado de la clase, puede eliminarla.
 */
const deleteClassroomPost = async (req, res) => {
    try {
        const { id: classroomId, postId } = req.params;

        const UUID_REGEX =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

        if (
            !UUID_REGEX.test(classroomId) ||
            !UUID_REGEX.test(postId)
        ) {
            return res.status(400).json({
                ok: false,
                message: 'Identificador inválido.'
            });
        }

        // La identidad proviene del token Firebase.
        // No aceptamos authorId enviado por React.
        const result = await pool.query(
            `UPDATE post p
             SET
                 status = 'hidden',
                 deleted_at = NOW()
             FROM app_user u
             WHERE p.id = $1::uuid
               AND p.classroom_id = $2::uuid
               AND u.firebase_uid = $3
               AND u.status = 'active'
               AND p.author_id = u.id
               AND is_classroom_staff(
                   u.id,
                   p.classroom_id
               )
               AND p.status = 'published'
               AND p.deleted_at IS NULL
             RETURNING p.id`,
            [
                postId,
                classroomId,
                req.firebaseUser.uid
            ]
        );

        if (!result.rows.length) {
            return res.status(404).json({
                ok: false,
                message:
                    'Publicación no disponible o sin permiso para eliminarla.'
            });
        }

        return res.json({
            ok: true,
            message: 'Publicación eliminada correctamente.',
            postId: result.rows[0].id
        });

    } catch (error) {
        if (error.code === 'P0001') {
            return res.status(403).json({
                ok: false,
                message:
                    'No tienes autorización para eliminar esta publicación.'
            });
        }

        console.error(
            'Error eliminando publicación:',
            error.code || error.message
        );

        return res.status(500).json({
            ok: false,
            message: 'No se pudo eliminar la publicación.'
        });
    }
};


module.exports = {
    createClassroomPost,
    getClassroomPosts,
    likeClassroomPost,
    unlikeClassroomPost,
    deleteClassroomPost
};