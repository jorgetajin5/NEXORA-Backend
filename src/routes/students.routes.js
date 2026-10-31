
const express = require('express');

const router = express.Router();

const verifyFirebaseToken = require(
    '../middleware/authMiddleware'
);


const {
    getClassroomStudents,
    createStudent,
    searchStudents,
    enrollExistingStudent
} = require('../controllers/studentController');

// GET: consultar estudiantes activos de una clase
router.get(
    '/:id/students',
    verifyFirebaseToken,
    getClassroomStudents
);

// POST: registrar estudiante sin cuenta Firebase
router.post(
    '/:id/students',
    verifyFirebaseToken,
    createStudent
);

// POST: buscar estudiantes existentes
router.post(
    '/:id/students/search',
    verifyFirebaseToken,
    searchStudents
);

// POST: incorporar estudiante existente
router.post(
    '/:id/students/enroll-existing',
    verifyFirebaseToken,
    enrollExistingStudent
);

module.exports = router;
