
const express = require('express');
const router = express.Router();

const verifyFirebaseToken = require(
    '../middleware/authMiddleware'
);

const {
    getMyClassrooms,
    createClassroom,
    getClassroomById,
    updateJoinSettings,
    joinClassroomByCode,
    getStudentClassrooms
} = require('../controllers/classroomController');

const {
    getJoinRequests,
    reviewJoinRequest
} = require('../controllers/joinRequestController');


const {
    archiveClassroom,
    restoreClassroom,
    getArchivedClassrooms
} = require('../controllers/classroomArchiveController');


// GET: clases del docente o director
router.get(
    '/mine',
    verifyFirebaseToken,
    getMyClassrooms
);

// POST: crear nueva clase
router.post(
    '/',
    verifyFirebaseToken,
    createClassroom
);

// PATCH: configurar modo de ingreso
router.patch(
    '/:id/join-settings',
    verifyFirebaseToken,
    updateJoinSettings
);

// Clases y solicitudes del alumno autenticado
router.get(
    '/student/mine',
    verifyFirebaseToken,
    getStudentClassrooms
);


// Solicitudes pendientes de una clase
router.get(
    '/:id/join-requests',
    verifyFirebaseToken,
    getJoinRequests
);

// Aprobar o rechazar solicitud
router.patch(
    '/:id/join-requests/:requestId',
    verifyFirebaseToken,
    reviewJoinRequest
);


// GET: consultar detalles de clase
router.get(
    '/:id',
    verifyFirebaseToken,
    getClassroomById
);


router.get(
    '/archived/mine',
    verifyFirebaseToken,
    getArchivedClassrooms
);

router.patch(
    '/:id/archive',
    verifyFirebaseToken,
    archiveClassroom
);

router.patch(
    '/:id/restore',
    verifyFirebaseToken,
    restoreClassroom
);

 // POST /api/classrooms/join Un estudiante ingresa mediante código.

router.post(
    '/join',
    verifyFirebaseToken,
    joinClassroomByCode
);



module.exports = router;
