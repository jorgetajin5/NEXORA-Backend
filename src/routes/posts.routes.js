
const express = require('express');
const router = express.Router();

const verifyFirebaseToken = require(
    '../middleware/authMiddleware'
);

const {
    createClassroomPost,
    getClassroomPosts,
    likeClassroomPost,
    unlikeClassroomPost,
    deleteClassroomPost
} = require('../controllers/postController');

// Crear publicación dentro de una clase
router.post(
    '/:id/posts',
    verifyFirebaseToken,
    createClassroomPost
);

// Consultar publicaciones de una clase
router.get(
    '/:id/posts',
    verifyFirebaseToken,
    getClassroomPosts
);


// Agregar "Me gusta"
router.post(
    '/:id/posts/:postId/like',
    verifyFirebaseToken,
    likeClassroomPost
);

// Quitar "Me gusta"
router.delete(
    '/:id/posts/:postId/like',
    verifyFirebaseToken,
    unlikeClassroomPost
);

// Eliminar lógicamente una publicación
router.delete(
    '/:id/posts/:postId',
    verifyFirebaseToken,
    deleteClassroomPost
);

module.exports = router;
