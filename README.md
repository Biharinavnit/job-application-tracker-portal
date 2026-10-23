# JobTrack — Job Application Tracker Portal

> A full-stack MERN application to track job applications, interview stages, and get analytics on your job hunt.

![Tech Stack](https://img.shields.io/badge/Stack-MERN-61DAFB?style=flat-square)
![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react)
![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js)
![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-47A248?style=flat-square&logo=mongodb)
![JWT](https://img.shields.io/badge/Auth-JWT-000000?style=flat-square&logo=json-web-tokens)

---

## Problem Statement

Students and professionals apply to dozens of jobs across LinkedIn, Indeed, Naukri, and company portals. Without a central tracker:

- Applications get forgotten
- Interview dates are missed
- Offer deadlines pass unnoticed
- There's no way to measure what's working

**JobTrack** solves this with a structured, beautiful, and data-driven portal.

---

## Features

| Feature          | Description                                         |
| ---------------- | --------------------------------------------------- |
| Auth             | JWT-based register/login with bcrypt                |
| Demo Account     | Read-only demo login with pre-seeded sample applications |
| Password Reset   | Single-use, expiring reset links delivered by SMTP   |
| Add Applications | Company, role, location, salary, source, URL        |
| Stage Tracking   | Saved → Applied → OA → Interview → Offer → Accepted |
| Priority Flag    | Mark important applications                         |
| Search & Filter  | Filter by stage, source; search by company/role     |
| Dashboard        | Stats cards, recent applications, source breakdown  |
| Kanban Board     | Visual pipeline with one-click stage moves          |
| Reports          | Bar charts, pie charts, weekly trends (recharts)    |
| Responsive       | Works on mobile and desktop                         |

---

## Tech Stack

**Frontend**

- React.js 18 (CRA)
- React Router v6
- Axios (API calls with JWT interceptors)
- Recharts (analytics charts)
- React Hot Toast (notifications)
- Custom CSS (dark editorial theme, no framework dependency)

**Backend**

- Node.js + Express.js
- Mongoose (MongoDB ODM)
- bcryptjs (password hashing)
- jsonwebtoken (JWT auth)
- Morgan (request logging)

**Database**

- MongoDB (local or Atlas)

---

## Folder Structure

```
Job-
Application-Tracker-Portal/
│
├── client/                      # React frontend
│   ├── public/
│   │   └── index.html
│   ├── src/
│   │   ├── components/          # Reusable components
│   │   │   ├── Layout.js        # App shell + sidebar
│   │   │   └── ApplicationModal.js # Add/Edit modal
│   │   ├── context/
│   │   │   └── AuthContext.js   # Global auth state
│   │   ├── pages/
│   │   │   ├── LoginPage.js
│   │   │   ├── RegisterPage.js
│   │   │   ├── ForgotPasswordPage.js
│   │   │   ├── ResetPasswordPage.js
│   │   │   ├── DashboardPage.js
│   │   │   ├── ApplicationsPage.js
│   │   │   ├── KanbanPage.js
│   │   │   └── ReportsPage.js
│   │   ├── utils/
│   │   │   └── api.js           # Axios instance
│   │   ├── App.js               # Root + routes
│   │   └── index.css            # Global styles
│   └── package.json
│
├── server/                      # Express backend
│   ├── config/
│   │   └── db.js                # MongoDB connection
│   ├── app.js                   # Express application
│   ├── controllers/
│   │   ├── authController.js    # Register, login, getMe
│   │   ├── applicationController.js  # Full CRUD
│   │   └── dashboardController.js    # Analytics
│   ├── middleware/
│   │   └── authMiddleware.js    # JWT protect middleware
│   ├── models/
│   │   ├── User.js              # User schema
│   │   └── JobApplication.js   # Application schema
│   ├── routes/
│   │   ├── authRoutes.js
│   │   ├── applicationRoutes.js
│   │   └── dashboardRoutes.js
│   ├── services/
│   │   └── emailService.js
│   ├── test/
│   │   └── authPasswordReset.test.js
│   ├── index.js                 # Server entry point
│   └── package.json
│
├── .env.example
├── docs/                        # Screenshots, diagrams
├── .gitignore
└── README.md
```

---

## API Endpoints

### Auth

| Method | Endpoint             | Description                  |
| ------ | -------------------- | ---------------------------- |
| POST   | `/api/auth/register` | Create new user              |
| POST   | `/api/auth/login`    | Login + get JWT              |
| POST   | `/api/auth/demo`     | Start a read-only demo session (rate limited) |
| GET    | `/api/auth/me`       | Get current user (protected) |
| POST   | `/api/auth/forgot-password` | Request a password reset (rate limited) |
| POST   | `/api/auth/reset-password` | Set a new password from a reset token |

### Applications (all protected)

| Method | Endpoint                      | Description             |
| ------ | ----------------------------- | ----------------------- |
| GET    | `/api/applications`           | List all (with filters) |
| POST   | `/api/applications`           | Create new application  |
| GET    | `/api/applications/:id`       | Get single application  |
| PUT    | `/api/applications/:id`       | Full update             |
| DELETE | `/api/applications/:id`       | Delete                  |
| PATCH  | `/api/applications/:id/stage` | Update stage only       |

### Attached documents (protected)

PDF preview uses `POST /api/applications/:id/attachments/:attachmentId/preview-session` followed by a browser-native request to `GET /api/applications/:id/attachments/:attachmentId/view`. The view endpoint supports single-byte HTTP `Range` requests and streams from private storage; preview credentials are 15-minute, HTTP-only cookies scoped to one attachment path, renewed every 10 minutes while the viewer remains open, and are never placed in URLs. Downloads remain available at `GET /api/applications/:id/attachments/:attachmentId`.

No page-count cap is applied. `MAX_DOCUMENT_SIZE_BYTES` controls upload size (10 MiB by default, with a hard upper bound of 25 MiB). Storage capacity, PDF complexity, browser capabilities/memory, and hosting limits still apply; upload processing buffers each file up to its configured size limit. Reverse proxies must preserve preview `Range` requests and the API's `Set-Cookie` response.

### Recently Deleted (protected)

| Method | Endpoint                         | Description |
| ------ | -------------------------------- | ----------- |
| GET    | `/api/trash`                     | List the authenticated user's deleted applications and documents |
| POST   | `/api/trash/:type/:id/restore`    | Restore an application or document |
| DELETE | `/api/trash/:type/:id`            | Permanently delete a trash item |

### Dashboard

| Method | Endpoint                 | Description    |
| ------ | ------------------------ | -------------- |
| GET    | `/api/dashboard/summary` | Analytics data |

---

## Installation & Setup

### Prerequisites

- Node.js 18+
- MongoDB (local) or MongoDB Atlas account

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/Job-Application-Tracker-Portal.git
cd Job-Application-Tracker-Portal
```

### 2. Backend setup

```bash
cd server
npm install
# Create .env only if one does not already exist; preserve existing Atlas credentials.
# PowerShell: Copy-Item ..\.env.example .env
test -f .env || cp ../.env.example .env
# Configure SMTP_* and CLIENT_URL in server/.env for password reset email delivery.
npm run dev
```

### 3. Frontend setup

```bash
cd client
npm install
npm start
```

### 4. Environment variables (`server/.env`)

The root `.env.example` is a placeholder-only template. Copy it to `server/.env` only if `server/.env` does not already exist; otherwise add the required missing SMTP settings, `CLIENT_URL`, `DEMO_USER_EMAIL`, `DEMO_USER_PASSWORD`, and (optionally) `TRASH_RETENTION_DAYS` to the existing file without replacing `MONGO_URI` or `JWT_SECRET`. Do not commit real credentials. The demo email must be a dedicated account address and the seed password must be unique, at least 6 characters, and kept only in `server/.env`. Password reset requires `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `SMTP_USER`, and `SMTP_PASS`; `SMTP_SECURE` should be `true` for implicit TLS (commonly port 465) and `false` for STARTTLS (commonly port 587). `CLIENT_URL` must point to the browser-accessible frontend origin.

### Demo account

Set `DEMO_USER_EMAIL` and `DEMO_USER_PASSWORD` in `server/.env`, then from the `server` directory run:

```bash
npm run seed
```

This provisions the dedicated demo user (the password is hashed by the existing User model) and adds ten fictional job applications. It is safe to rerun: it does not recreate the user, replace its password, overwrite edited sample applications, or delete application records. If the configured email already belongs to a non-demo user, seeding stops without changing that account. Resolve that email conflict before seeding; never repurpose a real account.

The login page's **Try Demo Account** button obtains a normal JobTrack JWT from `/api/auth/demo`; the seed password is not used by the frontend or returned by the API. Demo sessions can view only the demo user's data and are read-only for application and document writes. Password reset does not apply to the demo account. This shared public demo account is not private: do not add personal or confidential information, and expect demo data to be visible to anyone using the button. The endpoint is rate limited, but users of the demo account share its sample data and session identity.

### Recently Deleted and retention

Deleting an application or attached document moves it to **Recently Deleted** without immediately removing its database record or stored file. Restoring an application also restores its attached documents that are still retained and whose files are present; restore a parent application before restoring one of its documents. Permanently deleting an application permanently removes its attached documents as well. Permanent deletion marks records in MongoDB before removing stored files; if storage or database cleanup fails, the item remains pending and can be retried.

`TRASH_RETENTION_DAYS` in `server/.env` controls retention (default `30`; valid range `1`–`3650`). A server-side cleanup task runs on startup and hourly thereafter to permanently remove expired items. Cleanup failures are logged and retried on the next run. This timer runs in each server process; MongoDB/file operations are retry-safe, though multi-instance deployments should use shared durable document storage.

SMTP provider setup varies; obtain the SMTP host, port, account username/password (or app password), and sender address from your provider. Do not use a personal account password unless the provider explicitly requires it, and keep all credentials only in `server/.env`.

### 5. Password reset

From the login page, choose **Forgot Password?**, enter the account email, and use the reset link delivered by your configured SMTP provider. Links expire after one hour and can be used once. A successful reset invalidates existing JWT sessions; the user must sign in again. Forgot-password responses do not disclose whether an address is registered.

### 6. Tests

```bash
cd server
npm test
```

The authentication, demo-seed, password-reset, trash, and document integration tests use an in-memory MongoDB instance and do not connect to or modify the development/Atlas database.

### 7. Access the app

- Frontend: http://localhost:3000
- Backend API: http://localhost:5000

---

## 📸 Screenshots to Capture

## Screenshots

### Register Page

![Register](docs/screenshots/register.png)

### Login Page

![Login](docs/screenshots/login.png)

### Dashboard

![User](docs/screenshots/dashboard.png)

### Kanban dashboard

![Kanban](docs/screenshots/Kanban.png)

### Add Application

![Add application](docs/screenshots/Add-application.png)

### Application

![application]docs/screenshots/Application.png

### Reports and Analytics

![reports](docs/screenshots/reports.png)

### MongoDB Collections

![collection](docs/screenshots/mongodb-item.png)

## 🎬 Demo Video

[![Watch Demo](https://img.youtube.com/vi/WdKlcD4WcEc/0.jpg)](https://youtu.be/WdKlcD4WcEc)

Click the image above to watch the full demo.

## Learning Outcomes

After building this project you will understand:

- Full-stack MERN architecture and separation of concerns
- JWT authentication flow (register → token → protected routes)
- RESTful API design with Express.js
- Mongoose schema design with relationships
- React Context API for global state
- Axios interceptors for automatic token attachment
- React Router v6 with protected/public routes
- Building reusable components (modals, layouts)
- Data visualization with Recharts
- MongoDB aggregation pipelines for analytics

---

## Author

Sonia Thakur

GitHub:
https://github.com/Sonia068

LinkedIn:
https://www.linkedin.com/in/sonia-thakur-6ab93b349/

---

⭐ If you found this project useful, please give it a star on GitHub.
