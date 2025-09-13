const express = require('express');
const router = express.Router();
const { previewAudience, createCampaign } = require('../controllers/campaignController');


router.post('/preview', previewAudience);
router.post('/create', createCampaign);


module.exports = router;