import amqp from "amqplib";

const EXCHANGE_NAME = "order-events";
let channel;

export async function connectRabbitMQ() {
  const connection = await amqp.connect(process.env.RABBITMQ_URL);
  channel = await connection.createChannel();

  // "fanout" = broadcast to every queue bound to this exchange, no filtering
  await channel.assertExchange(EXCHANGE_NAME, "fanout", { durable: true });

  console.log("Order Service connected to RabbitMQ");
}

export function publishOrderCreated(order) {
  if (!channel) {
    console.error("RabbitMQ channel not ready, skipping publish");
    return;
  }

  const message = Buffer.from(JSON.stringify(order));

  // Publishing to the exchange with an empty routing key — fanout exchanges ignore it anyway
  channel.publish(EXCHANGE_NAME, "", message, { persistent: true });

  console.log(`Published order.created event for order ${order.id}`);
}