# QA Inspection App

Aplicación para digitalizar el proceso de inspecciones de control de calidad
(Incoming, Set-up, In-Process, Final), reemplazando las hojas de inspección
en papel/Excel. Las mediciones se capturan por número de "balloon" (punto
numerado en el drawing de la pieza) y se almacenan por cliente y número de
pieza.

Ver `docs/PLAN.md` para el plan de proyecto completo (fases, objetivos,
modelo de datos, alcance del MVP).

## Estructura del repo

```
qa-inspection-app/
├── backend/          # API REST (Node.js + Express + SQLite)
│   ├── src/
│   │   ├── index.js       # entry point del servidor
│   │   ├── db.js          # conexión y setup de la base de datos
│   │   ├── schema.sql     # esquema de la base de datos
│   │   └── routes/        # endpoints por entidad
│   └── uploads/           # imágenes de balloon drawings subidas
├── frontend/          # App web (React + Vite)
│   └── src/
└── docs/
    └── PLAN.md         # plan de proyecto (fases, alcance, modelo de datos)
```

## MVP — Fase 1

Alcance actual: **Final Inspection** digital completa (captura de medidas
por balloon, asociación a cliente/pieza, generación de hoja de inspección,
historial). Ver `docs/PLAN.md` para detalle de fases futuras.

## Cómo correr el proyecto localmente

### Backend

```bash
cd backend
npm install
npm run dev
```

El servidor corre por defecto en `http://localhost:3001`. La primera vez
que arranca, crea automáticamente la base de datos SQLite (`backend/data.db`)
usando `src/schema.sql`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

La app corre por defecto en `http://localhost:5173` y consume la API del
backend en `http://localhost:3001`.

## Stack

- **Backend:** Node.js, Express, SQLite (better-sqlite3), Multer (subida de imágenes)
- **Frontend:** React + Vite
- **Base de datos:** SQLite en desarrollo → se puede migrar a PostgreSQL en producción

## Trabajando con Claude Code

Este repo incluye un archivo `CLAUDE.md` en la raíz con contexto del
proyecto para que Claude Code lo use automáticamente al trabajar aquí.
Simplemente abre esta carpeta en VS Code y corre `claude` en la terminal
integrada (o usa la extensión de Claude Code) para empezar a trabajar
tarea por tarea sobre el desglose en `docs/PLAN.md`.
