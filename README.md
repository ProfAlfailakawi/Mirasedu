# Mirasedu

Mirasedu is an educational platform with advanced features including WebAuthn, role-based access, and intelligent learning tools.

## Architecture

*   **Frontend:** React (Vite + TS). `src/App.tsx` is currently a monolithic root component actively being refactored into `src/features/` and `src/shared/`.
*   **Backend:** Express server (`server.ts`) handling custom endpoints, AI interaction, and business logic.
*   **Database & Auth:** Firebase (Firestore, Auth, Admin SDK).
*   **Authentication:** Custom integration combining Firebase Auth and WebAuthn for secure, passwordless access, specifically designed for public/shared educational environments.

## Development Setup

**Prerequisites:** Node.js (v20+), npm.

1.  **Install dependencies:**
    `npm ci`

2.  **Environment Variables:**
    Copy `.env.example` to `.env` or `.env.local` and populate necessary keys (e.g., `GEMINI_API_KEY`).

3.  **Start Development Server:**
    Run the dev script (see package.json).

## Testing

The application relies heavily on an end-to-end API behavioral testing suite.

1.  **Run Flows Tests:**
    `npm run test:flows`
    This suite acts as the primary behavior oracle for regressions.

2.  **Linting / Typechecking:**
    `npm run lint`

## Deployment

Deployments are managed via GitHub Actions (`.github/workflows/firebase-hosting-deploy.yml`). Pushing to `main` triggers an automated pipeline that strictly verifies linting, tests, and the production build (`npm run build`) before publishing to Firebase Hosting.

## Security

*   **Firebase Security Rules:** Firestore rules restrict data access based on authentication context and specific user roles (student vs. teacher).
*   **WebAuthn:** Critical workflows use hardware-backed WebAuthn credentials to prevent credential sharing and phishing.
*   **DOM Sanitization:** User-submitted content (like exam answers or uploaded files) must be strictly sanitized using DOMPurify before rendering to prevent XSS.
*   **Rate Limiting & Server Locks:** Sensitive endpoints (e.g., exam submission) utilize atomic locks to prevent race conditions or duplicate submissions.
