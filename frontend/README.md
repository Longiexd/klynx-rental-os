# Klynx Rental OS

> A modern operations platform for rental businesses — fleet, customers, CRM and rental workflows in one interface.

**Klynx Rental OS** is a full-stack SaaS prototype designed for car rental businesses. It provides a modern operational interface on top of an ERP-backed API, replacing fragmented workflows with a unified dashboard.

This repository is the **sanitized public portfolio version** of the project.

---

## Architecture

```text
┌──────────────────────────────┐
│        Next.js Frontend      │
│                              │
│  Dashboard · Fleet · CRM     │
│  Customers · Reservations    │
└──────────────┬───────────────┘
               │ HTTP / JSON
               ▼
┌──────────────────────────────┐
│        FastAPI Backend       │
│                              │
│  REST API · CORS · Business  │
│  Logic · ERP Integration     │
└──────────────┬───────────────┘
               │ JSON-RPC
               ▼
┌──────────────────────────────┐
│          Odoo ERP            │
│                              │
│ Fleet · CRM · Customers      │
│ Accounting · Operations      │
└──────────────────────────────┘
```

The frontend communicates exclusively with the FastAPI layer. The backend handles communication with Odoo through its API rather than exposing ERP credentials or endpoints to the browser.

---

## Tech Stack

### Frontend

* **Next.js**
* **React**
* **TypeScript**
* **Tailwind CSS**
* **Lucide Icons**
* Component-based UI architecture

### Backend

* **Python**
* **FastAPI**
* **Pydantic**
* **Uvicorn**
* **Odoo JSON-RPC**

### Infrastructure

* **Docker**
* **Docker Compose**
* Environment-based configuration
* Reverse-proxy ready architecture

### Data

The application is designed around an **Odoo-backed data layer**, allowing the operational interface to consume existing ERP entities such as:

* Vehicles
* Customers
* CRM leads
* Rental operations

---

## Core Features

### Fleet

Manage rental vehicles from a centralized interface.

* Vehicle list
* Registration / license plate
* Vehicle model
* Availability state
* Fleet status

### Customers

Access customer information through the operational dashboard.

* Customer identity
* Email
* Phone
* Mobile
* ERP-backed customer records

### CRM

Manage rental leads and customer opportunities.

* Lead pipeline
* Customer association
* Contact information
* Pipeline stage
* Expected revenue
* Lead creation

### Dashboard

A unified operational overview designed around the information a rental business needs every day.

The UI is intentionally closer to a modern SaaS application than a traditional ERP interface.

---

## API

The FastAPI service exposes a lightweight REST layer over the ERP backend.

| Method | Endpoint     | Description             |
| ------ | ------------ | ----------------------- |
| `GET`  | `/`          | API health / root       |
| `GET`  | `/login`     | ERP authentication test |
| `GET`  | `/cars`      | Retrieve fleet vehicles |
| `GET`  | `/customers` | Retrieve customers      |
| `GET`  | `/leads`     | Retrieve CRM leads      |
| `POST` | `/leads`     | Create a CRM lead       |

Example:

```http
GET /cars
```

Response:

```json
{
  "count": 2,
  "cars": [
    {
      "id": 1,
      "name": "Example Vehicle",
      "license_plate": "123-TUN-0000",
      "model": "Example Model",
      "status": "Available"
    }
  ]
}
```

---

## Project Structure

```text
klynx-rental-os/
│
├── backend/
│   ├── app/
│   │   ├── routes/
│   │   │   ├── cars.py
│   │   │   ├── customers.py
│   │   │   └── leads.py
│   │   │
│   │   ├── config.py
│   │   ├── main.py
│   │   └── odoo_client.py
│   │
│   ├── .env.example
│   ├── Dockerfile
│   └── requirements.txt
│
├── frontend/
│   ├── app/
│   │   ├── api/
│   │   ├── dashboard/
│   │   ├── login/
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   │
│   ├── components/
│   │   ├── layout/
│   │   └── ui/
│   │
│   ├── styles/
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
│
├── docker-compose.yml
├── .gitignore
└── README.md
```

---

## Local Development

### Requirements

* Docker
* Docker Compose
* Node.js 20+
* Python 3.11+
* A reachable Odoo instance for ERP-backed functionality

---

### 1. Clone

```bash
git clone <repository-url>
cd klynx-rental-os
```

### 2. Configure the backend

```bash
cp backend/.env.example backend/.env
```

Configure the local Odoo connection:

```env
ODOO_URL=http://localhost:8069
ODOO_DB=your_database
ODOO_USERNAME=your_username
ODOO_PASSWORD=your_password
```

The `.env` file is intentionally ignored by Git.

### 3. Configure the frontend

```bash
cp frontend/.env.example frontend/.env.local
```

Example:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

### 4. Start the stack

```bash
docker compose up -d --build
```

Frontend:

```text
http://localhost:3100
```

Backend:

```text
http://localhost:8000
```

FastAPI documentation:

```text
http://localhost:8000/docs
```

---

## Environment & Secrets

No production credentials, API keys, certificates, private keys or deployment secrets are included in this repository.

Environment-specific configuration is provided through:

```text
backend/.env.example
frontend/.env.example
```

Create local environment files from these templates when running the project locally.

**Never commit `.env`, `.env.local`, certificates, private keys or production credentials.**

---

## Design Direction

The interface follows a dark, modern SaaS design language focused on operational clarity.

```text
Background     #09090B
Cards          #111113
Secondary      #17171A
Borders        #2B2B30
Primary        #C8F065
Accent         #F06AAA
Text           #FFFFFF
```

The goal is to make complex ERP-backed workflows feel closer to a modern product than a traditional enterprise interface.

---

## Engineering Goals

The project is built around a few principles:

* **API-first architecture**
* **Separation of frontend and ERP infrastructure**
* **Environment-based configuration**
* **Containerized development**
* **Reusable domain modules**
* **Minimal coupling between UI and ERP implementation**
* **Clear separation between public and private infrastructure**

The FastAPI layer acts as an abstraction boundary between the frontend and Odoo, making it possible to evolve the frontend independently from the underlying ERP.

---

## Roadmap

* [x] Next.js frontend
* [x] FastAPI backend
* [x] Docker development environment
* [x] Odoo integration
* [x] Fleet API
* [x] Customer API
* [x] CRM API
* [x] Dashboard UI
* [x] Public repository sanitization
* [ ] Reservation management
* [ ] Calendar interface
* [ ] Rental contracts
* [ ] Vehicle availability engine
* [ ] Authentication / session management
* [ ] Role-based access control
* [ ] Analytics & KPIs
* [ ] Production deployment

---

## Project Status

**Prototype / Active Development**

Klynx Rental OS is being developed as a reusable vertical SaaS architecture for rental businesses.

The current repository intentionally focuses on the technical foundation and UI architecture rather than production deployment configuration.

---

## About Klynx

**Klynx** is an independent software initiative focused on building modern operational systems for small and medium-sized businesses.

Rental OS is the first vertical implementation of this architecture.

The broader concept is to build reusable **Business OS** platforms that combine:

```text
ERP
 +
Automation
 +
Modern UX
 +
Operational Analytics
```

into focused industry-specific products.

---

## License

This repository is provided for portfolio and demonstration purposes.

See the repository license for usage and redistribution terms.
