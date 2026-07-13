# QA Inspection App

An application to digitize the quality control inspection process
(Incoming, Set-up, In-Process, Final), replacing paper/Excel inspection
sheets. Measurements are captured by "balloon" number (a numbered point
on the part's technical drawing) and stored by client and part number.

See `docs/PLAN.md` for the full project plan (phases, goals, data model,
MVP scope).

## Repo structure

```
qa-inspection-app/
├── backend/          # REST API (Node.js + Express + SQLite)
│   ├── src/
│   │   ├── index.js       # server entry point
│   │   ├── db.js          # database connection and setup
│   │   ├── schema.sql     # database schema
│   │   └── routes/        # endpoints per entity
│   └── uploads/           # uploaded balloon drawing images
├── frontend/          # Web app (React + Vite)
│   └── src/
└── docs/
    └── PLAN.md         # project plan (phases, scope, data model)
```

## MVP — Phase 1

Current scope: a fully digital **Final Inspection** (measurement capture
by balloon, client/part association, inspection sheet generation,
history). See `docs/PLAN.md` for the detail on future phases.

## Running the project locally

### Backend

```bash
cd backend
npm install
npm run dev
```

The server runs on `http://localhost:3001` by default. The first time it
starts, it automatically creates the SQLite database (`backend/data.db`)
using `src/schema.sql`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The app runs on `http://localhost:5173` by default and consumes the
backend API at `http://localhost:3001`.

## Stack

- **Backend:** Node.js, Express, SQLite (better-sqlite3), Multer (image uploads)
- **Frontend:** React + Vite
- **Database:** SQLite in development → can be migrated to PostgreSQL in production

## Working with Claude Code

This repo includes a `CLAUDE.md` file at the root with project context
so Claude Code picks it up automatically when working here. Just open
this folder in VS Code and run `claude` in the integrated terminal (or
use the Claude Code extension) to start working task by task through
the breakdown in `docs/PLAN.md`.
