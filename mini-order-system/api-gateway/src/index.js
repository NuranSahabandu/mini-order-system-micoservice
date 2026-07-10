import express from 'express';
import axios from 'axios';

const app = express();
app.use(express.json());

const PRODUCT_SERVICE_URL =
  process.env.PRODUCT_SERVICE_URL || "http://product-service:3001";
const ORDER_SERVICE_URL =
  process.env.ORDER_SERVICE_URL || "http://order-service:3002";

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "api-gateway" });
});

// A single reusable proxy function — takes the incoming request,
// the target base URL, and forwards the request there.
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
      validateStatus: () => true, // don't let axios throw on 4xx/5xx — we want to relay them as-is
    });

    res.status(response.status).json(response.data);
  } catch (err) {
    console.error(`Gateway failed to reach ${targetUrl}:`, err.message);
    res.status(502).json({ error: "Upstream service unavailable" });
  }
}

// Every request starting with /products goes to Product Service
app.all("/products", (req, res) => proxyRequest(req, res, PRODUCT_SERVICE_URL));
app.all("/products/*", (req, res) => proxyRequest(req, res, PRODUCT_SERVICE_URL));

// Every request starting with /orders goes to Order Service
app.all("/orders", (req, res) => proxyRequest(req, res, ORDER_SERVICE_URL));
app.all("/orders/*", (req, res) => proxyRequest(req, res, ORDER_SERVICE_URL));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API Gateway running on port ${PORT}`);
});