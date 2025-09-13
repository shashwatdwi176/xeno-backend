const { connect } = require('../services/rabbitmqService');
const CommunicationLog = require('../models/communicationLog');

const startCampaignConsumer = async () => {
    try {
        const channel = await connect();
        const campaignQueue = 'campaign_delivery_queue';

        await channel.assertQueue(campaignQueue, { durable: true });
        console.log("Campaign Consumer is waiting for campaign messages...");

        channel.consume(campaignQueue, async (msg) => {
            if (msg !== null) {
                try {
                    const data = JSON.parse(msg.content.toString());
                    const { campaignDetails, customerIds } = data;

                    console.log(`Processing campaign: ${campaignDetails.name} for ${customerIds.length} customers.`);

                    // Create a new entry in the communication log
                    const logEntry = new CommunicationLog({
                        name: campaignDetails.name,
                        audience_size: campaignDetails.audience_size,
                        rules: campaignDetails.rules,
                        status: 'sent', 
                    });
                    
                    // Simulate sending messages to each customer
                    const deliveryDetails = customerIds.map(customerId => {
                        console.log(`Simulating message to customerId: ${customerId}`);
                        return {
                            customerId: customerId,
                            status: 'sent',
                            message_id: `msg-${Date.now()}-${customerId}`
                        };
                    });
                    
                    logEntry.delivery_details = deliveryDetails;
                    logEntry.sent_count = customerIds.length;

                    // Save the log entry to the database
                    await logEntry.save();
                    console.log(`Campaign "${campaignDetails.name}" logged successfully.`);

                    // Acknowledge the message
                    channel.ack(msg);
                } catch (error) {
                    console.error('Error processing campaign message:', error);
                    channel.nack(msg);
                }
            }
        }, { noAck: false });
    } catch (error) {
        console.error('Failed to start campaign consumer:', error);
    }
};

module.exports = startCampaignConsumer;