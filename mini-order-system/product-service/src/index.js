import express from "express";
import pool from "./db.js";

const app = express();
app.use(express.json());

// Health check — every service should have one; the gateway and Docker will use this
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "product-service" });
});

// Create a product
app.post("/products", async (req, res) => {
  const { name, price } = req.body;
  if (!name || price == null) {
    return res.status(400).json({ error: "name and price are required" });
  }
  const result = await pool.query(
    "INSERT INTO products (name, price) VALUES ($1, $2) RETURNING *",
    [name, price]
  );
  res.status(201).json(result.rows[0]);
});

// List all products
app.get("/products", async (req, res) => {
  const result = await pool.query("SELECT * FROM products ORDER BY id");
  res.json(result.rows);
});

// Get a single product by id — Order Service will call this one
app.get("/products/:id", async (req, res) => {
  const result = await pool.query("SELECT * FROM products WHERE id = $1", [
    req.params.id,
  ]);
  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Product not found" });
  }
  res.json(result.rows[0]);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Product service running on port ${PORT}`);
});