const Joi = require('joi');
const { publishToQueue } = require('../services/rabbitmqService');

const ingestionQueue = process.env.RABBITMQ_QUEUE_INGESTION;

// Joi validation schemas
const customerSchema = Joi.object({
    customerId: Joi.string().required(),
    name: Joi.string().required(),
    email: Joi.string().email().required(),
    phone: Joi.string(),
    metadata: Joi.object({
        last_visit: Joi.date(),
        total_spend: Joi.number(),
        visit_count: Joi.number()
    })
});

const orderSchema = Joi.object({
    orderId: Joi.string().required(),
    customerId: Joi.string().required(),
    items: Joi.array().items(Joi.object({
        itemId: Joi.string(),
        price: Joi.number(),
        quantity: Joi.number()
    })).required(),
    totalAmount: Joi.number().required(),
    orderDate: Joi.date()
});

const validateAndPublish = async (schema, data, res) => {
    try {
        const { error } = schema.validate(data, { abortEarly: false });
        if (error) {
            return res.status(400).json({ success: false, message: 'Validation failed', errors: error.details });
        }
        await publishToQueue(ingestionQueue, data);
        res.status(202).json({ success: true, message: 'Data accepted and queued for processing.' });
    } catch (error) {
        console.error('Error in ingestion:', error);
        res.status(500).json({ success: false, message: 'Server error occurred.' });
    }
};

exports.ingestCustomers = async (req, res) => {
    const customers = req.body;
    if (!Array.isArray(customers)) {
        return res.status(400).json({ success: false, message: 'Expected an array of customers.' });
    }
    await validateAndPublish(Joi.array().items(customerSchema), customers, res);
};

exports.ingestOrders = async (req, res) => {
    const orders = req.body;
    if (!Array.isArray(orders)) {
        return res.status(400).json({ success: false, message: 'Expected an array of orders.' });
    }
    await validateAndPublish(Joi.array().items(orderSchema), orders, res);
};