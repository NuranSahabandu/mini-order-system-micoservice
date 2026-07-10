import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

const PRODUCT_SERVICE_URL =
  process.env.PRODUCT_SERVICE_URL || "http://product-service:3001";
const ORDER_SERVICE_URL =
  process.env.ORDER_SERVICE_URL || "http://order-service:3002";

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "api-gateway" });
});

async function proxyRequest(req, res, targetBaseUrl) {
  const targetUrl = `${targetBaseUrl}${req.originalUrl}`;

  try {
    const response = await axios({
      method: req.method,
      url: targetUrl,
      data: req.body,
      headers: {
        "Content-Type": "application/json",
      },
      validateStatus: () => true,
    });

    res.status(response.status).json(response.data);
  } catch (err) {
    console.error(`Gateway failed to reach ${targetUrl}:`, err.message);
    res.status(502).json({ error: "Upstream service unavailable" });
  }
}

// app.use matches this path AND everything under it — e.g. /products, /products/1, /products/1/reviews
app.use("/products", (req, res) => proxyRequest(req, res, PRODUCT_SERVICE_URL));
app.use("/orders", (req, res) => proxyRequest(req, res, ORDER_SERVICE_URL));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API Gateway running on port ${PORT}`);
});