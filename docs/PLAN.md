Documento de Proyecto

**App de Control de Calidad --- Inspecciones Digitales**

*Versión 1.0 · Julio 2026*

**1. Resumen del Proyecto**

Actualmente el control de calidad se realiza mediante hojas de
inspección en Excel, almacenadas en carpetas organizadas por cliente y
número de pieza. Este proceso limita la trazabilidad, dificulta el
análisis de tendencias y depende de un manejo manual y disperso de la
información.

El objetivo es construir una aplicación digital que capture, almacene y
organice las inspecciones de calidad --- reemplazando el proceso en
papel/Excel --- de forma que toda la data quede centralizada, sea
consultable por cliente y número de pieza, y pueda usarse en el futuro
para análisis y control de tendencias.

**2. Tipos de Inspección Cubiertos**

  -----------------------------------------------------------------------
  **Tipo de Inspección**    **Descripción**
  ------------------------- ---------------------------------------------
  Incoming Inspection       Verificación de material o piezas recibidas
                            de proveedores.

  Set-up Inspection         Validación antes de iniciar una corrida de
                            producción.

  In-Process Inspection     Verificación durante el proceso de
                            producción.

  Final Inspection          Validación final antes de embarque al
                            cliente.
  -----------------------------------------------------------------------

**3. Objetivos y Criterios de Éxito**

-   Eliminar el uso de hojas de inspección en papel/Excel.

-   Centralizar toda la información de inspecciones por cliente y número
    de pieza.

-   Capturar mediciones basadas en Balloon Drawings (dibujos con puntos
    numerados y su especificación/tolerancia).

-   Generar automáticamente la hoja de inspección digital (reemplazo
    directo de la hoja física).

-   Dejar la base lista para análisis de tendencias y reportes en fases
    posteriores.

**4. Enfoque General**

El proyecto se construirá en fases incrementales, comenzando con un MVP
(Producto Mínimo Viable) enfocado en un solo tipo de inspección, para
validar el flujo completo antes de expandir a las demás.

**Fase 1 --- MVP: Final Inspection Digital**

**Dentro del alcance:**

-   Captura de medidas por número de balloon (formulario numerado).

-   Asociación de cada inspección a cliente + número de pieza.

-   Generación y almacenamiento de la hoja de inspección digital.

-   Acceso desde planta (tablet/móvil) y desde oficina (escritorio).

-   Historial de inspecciones consultable por cliente/pieza.

**Fuera de alcance (fases posteriores):**

-   Incoming, Set-up e In-Process Inspections.

-   Análisis de tendencias, reportes y dashboards.

-   Alertas automáticas de mediciones fuera de tolerancia.

-   Integración con MIE Trak Pro.

-   Acceso de clientes externos al sistema.

**Fase 2 --- Expansión de Inspecciones**

Agregar Incoming, Set-up e In-Process Inspections reutilizando la base
construida en la Fase 1 (mismo modelo de datos y flujo de captura).

**Fase 3 --- Análisis, Reportes e Integración**

-   Módulo de análisis de tendencias y control de calidad histórico.

-   Alertas de mediciones fuera de tolerancia.

-   Evaluar integración con MIE Trak Pro para sincronizar datos de
    clientes/piezas.

**5. Modelo de Datos Inicial**

  -----------------------------------------------------------------------
  **Entidad**           **Campos Clave**
  --------------------- -------------------------------------------------
  Clientes              id, nombre, información de contacto

  Piezas                id, cliente_id, número de parte, descripción

  Balloon Drawings      id, pieza_id, imagen, lista de puntos numerados
                        con su especificación/tolerancia

  Inspecciones          id, pieza_id, tipo, fecha, inspector, estado

  Mediciones            id, inspección_id, número de balloon, valor
                        medido, dentro de tolerancia (sí/no)
  -----------------------------------------------------------------------

**6. Stack Tecnológico Sugerido**

  -----------------------------------------------------------------------
  **Componente**         **Recomendación**
  ---------------------- ------------------------------------------------
  Frontend               React (o HTML/JS simple para arrancar más
                         ligero)

  Backend                Node.js + Express, o Python + FastAPI

  Base de datos          SQLite para desarrollo local → PostgreSQL en
                         producción

  Almacenamiento de      Local al inicio → almacenamiento en la nube (ej.
  imágenes               S3) más adelante

  Entorno de desarrollo  Visual Studio Code
  -----------------------------------------------------------------------

**7. Desglose de Tareas --- Fase 1 (MVP)**

1.  Setup inicial: proyecto en VS Code, estructura de carpetas, base de
    datos local.

2.  CRUD de Clientes y Piezas.

3.  Carga de Balloon Drawing: subir imagen y definir lista de puntos
    numerados con su especificación/tolerancia.

4.  Formulario de captura de inspección: selección de cliente → pieza →
    captura de valores medidos por número de balloon.

5.  Validación automática de tolerancia (indicador visual dentro/fuera
    de especificación).

6.  Generación de la hoja de inspección digital (vista y/o exportación a
    PDF).

7.  Historial y búsqueda de inspecciones por cliente, pieza y fecha.

8.  Pruebas con datos reales en paralelo al proceso actual, antes de
    retirar el papel/Excel.

**8. Notas y Consideraciones**

-   No hay fecha límite fija --- el desarrollo se hará de forma
    iterativa, probando y corrigiendo sobre la marcha.

-   Los datos actuales en Excel (organizados por cliente y número de
    pieza) sirven como referencia directa para el modelo de datos
    inicial.

-   La integración con MIE Trak Pro queda identificada como meta futura,
    no como bloqueante del MVP.
