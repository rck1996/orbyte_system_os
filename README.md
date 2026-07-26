# ORBYTE_ Personal OS v4.3

ORBYTE_ es un sistema operativo personal local-first. El kernel conserva los hechos, calcula las finanzas, valida relaciones y ejecuta cambios; Ollama continúa siendo una capa opcional y exclusivamente conversacional.

## Cambios de v4.3 — Fresh Start

### Empezar desde cero

En **Ajustes → Empezar desde cero** se añadió una limpieza total de contenido para retirar los datos de demostración y construir un contexto personal real desde una base limpia.

La limpieza elimina:

- proyectos y acciones;
- hábitos y registros;
- eventos y notas;
- movimientos, recurrencias, cuotas, presupuestos y objetivos financieros;
- inventario y capturas;
- conversaciones, actividad, revisiones y lotes de deshacer.

Se conserva únicamente:

- nombre, idioma y moneda;
- configuración local de Ollama, incluido el modelo seleccionado;
- minutos de foco diarios;
- supuestos de proyección;
- las cuatro órbitas estructurales de ORBYTE_: Trabajo, Vida, Construir y Finanzas.

El presupuesto mensual se reinicia en `$0` para no contaminar las cifras nuevas.

### Confirmación protegida

- Antes de eliminar se muestra un resumen con la cantidad de registros afectados.
- Se puede exportar un respaldo JSON desde el mismo diálogo.
- El botón destructivo permanece bloqueado hasta escribir exactamente `BORRAR TODO`.
- La limpieza reemplaza el estado completo en una única escritura local.
- Después de borrar, Inicio y Conversar muestran una guía para registrar los primeros hechos reales.

### Diferencia con los datos de ejemplo

- **Restablecer datos de ejemplo** vuelve a cargar la demostración incluida en ORBYTE_.
- **Limpieza total** elimina la demostración y deja el contenido vacío.

## Capacidades conservadas de v4.2

- Centro de control financiero visual.
- Tarjeta financiera determinista dentro de Conversar.
- Separación entre hechos confirmados, compromisos y proyecciones.
- Enrutamiento estricto entre conversación, propuesta operativa y solicitud bloqueada.
- Ninguna orden operativa llega a Ollama.
- Propuestas estructuradas, editables antes y después de aplicar.
- Creación controlada de proyectos faltantes.
- Segmentos ambiguos corregibles o ignorables explícitamente.
- Validación previa, aplicación atómica y deshacer por operaciones inversas.
- Recurrencias, cuotas, proyecciones y hábitos flexibles.

## Probar la limpieza

Ejecuta:

```powershell
npm run dev
```

Abre la dirección indicada y entra en:

```text
Más → Ajustes → Empezar desde cero → Limpieza total
```

Puedes exportar un respaldo. Después escribe:

```text
BORRAR TODO
```

Al terminar deben quedar vacíos Proyectos, Acciones, Hábitos, Tiempo, Dinero y Registro. La configuración de Ollama debe conservarse y el presupuesto mensual debe quedar en `$0`.

## Validar

```powershell
npm run verify
```

La validación cubre la limpieza total, conservación de la configuración técnica, independencia de referencias, interfaz protegida, finanzas, recurrencias, cuotas, proyecciones, aplicación atómica, deshacer y hábitos flexibles.
