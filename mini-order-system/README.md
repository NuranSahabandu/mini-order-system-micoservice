# Mini Order System

A small, learning-oriented microservices system that demonstrates the core patterns behind a real-world backend: an **API gateway**, **service-to-service communication** (both synchronous HTTP and asynchronous messaging), **database-per-service**, and **event-driven notifications**.

Placing an order walks through all of these patterns end to end: the gateway routes the request, the Order Service synchronously validates the product against the Product Service, persists the order to its own database, and publishes an event that the Notification Service consumes asynchronously.

---

## Architecture

```
                          ┌──────────────────┐
        HTTP :3000        │   API Gateway    │
  client ───────────────► │  (reverse proxy) │
                          └───────┬──────────┘
                        /products │ │ /orders
                   ┌──────────────┘ └───────────────┐
                   ▼                                 ▼
          ┌─────────────────┐               ┌─────────────────┐
          │ Product Service │◄──────────────│  Order Service  │
          │      :3001      │  GET /products│      :3002      │
          └───────┬─────────┘  /:id (sync)  └───────┬─────────┘
                  │                                  │
                  ▼                                  ▼
          ┌─────────────┐                    ┌─────────────┐
          │ product-db  │                    │  order-db   │
          │ (Postgres)  │                    │ (Postgres)  │
          └─────────────┘                    └──────┬──────┘
                                                    │ publish
                                                    │ order.created
                                                    ▼
                                         ┌──────────────────────┐
                                         │  RabbitMQ (fanout)    │
                                         │   "order-events"      │
                                         └──────────┬───────────┘
                                                    │ consume
                                                    ▼
                                         ┌──────────────────────┐
                                         │ Notification Service  │
                                         └──────────────────────┘
```

### Communication styles

- **Synchronous (HTTP)** — When creating an order, the Order Service calls the Product Service directly to verify the product exists and fetch its price. It waits for the answer before continuing.
- **Asynchronous (events)** — After an order is saved, the Order Service publishes an `order.created` event to a RabbitMQ **fanout** exchange. The Notification Service consumes these events independently, so order creation never blocks on notification delivery.

---

## Services

| Service | Port | Description | Datastore |
| --- | --- | --- | --- |
| **api-gateway** | `3000` | Single public entry point. Proxies `/products*` to the Product Service and `/orders*` to the Order Service. | — |
| **product-service** | `3001` | CRUD for products (create, list, get by id). Source of truth for product data and prices. | `product-db` (Postgres) |
| **order-service** | `3002` | Creates and lists orders. Validates products via the Product Service and publishes `order.created` events. | `order-db` (Postgres) |
| **notification-service** | — | Background worker. Consumes `order.created` events and logs a "confirmation email" for each order. | — |
| **rabbitmq** | `5672` / `15672` | Message broker connecting Order Service (publisher) and Notification Service (consumer). Management UI on `15672`. | — |

> Only the **API Gateway** is exposed to the host. The individual services are reachable only inside the Docker network — the gateway is the front door.

---

## Tech stack

- **Node.js 20** with **Express 5** (ES modules)
- **PostgreSQL 16** — one database per stateful service
- **RabbitMQ 3** (with management plugin) — fanout exchange for events
- **axios** — HTTP calls between services and inside the gateway proxy
- **amqplib** — RabbitMQ client
- **Docker Compose** — orchestrates all services

---

## Getting started

### Prerequisites

- [Docker](https://www.docker.com/) and Docker Compose

### Run everything

```bash
docker compose up --build
```

This builds and starts all services, both databases, and RabbitMQ. The database schemas are created automatically on first run from the `init/init.sql` files (mounted into each Postgres container's init directory).

Once running:

- **API Gateway** → http://localhost:3000
- **RabbitMQ management UI** → http://localhost:15672 (guest / guest)

### Stop

```bash
docker compose down          # stop containers
docker compose down -v        # stop and remove database volumes (fresh start)
```

---

## API reference

All requests go through the gateway at `http://localhost:3000`.

### Products

**Create a product**

```bash
curl -X POST http://localhost:3000/products \
  -H "Content-Type: application/json" \
  -d '{"name": "Keyboard", "price": 49.99}'
```

**List products**

```bash
curl http://localhost:3000/products
```

**Get a product by id**

```bash
curl http://localhost:3000/products/1
```

### Orders

**Create an order** (validates the product, computes the total, saves it, and emits an event)

```bash
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{"productId": 1, "quantity": 3}'
```

Behavior:
- `400` if `productId` or a positive `quantity` is missing
- `404` if the product does not exist
- `503` if the Product Service is unreachable
- `201` with the created order on success — watch the `notification-service` logs for the confirmation message

**List orders**

```bash
curl http://localhost:3000/orders
```

### Health checks

Each HTTP service exposes a health endpoint:

```bash
curl http://localhost:3000/health   # api-gateway
```

---

## Data model

**products** (`product-db`)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | serial | primary key |
| `name` | varchar(255) | required |
| `price` | numeric(10,2) | required |
| `created_at` | timestamp | defaults to `now()` |

**orders** (`order-db`)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | serial | primary key |
| `product_id` | integer | product reference (no cross-db FK — services own their data) |
| `product_name` | varchar(255) | snapshotted at order time |
| `quantity` | integer | required |
| `total_price` | numeric(10,2) | `price × quantity` |
| `status` | varchar(50) | defaults to `CREATED` |
| `created_at` | timestamp | defaults to `now()` |

---

## How an order flows through the system

1. Client sends `POST /orders` to the **API Gateway**.
2. Gateway proxies the request to the **Order Service**.
3. Order Service calls the **Product Service** (`GET /products/:id`) to confirm the product exists and fetch its price — a **synchronous** call.
4. Order Service computes `total_price` and inserts the order into **order-db**.
5. Only *after* the DB write succeeds, it publishes an `order.created` event to the **RabbitMQ** `order-events` fanout exchange.
6. The **Notification Service**, bound to that exchange, consumes the event and logs an order confirmation.

The event is published only after the order is durably saved, and the queue/messages are marked durable so events survive a broker restart.

---

## Project structure

```
mini-order-system/
├── docker-compose.yml          # orchestrates all services + infra
├── api-gateway/
│   └── src/index.js            # reverse proxy to product & order services
├── product-service/
│   ├── src/index.js            # product CRUD endpoints
│   ├── src/db.js               # Postgres connection pool
│   └── init/init.sql           # products table schema
├── order-service/
│   ├── src/index.js            # order endpoints + product validation
│   ├── src/db.js               # Postgres connection pool
│   ├── src/rabbitmq.js         # event publisher
│   └── init/init.sql           # orders table schema
└── notification-service/
    └── src/index.js            # event consumer
```

---

## Notes & learning takeaways

- **Database per service** — Product and Order services never share a database. The Order Service snapshots `product_name` at order time instead of joining across databases.
- **The gateway is the only public surface** — internal services communicate over the Docker network using service names (e.g. `http://product-service:3001`), never `localhost`.
- **Sync vs. async, deliberately chosen** — product validation must happen before an order is accepted (synchronous), while notifications can happen whenever (asynchronous, event-driven).
- **Fanout exchange** — new consumers can subscribe to `order.created` events without any change to the Order Service, which is the whole point of event-driven decoupling.

> This is a learning project — services have no automated tests and use minimal error handling in places. It's intended to illustrate microservice patterns, not production hardening.
