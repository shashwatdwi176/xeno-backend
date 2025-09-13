const express = require('express');
const router = express.Router();
const { ingestCustomers, ingestOrders } = require('../controllers/ingestionController');

router.post('/customers', ingestCustomers);
router.post('/orders', ingestOrders);

module.exports = router;