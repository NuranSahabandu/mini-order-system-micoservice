import amqp from "amqplib";

const EXCHANGE_NAME = "order-events";
const QUEUE_NAME = "order-created-queue";

async function start() {
  const connection = await amqp.connect(process.env.RABBITMQ_URL);
  const channel = await connection.createChannel();

  await channel.assertExchange(EXCHANGE_NAME, "fanout", { durable: true });

  // This queue survives RabbitMQ restarts (paired with persistent:true on the publish side)
  const queue = await channel.assertQueue(QUEUE_NAME, { durable: true });

  // The binding: "send this exchange's messages into my queue"
  await channel.bindQueue(queue.queue, EXCHANGE_NAME, "");

  console.log("Notification Service listening for order.created events...");

  channel.consume(queue.queue, (msg) => {
    if (msg === null) return;

    const order = JSON.parse(msg.content.toString());

    console.log(
      `[Notification] Order #${order.id} created — sending confirmation email for "${order.product_name}" (qty: ${order.quantity}, total: $${order.total_price})`
    );

    // Acknowledge — tells RabbitMQ "I successfully handled this, you can remove it from the queue"
    channel.ack(msg);
  });
}

start().catch((err) => {
  console.error("Notification Service failed to start:", err);
  process.exit(1);
});