const { connect } = require('../services/rabbitmqService');
const Customer = require('../models/customer');
const Order = require('../models/order');

const startConsumer = async () => {
    try {
        const channel = await connect();
        const ingestionQueue = process.env.RABBITMQ_QUEUE_INGESTION;

        await channel.assertQueue(ingestionQueue, { durable: true });
        console.log("Ingestion Consumer is waiting for messages...");

        channel.consume(ingestionQueue, async (msg) => {
            if (msg !== null) {
                try {
                    const data = JSON.parse(msg.content.toString());
                    console.log('Received message:', data);

                    // Process each item in the batch
                    for (const item of data) {
                        if (item.customerId && !item.orderId) {
                            // This is a customer object
                            await Customer.findOneAndUpdate(
                                { customerId: item.customerId },
                                item,
                                { upsert: true, new: true, setDefaultsOnInsert: true }
                            );
                            console.log(`Customer ${item.customerId} saved/updated successfully.`);
                        } else if (item.orderId && item.customerId) {
                            // This is an order object
                            await Order.findOneAndUpdate(
                                { orderId: item.orderId },
                                item,
                                { upsert: true, new: true, setDefaultsOnInsert: true }
                            );
                            console.log(`Order ${item.orderId} saved/updated successfully.`);
                        }
                    }

                    // Acknowledge the message to remove it from the queue
                    channel.ack(msg);
                } catch (error) {
                    console.error('Error processing message:', error);
                    // Reject the message if there's an error, which might send it to a dead-letter queue
                    channel.nack(msg);
                }
            }
        }, { noAck: false });
    } catch (error) {
        console.error('Failed to start consumer:', error);
    }
};

module.exports = startConsumer;