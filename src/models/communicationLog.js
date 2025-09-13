const mongoose = require('mongoose');

const communicationLogSchema = new mongoose.Schema({
    name: { type: String, required: true },
    audience_size: { type: Number, required: true },
    rules: { type: mongoose.Schema.Types.Mixed }, // Store the JSON rules
    status: { type: String, enum: ['queued', 'sent', 'failed'], default: 'queued' },
    sent_count: { type: Number, default: 0 },
    failed_count: { type: Number, default: 0 },
    created_at: { type: Date, default: Date.now },
    delivery_details: [{
        customerId: { type: String, required: true },
        status: { type: String, enum: ['queued', 'sent', 'failed'] },
        message_id: String,
        timestamp: { type: Date, default: Date.now }
    }]
}, { timestamps: true });

const CommunicationLog = mongoose.model('CommunicationLog', communicationLogSchema);

module.exports = CommunicationLog;