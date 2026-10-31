
const express = require('express');
const router = express.Router();

const verifyFirebaseToken =
    require('../middleware/authMiddleware');

const {
    removeClassroomStudent
} = require('../controllers/studentRemovalController');

router.patch(
    '/:id/students/:studentId/remove',
    verifyFirebaseToken,
    removeClassroomStudent
);

module.exports = router;
