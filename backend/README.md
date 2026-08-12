# Rental OS Backend

## Overview

The Rental OS backend is a stateless REST API built with **FastAPI** that acts as a middleware between the frontend application and the Odoo ERP backend.

Instead of exposing Odoo directly, the API handles authentication, business logic, data transformation, and provides a clean REST interface for the frontend.

---

## Architecture

```
                HTTPS
                  │
                  ▼
          Next.js Frontend
                  │
             REST API
                  │
                  ▼
        FastAPI Backend (Python)
                  │
          JSON-RPC (execute_kw)
                  │
                  ▼
             Odoo Community 18
                  │
          PostgreSQL Database
```

---

## Tech Stack

| Layer | Technology |
|--------|------------|
| Language | Python 3.12 |
| Framework | FastAPI |
| HTTP Client | Requests |
| ERP | Odoo Community 18 |
| Communication | JSON-RPC |
| Database | PostgreSQL |
| Containerization | Docker |
| Reverse Proxy | Nginx |
| Deployment | Docker Compose |

---

## Backend Structure

```
backend/
│
├── app/
│   ├── main.py
│   ├── config.py
│   ├── odoo_client.py
│   │
│   └── routes/
│       ├── cars.py
│       ├── customers.py
│       └── leads.py
│
├── Dockerfile
└── requirements.txt
```

---

## Responsibilities

- Authenticate against Odoo
- Manage JSON-RPC communication
- Abstract Odoo models
- Transform ERP responses into frontend-friendly JSON
- Centralize business logic
- Expose REST endpoints
- Isolate frontend from ERP internals

---

## Odoo Client

A reusable `OdooClient` handles:

- Authentication
- Session management
- Generic `execute_kw()` calls
- Error handling
- Model abstraction

All API routes reuse the same client.

---

## Current API

### Authentication

```
GET /login
```

Authenticates against Odoo and returns the user UID.

---

### Fleet

```
GET /cars
```

Returns the vehicle fleet.

Response:

```json
{
  "count": 6,
  "cars": [
    {
      "id": 3,
      "name": "...",
      "license_plate": "...",
      "model": "...",
      "status": "Disponible"
    }
  ]
}
```

---

### Customers

```
GET /customers
```

Returns all customer contacts.

---

### CRM

```
GET /leads
```

Returns CRM opportunities.

```
POST /leads
```

Creates a new CRM lead.

---

## Communication Flow

```
Frontend
    │
GET /cars
    │
    ▼
FastAPI
    │
execute_kw()
    │
    ▼
Odoo JSON-RPC
    │
fleet.vehicle.search_read()
    │
    ▼
PostgreSQL
```

---

## Design Principles

- Stateless API
- Thin controllers
- Modular routes
- Centralized Odoo client
- ERP abstraction layer
- Frontend-oriented responses
- Docker-first deployment
- Easily extensible for additional Odoo modules

---

## Future Endpoints

```
GET    /dashboard
GET    /reservations
POST   /reservations
PATCH  /reservations/{id}

GET    /calendar

GET    /fleet/{id}

PATCH  /fleet/{id}

POST   /customers

PATCH  /customers/{id}

DELETE /customers/{id}

POST   /contracts

GET    /analytics
```

---

## Long-Term Goal

Provide a stable REST interface that abstracts Odoo into a modern, frontend-friendly Business Operating System capable of powering multiple industry-specific platforms while keeping ERP complexity isolated within the backend.
