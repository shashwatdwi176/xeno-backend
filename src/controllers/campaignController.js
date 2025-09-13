const Customer = require('../models/customer');
const { publishToQueue } = require('../services/rabbitmqService');
const axios = require('axios'); //

const buildMongoQuery = (query) => {
    if (!query || !query.rules || query.rules.length === 0) {
        return {};
    }

    const mapOperator = (op) => {
        switch (op) {
            case '=': return '$eq';
            case '!=': return '$ne';
            case '<': return '$lt';
            case '<=': return '$lte';
            case '>': return '$gt';
            case '>=': return '$gte';
            case 'contains': return '$regex';
            default: return op;
        }
    };

    const buildRules = (rules) => {
        return rules.map(rule => {
            if (rule.rules) {
                return {
                    [`$${query.combinator}`]: buildRules(rule.rules)
                };
            }

            let value = rule.value;
            const operator = mapOperator(rule.operator);

            let fieldName = rule.field;
            if (fieldName !== 'email') { 
                fieldName = `metadata.${fieldName}`;
            }

            if (rule.field === 'inactive_days' && operator === '$gt') {
                const date = new Date();
                date.setDate(date.getDate() - parseInt(value));
                return { [fieldName]: { '$lt': date } };
            } else if (rule.operator === 'contains') {
                return { [fieldName]: { [operator]: value, '$options': 'i' } };
            } else {
                return { [fieldName]: { [operator]: value } };
            }
        });
    };

    const mongoQuery = {
        [`$${query.combinator}`]: buildRules(query.rules)
    };

    return mongoQuery;
};

// Endpoint to preview audience size based on rules
exports.previewAudience = async (req, res) => {
    try {
        const rules = req.body;
        const mongoQuery = buildMongoQuery(rules);
        const count = await Customer.countDocuments(mongoQuery);
        res.status(200).json({ success: true, count });
    } catch (error) {
        console.error('Error previewing audience:', error);
        res.status(500).json({ success: false, message: 'Failed to preview audience.' });
    }
};


// Function to get a single customer by ID
exports.getCustomer = async (req, res) => {
    try {
        const { customerId } = req.params;
        const customer = await Customer.findOne({ customerId: customerId });
        if (!customer) {
            return res.status(404).json({ success: false, message: 'Customer not found.' });
        }
        res.status(200).json({ success: true, customer });
    } catch (error) {
        console.error('Error fetching customer:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch customer.' });
    }
};

// Function to get all customers
exports.getCustomers = async (req, res) => {
    try {
        const customers = await Customer.find({});
        res.status(200).json({ success: true, customers });
    } catch (error) {
        console.error('Error fetching customers:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch customers.' });
    }
};


// Endpoint to create a new campaign
exports.createCampaign = async (req, res) => {
    try {
        const { rules, name } = req.body;
        const mongoQuery = buildMongoQuery(rules);

        // Fetch all customers matching the query
        const customers = await Customer.find(mongoQuery).select('customerId');
        const customerIds = customers.map(c => c.customerId);

        // Store campaign details in a communication_log table (we'll create this model)
        const campaignDetails = {
            name,
            audience_size: customerIds.length,
            rules: rules,
            status: 'queued',
            sent_count: 0,
            failed_count: 0,
            created_at: new Date()
        };

        // Publish to a new RabbitMQ queue for campaign delivery
        await publishToQueue('campaign_delivery_queue', {
            campaignDetails,
            customerIds
        });

        res.status(202).json({ success: true, message: 'Campaign creation queued successfully.', campaign: campaignDetails });

    } catch (error) {
        console.error('Error creating campaign:', error);
        res.status(500).json({ success: false, message: 'Failed to create campaign.' });
    }
};