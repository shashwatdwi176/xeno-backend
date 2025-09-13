const amqp = require('amqplib');
const RABBITMQ_URL = process.env.RABBITMQ_URL;

let connection = null;
let channel = null;

const connect = async () => {
    try {
        if (!connection) {
            connection = await amqp.connect(RABBITMQ_URL);
            console.log('Connected to RabbitMQ');
        }
        if (!channel) {
            channel = await connection.createChannel();
        }
        return channel;
    } catch (error) {
        console.error('Failed to connect to RabbitMQ:', error);
        throw error;
    }
};

const publishToQueue = async (queue, data) => {
    try {
        if (!channel) {
            await connect();
        }
        await channel.assertQueue(queue, { durable: true });
        channel.sendToQueue(queue, Buffer.from(JSON.stringify(data)), { persistent: true });
        console.log(`Message published to queue: ${queue}`);
    } catch (error) {
        console.error('Failed to publish message:', error);
        throw error;
    }
};

module.exports = {
    connect,
    publishToQueue
};
