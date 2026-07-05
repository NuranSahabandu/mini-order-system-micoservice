import express from "express";
import axios from "axios";
import pool from "./db.js";
import { connectRabbitMQ, publishOrderCreated } from "./rabbitmq.js";

const app = express();
app.use(express.json());

// Internal Docker network address — NOT localhost, NOT the host-mapped port
const PRODUCT_SERVICE_URL =
  process.env.PRODUCT_SERVICE_URL || "http://product-service:3001";

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "order-service" });
});

app.post("/orders", async (req, res) => {
  const { productId, quantity } = req.body;

  if (!productId || !quantity || quantity <= 0) {
    return res
      .status(400)
      .json({ error: "productId and a positive quantity are required" });
  }

  // Step A: ask Product Service if this product exists, and what it costs.
  // This is a SYNCHRONOUS call — Order Service waits for the answer before continuing.
  let product;
  try {
    const response = await axios.get(
      `${PRODUCT_SERVICE_URL}/products/${productId}`
    );
    product = response.data;
  } catch (err) {
    if (err.response && err.response.status === 404) {
      return res.status(404).json({ error: "Product does not exist" });
    }
    // Product Service is down or unreachable
    console.error("Failed to reach product-service:", err.message);
    return res
      .status(503)
      .json({ error: "Product service unavailable, try again later" });
  }

  // Step B: compute total price locally. parseFloat because pg returns NUMERIC as a string.
  const unitPrice = parseFloat(product.price);
  const totalPrice = unitPrice * quantity;

  // Step C: save the order in Order Service's OWN database
  const result = await pool.query(
    `INSERT INTO orders (product_id, product_name, quantity, total_price)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [product.id, product.name, quantity, totalPrice]
  );

  const order = result.rows[0];

  // Fire the event AFTER the order is safely saved — never publish before the DB write succeeds
  publishOrderCreated(order);

  res.status(201).json(order);
});

app.get("/orders", async (req, res) => {
  const result = await pool.query("SELECT * FROM orders ORDER BY id");
  res.json(result.rows);
});

const PORT = process.env.PORT || 3002;

connectRabbitMQ().then(() => {
  app.listen(PORT, () => {
    console.log(`Order service running on port ${PORT}`);
  });
}).catch(err => {
  console.error("Failed to connect to RabbitMQ:", err);
  process.exit(1);
});
