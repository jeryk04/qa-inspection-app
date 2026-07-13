# Contexto del Proyecto — QA Inspection App

## Qué es esto
App de control de calidad que digitaliza 4 tipos de inspección:
Incoming, Set-up, In-Process y Final Inspection. Reemplaza hojas de
inspección en papel/Excel. Las mediciones se capturan por número de
"balloon" (punto numerado en el drawing técnico de la pieza) y se
almacenan organizadas por cliente y número de pieza.

## Estado actual / prioridad
Estamos en **Fase 1 (MVP)**: solo **Final Inspection**. No implementar
Incoming/Set-up/In-Process todavía a menos que se pida explícitamente —
el modelo de datos ya las contempla (columna `tipo` en `inspecciones`)
pero el flujo de UI solo debe cubrir Final Inspection por ahora.

Ver `docs/PLAN.md` para el plan completo de fases y el detalle de alcance.

## Modelo de datos (ya definido en backend/src/schema.sql)
- `clientes` — clientes de la empresa
- `piezas` — piezas/partes, cada una asociada a un cliente
- `balloon_drawings` — imagen del drawing técnico de una pieza
- `balloon_puntos` — cada punto numerado del drawing, con su especificación/tolerancia
- `inspecciones` — una inspección realizada (tipo, pieza, fecha, inspector, estado)
- `mediciones` — el valor medido para cada punto de balloon en una inspección

## Convenciones de este repo
- Backend: Express, rutas REST bajo `/api/...`, un archivo de rutas por entidad en `backend/src/routes/`.
- Base de datos: SQLite vía `better-sqlite3`, queries síncronas (no hace falta async/await para la DB).
- Frontend: React + Vite, componentes funcionales con hooks, sin Redux (el estado es simple por ahora).
- Idioma: nombres de tablas/columnas en español (coincide con el vocabulario del negocio: "piezas", "clientes", "mediciones"). El código (variables JS, nombres de funciones) puede estar en inglés o español, seguir el estilo ya presente en el archivo que se edite.
- No agregar integración con MIE Trak Pro todavía — está planeada para Fase 3.

## Cómo correr el proyecto
```bash
# backend
cd backend && npm install && npm run dev   # http://localhost:3001

# frontend (otra terminal)
cd frontend && npm install && npm run dev  # http://localhost:5173
```

## Siguiente tarea sugerida
Ver el desglose de tareas del MVP en `docs/PLAN.md`, sección 7. Ir tarea
por tarea, probando cada una antes de pasar a la siguiente.
