<p align="center">
  <img src="assets/orbyte.svg" width="104" alt="Logo de ORBYTE_">
</p>

<h1 align="center">ORBYTE_ Personal OS</h1>

<p align="center">
  Sistema operativo personal <strong>local-first</strong> para conectar proyectos, acciones, hábitos, tiempo, finanzas y contexto mediante un kernel determinista y una IA local opcional.
</p>

<p align="center">
  <strong>Versión 4.3 · Fresh Start</strong>
</p>

---

## Descripción

ORBYTE_ convierte información personal dispersa en un sistema conectado y auditable. La aplicación reúne planificación diaria, gestión de proyectos, seguimiento de hábitos, calendario, control financiero, inventario y conversación contextual en una sola interfaz.

La arquitectura separa claramente dos responsabilidades:

- El **kernel local** conserva los hechos, calcula prioridades, valida relaciones, genera proyecciones y ejecuta cambios.
- **Ollama** es una capa conversacional opcional que ayuda a explicar el contexto, pero nunca modifica los datos directamente.

No requiere cuenta, nube ni backend remoto. Los datos se guardan en el navegador del usuario y la integración de IA solo permite instancias locales de Ollama.

---

## Principios del sistema

- **Local-first:** los datos permanecen en el dispositivo.
- **Kernel determinista:** prioridades, finanzas, riesgos y validaciones no dependen de una respuesta generativa.
- **Confirmación antes de escribir:** una orden en lenguaje natural produce una propuesta editable, no un cambio inmediato.
- **Operaciones atómicas:** un lote se aplica completo o no se aplica.
- **Deshacer real:** cada lote genera operaciones inversas específicas.
- **Contexto conectado:** proyectos, tareas, eventos, hábitos, movimientos, notas e inventario comparten relaciones.
- **IA opcional:** ORBYTE_ sigue funcionando cuando Ollama está apagado o no está configurado.
- **Sin ejecución narrativa:** el modelo no puede afirmar que realizó una operación que el kernel no haya confirmado.

---

## Índice de funcionalidades

1. [Inicio y edición del día](#inicio-y-edición-del-día)
2. [Conversación y captura universal](#conversación-y-captura-universal)
3. [Enrutamiento y propuestas operativas](#enrutamiento-y-propuestas-operativas)
4. [Radar de decisiones](#radar-de-decisiones)
5. [Proyectos](#proyectos)
6. [Acciones](#acciones)
7. [Hábitos](#hábitos)
8. [Tiempo y eventos](#tiempo-y-eventos)
9. [Centro financiero](#centro-financiero)
10. [Mesa contextual por proyecto](#mesa-contextual-por-proyecto)
11. [Registro, auditoría e inventario](#registro-auditoría-e-inventario)
12. [Ollama e IA local](#ollama-e-ia-local)
13. [Ajustes, respaldo y limpieza total](#ajustes-respaldo-y-limpieza-total)
14. [Instalación](#instalación)
15. [Arquitectura](#arquitectura)
16. [Pruebas](#pruebas)

---

## Funcionalidades completas

### Inicio y edición del día

La pantalla **Inicio** presenta una edición diaria calculada por el kernel:

- Saludo y resumen contextual.
- Alertas críticas detectadas.
- Cantidad de acciones en foco.
- Proyectos que requieren revisión.
- Balance mensual confirmado.
- Próximo evento.
- Acciones vencidas.
- Porcentaje de presupuesto utilizado.
- Hábitos pendientes para el día.
- Las tres acciones con mayor impacto según el motor de prioridad.
- Duración estimada, fecha y contexto de cada acción.
- Botón para completar acciones directamente.
- Sugerencias proactivas con explicación de por qué aparecen.
- Conversación rápida desde la portada.
- Acceso directo al radar y al plan diario.

Cuando el espacio está vacío, Inicio muestra una guía para registrar los primeros datos reales, como ingreso mensual, primer proyecto o conversación libre.

### Plan diario y capacidad

El kernel construye un plan limitado por la capacidad configurada en minutos:

- Prioriza tareas vencidas.
- Considera fecha límite, prioridad y duración estimada.
- Evita llenar el día con más trabajo del que cabe en la capacidad disponible.
- Incluye hábitos programados y próximos eventos.
- Calcula backlog, minutos utilizados y minutos libres.
- Responde de forma determinista a preguntas como:

```text
¿Qué debería hacer primero hoy?
Planifica mi día
¿Qué tengo pendiente?
```

Las consultas directas sobre qué hacer primero usan el kernel y no necesitan Ollama.

---

### Conversación y captura universal

La pantalla **Conversar** funciona como terminal principal del sistema:

- Preguntas sobre el día, proyectos, finanzas, actividad y estado general.
- Órdenes en lenguaje natural para registrar información.
- Mensajes de varias líneas.
- Contexto por proyecto mediante encabezados o referencias naturales.
- Historial conversacional local.
- Preguntas sugeridas.
- Panel lateral con foco actual, señales y resumen contextual.
- Indicador de kernel local u Ollama activo.
- Diagnóstico cuando una respuesta de Ollama falla.
- Información de modelo, latencia, endpoint y modo de compatibilidad.
- Recuperación segura de solicitudes interrumpidas al recargar la aplicación.
- Conservación de posición y borrador del chat durante los renderizados.
- Botón para volver al mensaje más reciente cuando el usuario revisa mensajes anteriores.

La barra superior también incluye **+ Capturar**, que abre una captura universal para escribir una orden o hecho de forma natural desde cualquier sección.

#### Comportamiento del compositor

- `Enter`: envía el mensaje.
- `Shift + Enter`: crea una nueva línea.
- Compatible con composición IME sin envíos accidentales.
- Altura automática limitada para no desplazar toda la interfaz.
- `Ctrl + K` o `Cmd + K`: abre Conversar y enfoca el compositor.

---

### Enrutamiento y propuestas operativas

ORBYTE_ separa cada mensaje en uno de estos flujos:

1. **Conversación:** pregunta o análisis sin modificación de datos.
2. **Propuesta operativa:** solicitud interpretable que requiere confirmación.
3. **Solicitud bloqueada:** intención de modificar datos que no pudo convertirse en operaciones seguras.
4. **Navegación:** órdenes como `abre finanzas` o `mostrar hábitos`.
5. **Ayuda:** explicación de capacidades y comandos.

#### Enrutamiento estricto

- Las preguntas no se convierten silenciosamente en tareas.
- Las órdenes operativas nunca se envían a Ollama.
- El endpoint del servidor también bloquea operaciones aunque se invoque directamente.
- Una frase ambigua no se ejecuta ni se narra como realizada.
- Las consultas diarias no reciben contexto financiero innecesario.
- Las consultas financieras reciben únicamente contexto financiero compacto.

#### Propuestas estructuradas

Cada orden válida produce una propuesta que puede contener:

- Título y resumen.
- Operaciones individuales.
- Secciones agrupadas por proyecto.
- Evidencia usada para interpretar el mensaje.
- Suposiciones explícitas.
- Advertencias.
- Segmentos ambiguos.
- Validación y bloqueos.
- Proyectos nuevos relacionados.
- Totales de compras, ingresos o gastos.

Antes de confirmar, el usuario puede:

- Editar cada operación.
- Habilitar o deshabilitar cambios individuales.
- Cambiar títulos, fechas, montos, prioridades, categorías, proyectos y órbitas.
- Ajustar frecuencias y mediciones de hábitos.
- Autorizar la creación de un proyecto inferido.
- Corregir un segmento ambiguo y reinterpretarlo.
- Ignorar explícitamente una línea que no debe ejecutarse.
- Descartar toda la propuesta.

#### Validaciones operativas

ORBYTE_ bloquea la confirmación cuando falta información obligatoria, por ejemplo:

- Proyecto sin nombre.
- Tarea sin título.
- Nota sin contenido.
- Evento sin título o fecha.
- Movimiento sin concepto, monto, tipo o fecha.
- Recurrencia sin concepto, monto, frecuencia o inicio.
- Hábito sin nombre o frecuencia válida.
- Plan de cuotas sin total, número de cuotas o primera fecha.
- Objetivo financiero sin nombre, monto o fecha objetivo.
- Objeto de inventario sin nombre o cantidad válida.
- Referencia a un proyecto u órbita inexistente.
- Identificadores duplicados.
- Segmentos ambiguos sin resolver.
- Creación implícita de proyecto sin autorización.

#### Aplicación atómica

Cuando una propuesta se confirma:

1. Se clona el estado actual.
2. Se aplican todas las operaciones sobre la copia.
3. Se validan las referencias entre proyectos, órbitas y elementos.
4. Solo si todo es válido se reemplazan las colecciones afectadas.
5. Si una operación falla, no queda ningún cambio parcial.

#### Edición antes y después de aplicar

- Una propuesta puede editarse antes de confirmar.
- Después de aplicarla, sus elementos reales también pueden modificarse desde la propuesta original.
- ORBYTE_ reconcilia lo aplicado con la nueva versión.
- Es posible habilitar, deshabilitar o corregir operaciones ya aplicadas.
- Los cambios ajenos realizados después no se sobrescriben innecesariamente.

#### Deshacer

- Cada aplicación genera operaciones inversas.
- El usuario puede deshacer el lote original.
- Una edición posterior genera su propio lote de deshacer.
- Deshacer una edición restaura la versión anterior sin eliminar el elemento original.
- El registro conserva hasta 30 lotes recientes disponibles para reversión.

---

### Operaciones entendidas en lenguaje natural

ORBYTE_ puede preparar propuestas para:

#### Proyectos

- Crear uno o varios proyectos.
- Separar nombre y objetivo desde una frase natural.
- Relacionar elementos con un proyecto existente.
- Crear un proyecto faltante dentro del mismo lote cuando la creación es explícita.
- Bloquear la creación cuando el proyecto solo fue inferido desde una referencia.
- Evitar duplicar proyectos existentes.
- Asignar una órbita explícita o inferida.

```text
Crea un proyecto llamado Estudio Musical en Construir
Crea los proyectos PixelPy y Portafolio
```

#### Tareas y acciones

- Crear tareas.
- Limpiar expresiones como “crea una tarea llamada”.
- Detectar prioridad.
- Detectar fecha relativa o explícita.
- Detectar duración estimada.
- Vincular con proyecto y órbita.
- Completar una tarea existente por coincidencia contextual.

```text
Crea una tarea llamada Revisar presupuesto para mañana, urgente, 40 minutos
Marca como completada la tarea Cotizar interfaz
```

#### Notas

- Guardar hechos, ideas y recordatorios.
- Extraer un título útil.
- Eliminar el mandato conversacional del contenido guardado.
- Inferir etiquetas.
- Vincular la nota a un proyecto u órbita.

```text
Para ORBYTE_: anota que el kernel siempre debe mantener los cálculos fuera de la IA
```

#### Eventos

- Crear reuniones, citas, llamadas y eventos.
- Extraer fecha y hora del texto.
- Limpiar fecha, hora y palabras operativas del título.
- Bloquear eventos sin fecha hasta que se corrijan.
- Vincular con proyecto y órbita.

```text
Agenda reunión de revisión mañana a las 18:00 para ORBYTE_
```

#### Hábitos

- Crear hábitos con frecuencia y medición.
- Reconocer días específicos.
- Reconocer objetivos por semana o por mes.
- Reconocer intervalos como “cada 14 días”.
- Crear hábitos flexibles sin inventar días.
- Detectar objetivos cuantitativos.

```text
Quiero nadar martes y jueves
Leer 4 veces por semana
Caminar 30 minutos todos los días
Cambiar sábanas cada 14 días
```

#### Ingresos y gastos

- Registrar movimientos confirmados.
- Distinguir ingresos y gastos.
- Limpiar el concepto guardado.
- Inferir categorías.
- Detectar fecha.
- Vincular con proyecto u órbita.
- Interpretar ventas, sueldo, honorarios, pagos, cobros y reembolsos.

```text
Vendí el monitor por 80000
Pagué hosting por 20000 para ORBYTE_
```

#### Recurrencias

- Crear ingresos o gastos recurrentes.
- Reconocer frecuencia semanal, quincenal, mensual, bimestral, trimestral, anual o cada X meses.
- Reconocer último día del mes.
- Reconocer último día hábil.
- Diferenciar gastos fijos y suscripciones.

```text
Pago Netflix 8990 todos los meses
Recibo mi sueldo de 2200000 el último día hábil de cada mes
```

#### Compras conectadas

Una compra puede crear varias entidades relacionadas:

- Movimiento financiero confirmado.
- Objeto de inventario cuando corresponde.
- Cantidad y valor unitario.
- Categoría inferida.
- Vínculo con proyecto y órbita.

Los consumibles pueden registrarse solo como gasto para no ensuciar el inventario.

```text
Compré una interfaz de audio por 120000 para Estudio Musical
Compré 2 memorias RAM por 160000 en total para Servidor
```

#### Compras en cuotas

- Crea el plan de cuotas.
- Calcula el monto aproximado por cuota.
- Registra la primera cuota confirmada.
- Crea inventario conectado cuando corresponde.
- Proyecta las cuotas futuras sin duplicarlas.

```text
Compré un SSD de 120000 en 3 cuotas para ORBYTE_
```

#### Compras futuras

Cuando la compra es futura y tiene fecha objetivo, ORBYTE_ puede crear:

- Objetivo financiero.
- Movimiento planificado.
- Proyección del compromiso.
- Tarea de cotización siete días antes.

```text
Para septiembre quiero comprar un SSD de 120000 para ORBYTE_
```

#### Mensajes compuestos

Un solo mensaje puede operar sobre varios proyectos y tipos de datos:

```text
Para PixelPy:
- Crea la tarea revisar el editor mañana
- Anota que falta mejorar el autocompletado

Para ORBYTE_:
- Compra un SSD de 120000 en 3 cuotas
- Agenda revisión el viernes a las 19:00
```

Todo el lote se revisa y confirma como una unidad atómica.

---

### Radar de decisiones

La pantalla **Radar** clasifica proyectos según su estado operativo:

- **Actuar ahora:** riesgo alto, vencimientos o falta de siguiente acción.
- **Observar:** señales que conviene revisar antes de perder movimiento.
- **En movimiento:** proyecto con acciones claras y actividad reciente.
- **En calma:** sin señales urgentes.

Cada tarjeta muestra:

- Órbita.
- Riesgo sobre 100.
- Progreso.
- Acciones abiertas.
- Acciones vencidas.
- Próxima acción.
- Barra de riesgo relativa.
- Acceso a la mesa contextual.
- Consulta directa a ORBYTE_AI.

El resumen superior incluye señal dominante, capacidad inmediata, uso de presupuesto y próximo evento.

---

### Proyectos

La sección **Proyectos** ofrece:

- Vista de todos los proyectos activos.
- Objetivo del proyecto.
- Órbita relacionada.
- Estado de salud.
- Riesgo calculado.
- Progreso derivado de las tareas.
- Cantidad de acciones abiertas y vencidas.
- Próxima acción sugerida.
- Fecha objetivo.
- Presupuesto del proyecto.
- Acceso a la mesa contextual.
- Creación desde lenguaje natural.
- Eliminación con desvinculación segura de tareas, hábitos, eventos, notas, movimientos e inventario.

El estado de salud no es decorativo: se deriva de tareas, vencimientos, actividad, progreso y presencia de una próxima acción.

---

### Acciones

La sección **Acciones** incluye:

- Lista de tareas abiertas y completadas.
- Orden por estado y fecha.
- Identificación de vencidas.
- Prioridad alta, media o baja.
- Fecha límite.
- Duración estimada.
- Proyecto u órbita relacionada.
- Resumen de backlog.
- Minutos incluidos en el plan diario.
- Completar o reabrir una tarea.
- Eliminar tareas.
- Crear nuevas acciones desde la terminal.

---

### Hábitos

La sección **Hábitos** utiliza un motor de oportunidades reales en lugar de exigir cumplimiento diario indiscriminado.

#### Frecuencias disponibles

- Todos los días.
- Días específicos de la semana.
- X veces por semana.
- X veces por mes.
- Cada X días.
- Fines de semana.
- Sin frecuencia fija.
- Fecha de inicio.
- Fecha de término opcional.
- Pausa indefinida.
- Pausa hasta una fecha determinada.

#### Tipos de medición

- Completado / no completado.
- Minutos.
- Cantidad.
- Repeticiones.
- Distancia.
- Volumen.
- Páginas.
- Objetivo y unidad personalizados.

#### Seguimiento

- Vista semanal navegable.
- Registro por día.
- Registro numérico para hábitos cuantitativos.
- Cumplimiento semanal.
- Adherencia de las últimas cuatro semanas.
- Racha por oportunidades, semanas o meses según la frecuencia.
- Próxima oportunidad disponible.
- Pausar y reanudar.
- Omitir una oportunidad con justificación.
- Los días no programados no se consideran fallos.
- Las omisiones justificadas se retiran del denominador de adherencia.
- Un hábito flexible puede registrarse sin aparecer como pendiente todos los días.
- Vinculación con proyecto y órbita.

---

### Tiempo y eventos

La sección **Tiempo** muestra una línea temporal de eventos:

- Fecha.
- Hora.
- Título.
- Proyecto u órbita relacionada.
- Orden cronológico.
- Creación desde lenguaje natural.
- Integración con el plan diario y el radar.

Los eventos sin fecha quedan bloqueados en la propuesta hasta que el usuario asigne una fecha concreta.

---

## Centro financiero

La sección **Dinero** es un centro de control visual calculado por `core/finance.js`. Ollama no reemplaza ni recalcula los valores del panel.

### Navegación mensual

- Mes anterior.
- Mes actual.
- Mes siguiente.
- Consulta breve a ORBYTE_AI.
- Creación rápida de recurrentes.

### Pestaña Resumen

#### Hechos confirmados

- Ingresos recibidos.
- Gastos pagados.
- Resultado confirmado del mes.
- Explicación explícita de que el resultado mensual no es necesariamente el saldo bancario.

#### Cierre proyectado

- Ingresos pendientes.
- Compromisos pendientes.
- Gasto variable estimado.
- Resultado proyectado al terminar el mes.
- Diferencia respecto del resultado confirmado.

#### Indicadores rápidos

- Compromiso neto restante.
- Porcentaje de presupuesto consumido.
- Presupuesto todavía disponible.
- Gasto variable estimado.
- Número de movimientos confirmados.
- Cantidad de ingresos y gastos.

#### Movimientos y compromisos

- Últimos movimientos confirmados.
- Próximos compromisos.
- Cuotas, recurrentes y compras planificadas.
- Listas plegables cuando existen muchos registros.
- Confirmación de recurrentes como pagados o recibidos.
- Confirmación de cuotas individuales.
- Omisión justificada de una ocurrencia recurrente.

#### Categorías y presupuestos

- Gasto por categoría.
- Porcentaje de participación de cada categoría.
- Barras comparativas.
- Presupuesto global mensual.
- Presupuestos por categoría.
- Presupuestos por proyecto.
- Presupuestos permanentes o de un solo mes.
- Modo flexible o estricto.
- Monto consumido, porcentaje usado y restante.

### Pestaña Recurrentes

- Ingresos y gastos recurrentes.
- Gastos fijos y suscripciones.
- Frecuencia semanal.
- Frecuencia quincenal.
- Frecuencia mensual.
- Cada dos meses.
- Cada tres meses.
- Cada X meses.
- Frecuencia anual.
- Día específico del mes.
- Día de la semana.
- Último día del mes.
- Último día hábil.
- Fecha de inicio y término.
- Próxima ocurrencia calculada.
- Pausar, activar, editar o eliminar una regla.
- Los movimientos ya confirmados se conservan al eliminar la regla.
- Detección de posibles recurrentes después de aparecer en tres meses distintos.
- Conversión manual de un candidato detectado en una regla real.

Las reglas recurrentes generan compromisos proyectados. Solo se convierten en movimientos confirmados cuando el usuario los marca como pagados o recibidos.

### Pestaña Proyección

- Proyección configurable entre 1 y 24 meses.
- Ingresos confirmados y proyectados.
- Compromisos fijos.
- Cuotas.
- Objetivos financieros.
- Compras planificadas.
- Gasto variable estimado.
- Resultado proyectado por mes.
- Separación explícita entre compromisos conocidos y supuestos.
- Promedio variable configurable entre 1 y 12 meses históricos.
- Prevención de doble conteo entre objetivos y movimientos planificados.

### Cuotas

- Registro manual de una compra en cuotas.
- Total de la compra.
- Cantidad de cuotas.
- Valor calculado por cuota.
- Fecha de primera cuota.
- Categoría y proyecto.
- Confirmación individual de cada cuota.
- Eliminación del plan sin borrar pagos ya confirmados.

### Objetivos financieros

- Nombre.
- Monto.
- Fecha objetivo.
- Categoría.
- Proyecto u órbita.
- Estado planificado o completado.
- Cierre de objetivo con retiro de la proyección asociada.
- La compra real se registra por separado para mantener los hechos auditables.

### Pestaña Cierre mensual

- Ingresos reales.
- Gastos reales.
- Resultado mensual.
- Tasa de ahorro.
- Categoría principal.
- Variación frente al mes anterior.
- Compromisos del mes siguiente.
- Insights deterministas.
- Guardado del cierre para consulta posterior.

### Tarjeta financiera en Conversar

Al preguntar por las finanzas, la conversación muestra primero una tarjeta calculada por el kernel:

- Resultado confirmado.
- Cierre proyectado.
- Compromisos.
- Uso de presupuesto.
- Categorías principales.
- Próximos compromisos.
- Movimientos recientes.

La lectura generada por Ollama aparece como complemento plegable y no puede sustituir los números oficiales.

---

### Mesa contextual por proyecto

La pantalla **Mesa** reúne toda la información de un proyecto:

- Salud y riesgo.
- Progreso.
- Próxima acción.
- Fecha objetivo.
- Presupuesto.
- Gasto confirmado relacionado.
- Tareas abiertas y completadas.
- Notas.
- Eventos.
- Ingresos y gastos.
- Selector para cambiar de proyecto.
- Acciones rápidas para crear tareas y notas.
- Consulta contextual a ORBYTE_AI.

---

### Registro, auditoría e inventario

La sección **Registro** mantiene una huella legible de los cambios:

- Último lote atómico.
- Botón para deshacer el último lote.
- Actividad reciente con fecha y hora.
- Mensajes de creación, actualización, eliminación, importación y deshacer.
- Hasta 150 entradas de actividad reciente.
- Inventario conectado generado por compras relevantes.
- Cantidad, valor unitario y valor total.
- Categoría y fecha de compra.
- Proyecto u órbita relacionada.
- Revisiones mensuales guardadas.
- Historial de ingresos, gastos y resultado de cada cierre.

---

## Ollama e IA local

Ollama es opcional. El modo **Solo kernel local** conserva todas las funciones deterministas sin IA generativa.

### Funciones de integración

- URL local configurable.
- Solo acepta `localhost`, `127.0.0.1` o loopback IPv6.
- Detección automática de modelos instalados.
- Lectura de familia, tamaño, cuantización y capacidades.
- Rechazo de modelos que no generan texto, como modelos solo de embeddings.
- Prueba real de inferencia desde Ajustes.
- Precarga del modelo seleccionado.
- Compatibilidad con `/api/chat` y fallback a `/api/generate`.
- Adaptación para modelos con razonamiento interno.
- Política especial para familias conocidas como Qwen 3, GPT-OSS y DeepSeek de razonamiento.
- Reintentos cuando un modelo devuelve solo razonamiento y no una respuesta final.
- Contexto selectivo según intención.
- Historial conversacional breve para evitar sobrecargar el prompt.
- Temperatura baja y límites de salida orientados a respuestas concretas.
- Tiempo de espera de inferencia de hasta 180 segundos.
- `keep_alive` para mantener el modelo cargado entre consultas.

### Contexto por intención

ORBYTE_ no envía todo el estado al modelo. Construye un contexto mínimo según la consulta:

- **Finanzas:** totales, categorías, movimientos recientes y próximos compromisos.
- **Proyecto:** proyecto, salud, tareas, notas, eventos y movimientos relacionados.
- **Día:** plan, vencidas y proyectos riesgosos, sin bloque financiero.
- **Actividad:** cambios recientes.
- **General:** foco, proyectos, vencidas, próximos eventos y hábitos pendientes.

### Filtros de respuesta

Si Ollama incumple las reglas, ORBYTE_ muestra la respuesta verificada del kernel:

- Respuesta vacía.
- Respuesta demasiado extensa.
- Informe financiero largo dentro del chat.
- Tablas o encabezados no solicitados.
- Plantilla genérica en inglés.
- Desvío hacia finanzas en una consulta diaria.
- Respuesta predominantemente en inglés.
- Datos o importes no compatibles con el contexto enviado.

### Reglas financieras para la IA

En consultas financieras, Ollama recibe instrucciones para:

- Escribir solo dos o tres observaciones breves.
- No crear una segunda tabla o informe.
- No recalcular cifras.
- No introducir importes ausentes.
- No llamar “saldo bancario” al resultado mensual.
- No reemplazar la tarjeta calculada por el kernel.

---

## Ajustes, respaldo y limpieza total

### Ajustes del asistente

- Modo solo kernel o kernel + Ollama.
- URL local de Ollama.
- Modelo instalado.
- Actualización de modelos disponibles.
- Prueba de conexión e inferencia.
- Visualización de tamaño, cuantización y capacidades.

### Ajustes del kernel

- Nombre del usuario.
- Idioma y moneda conservados en el perfil.
- Minutos de foco diarios.
- Presupuesto mensual.
- Meses de proyección financiera.
- Ventana histórica para promedio de gasto variable.

### Portabilidad de datos

- Exportación completa a JSON.
- Importación de una copia JSON.
- Normalización de datos importados.
- Validación de las cuatro órbitas.
- Sin cuenta ni servicio remoto.

### Datos de ejemplo

**Restablecer datos de ejemplo** reemplaza el contenido actual por la demostración incluida en ORBYTE_.

La demostración contiene proyectos, tareas, hábitos, eventos, notas, movimientos, recurrentes y presupuestos para explorar la aplicación.

### Limpieza total

**Más → Ajustes → Empezar desde cero → Limpieza total** elimina todo el contenido personal para construir un contexto nuevo.

Se eliminan:

- Proyectos.
- Acciones.
- Hábitos, registros y omisiones.
- Eventos.
- Notas.
- Ingresos y gastos.
- Recurrentes.
- Cuotas.
- Presupuestos.
- Objetivos financieros.
- Revisiones mensuales.
- Inventario.
- Capturas.
- Conversaciones.
- Actividad.
- Lotes de deshacer.

Se conservan:

- Nombre.
- Idioma.
- Moneda.
- Configuración local de Ollama.
- Modelo seleccionado.
- Minutos de foco.
- Supuestos financieros.
- Las cuatro órbitas base.

El presupuesto mensual se reinicia en `$0`.

#### Protección de la limpieza

- Muestra el número de registros que serán eliminados.
- Permite exportar un respaldo antes de continuar.
- Exige escribir exactamente `BORRAR TODO`.
- El botón permanece deshabilitado hasta confirmar la frase.
- La sustitución del estado se realiza en una sola escritura local.
- La operación no puede deshacerse dentro de ORBYTE_.

---

## Órbitas

ORBYTE_ organiza el contexto en cuatro órbitas estructurales:

| Órbita | Código | Alcance |
|---|---|---|
| Trabajo | `WORK` | Carrera, aprendizaje y proyectos profesionales |
| Vida | `LIFE` | Salud, hogar, relaciones y experiencias |
| Construir | `BUILD` | Productos, ideas y sistemas personales |
| Finanzas | `MONEY` | Presupuesto, compromisos y decisiones financieras |

Los proyectos y elementos pueden vincularse a una órbita incluso cuando no pertenecen a un proyecto específico.

---

## Privacidad y almacenamiento

- Los datos se guardan en `localStorage` bajo la clave `orbyte.personal-os.v2`.
- No existe sincronización con la nube.
- No se crea una cuenta.
- No hay telemetría incluida.
- No se envían datos a servicios externos desde el kernel.
- Ollama solo puede configurarse en una dirección de loopback local.
- El servidor limita el tamaño de las solicitudes JSON.
- Las respuestas y propuestas quedan en el historial local.
- Exportar un respaldo genera un archivo JSON legible por el usuario.

> ORBYTE_ no cifra el contenido almacenado por el navegador. La seguridad física del equipo y del perfil del navegador sigue siendo responsabilidad del usuario.

---

## Diseño e interfaz

- Estética editorial-terminal.
- Navegación por hash, sin framework.
- Diseño responsive para escritorio, tablet y móvil.
- Menú secundario controlado desde **Más**.
- Diálogos nativos para edición y confirmación.
- Regiones `aria-live` para estados del asistente.
- Etiquetas accesibles en controles relevantes.
- Respeto por `prefers-reduced-motion`.
- Estado visual de kernel local u Ollama.
- Formularios adaptativos para hábitos y propuestas.
- Vistas financieras optimizadas para lectura visual en vez de mensajes extensos.

---

## Instalación

### Requisitos

- Node.js 20 o superior recomendado.
- Navegador moderno con soporte para módulos ES, `localStorage` y `structuredClone`.
- Ollama solo si se desea activar la capa generativa local.

### Clonar y ejecutar

```bash
git clone https://github.com/<usuario>/<repositorio>.git
cd <repositorio>
npm run verify
npm run dev
```

No hay dependencias npm de runtime, por lo que no es necesario instalar paquetes antes de ejecutar los scripts incluidos.

El servidor inicia normalmente en:

```text
http://127.0.0.1:4173
```

Si el puerto está ocupado, prueba automáticamente el siguiente puerto disponible.

### Variables opcionales

```bash
PORT=4173 HOST=127.0.0.1 npm run dev
```

En PowerShell:

```powershell
$env:PORT = "4173"
$env:HOST = "127.0.0.1"
npm run dev
```

No abras `index.html` directamente: la aplicación utiliza un servidor local para la integración con Ollama y sus endpoints internos.

---

## Configurar Ollama

1. Instala y ejecuta Ollama en el equipo.
2. Descarga un modelo de conversación local. Por ejemplo:

```bash
ollama pull qwen3:8b
```

3. Inicia ORBYTE_.
4. Abre **Más → Ajustes**.
5. Selecciona **Kernel + Ollama**.
6. Mantén la URL local predeterminada:

```text
http://127.0.0.1:11434
```

7. Pulsa **Actualizar modelos**.
8. Selecciona un modelo compatible.
9. Pulsa **Probar modelo**.
10. Guarda los ajustes.

ORBYTE_ puede trabajar con distintos modelos de generación de texto instalados en Ollama. La detección de compatibilidad se realiza en tiempo de ejecución.

---

## Primeros pasos

Después de una limpieza total, conviene registrar los hechos base en este orden:

```text
Mi ingreso mensual es de 2200000 y lo recibo el último día hábil de cada mes
```

```text
Pago dividendo de 630000 todos los meses
```

```text
Crea un proyecto llamado Mi primer proyecto en Construir
```

```text
Para Mi primer proyecto crea una tarea llamada Definir el siguiente paso para mañana
```

```text
Quiero caminar 30 minutos lunes, miércoles y viernes
```

Luego se pueden realizar consultas como:

```text
¿Qué debería hacer primero hoy?
¿Cómo van mis proyectos?
¿Qué necesita atención?
¿Cómo van mis finanzas?
```

---

## Scripts disponibles

```bash
npm run dev
```

Inicia el servidor local y sirve la aplicación.

```bash
npm test
```

Ejecuta toda la suite de pruebas con `node:test`.

```bash
npm run verify
```

Comprueba:

- Sintaxis de todos los archivos JavaScript y MJS.
- Presencia de módulos esenciales.
- Suite completa de pruebas.
- Invariantes del kernel, asistente, operaciones, interfaz y almacenamiento.

---

## Arquitectura

```text
ORBYTE_
├── index.html
├── app/
│   └── main.js                 # Interfaz, navegación y controladores
├── core/
│   ├── state.js                # Estado reactivo y persistencia
│   ├── kernel.js               # Prioridad, salud, señales y brief diario
│   ├── finance.js              # Ledger, recurrencias, cuotas y proyecciones
│   ├── habits.js               # Frecuencias, adherencia y rachas
│   └── relations.js            # Inferencia de órbitas, proyectos y categorías
├── modules/
│   └── assistant/
│       ├── engine.js           # Interpretación y planificación operativa
│       ├── operations.js       # Validación, atomicidad, edición y deshacer
│       └── gateway.js          # Enrutamiento conversacional y filtros de IA
├── server/
│   └── ollama.js               # Descubrimiento, prueba e inferencia local
├── storage/
│   └── store.js                # Esquema, demo, importación y Fresh Start
├── shared/
│   ├── styles.css              # Sistema visual responsive
│   ├── ui.js                   # Utilidades de interacción y scroll
│   └── utils.js                # Formato y nombres relacionados
├── tests/                       # Suite de pruebas del sistema
├── scripts/
│   └── verify.mjs              # Verificación integral
├── server.mjs                  # Servidor HTTP y endpoints internos
├── manifest.webmanifest
├── sw.js
└── assets/
    └── orbyte.svg
```

### Flujo de una pregunta

```text
Mensaje
  ↓
Interpretador local
  ↓
Clasificación como consulta
  ↓
Respuesta determinista del kernel
  ↓
Contexto selectivo opcional
  ↓
Ollama local
  ↓
Filtro de respuesta
  ↓
Respuesta de Ollama o fallback del kernel
```

### Flujo de una modificación

```text
Orden en lenguaje natural
  ↓
Enrutador operativo
  ↓
Planificador de operaciones
  ↓
Propuesta estructurada
  ↓
Edición y validación
  ↓
Confirmación explícita
  ↓
Aplicación sobre copia del estado
  ↓
Validación referencial
  ↓
Commit atómico
  ↓
Registro + operaciones inversas para deshacer
```

---

## Modelo de datos

El estado principal utiliza la versión de esquema `5` y contiene:

- `profile`
- `orbits`
- `projects`
- `tasks`
- `habits`
- `events`
- `notes`
- `transactions`
- `recurringTransactions`
- `installmentPlans`
- `budgets`
- `skippedOccurrences`
- `financialGoals`
- `monthReviews`
- `undoBatches`
- `assets`
- `captures`
- `activity`
- `assistantLog`
- `settings`
- `financeSettings`

La normalización de almacenamiento mantiene compatibilidad con datos anteriores, completa valores predeterminados y evita colecciones inválidas.

---

## Servidor local

`server.mjs` cumple dos funciones:

- Servir los archivos estáticos de la aplicación.
- Actuar como puente local hacia Ollama.

Endpoints internos:

```text
POST /api/ai/status
POST /api/ai/chat
```

Protecciones incluidas:

- Solo métodos permitidos.
- Respuestas JSON sin caché.
- Límite de tamaño para solicitudes.
- Validación de URL local.
- Validación de modelo instalado.
- Rechazo de operaciones en el endpoint generativo.
- Fallback de rutas de la aplicación hacia `index.html`.

---

## Pruebas

La versión 4.3 incluye **101 pruebas automatizadas** y actualmente valida:

- Interpretación de proyectos, tareas, notas, eventos y hábitos.
- Mensajes compuestos y varios proyectos en un lote.
- Compras, cantidades, inventario y consumibles.
- Ingresos, gastos y conceptos semánticos.
- Recurrencias, último día hábil y reglas semanales.
- Cuotas y compras planificadas.
- Proyecciones sin doble conteo.
- Hábitos diarios, semanales, mensuales, flexibles e intervalos.
- Mediciones cuantitativas.
- Salud de proyectos y capacidad diaria.
- Anomalías financieras.
- Enrutamiento estricto.
- Bloqueo de operaciones antes de Ollama.
- Creación controlada de proyectos.
- Segmentos ambiguos.
- Aplicación atómica sin cambios parciales.
- Operaciones inversas y deshacer.
- Edición posterior de propuestas aplicadas.
- Contexto selectivo para Ollama.
- Filtros de idioma y desviación.
- Compatibilidad de modelos y endpoints Ollama.
- Comportamiento del compositor y scroll del chat.
- Vista financiera visual.
- Limpieza total y conservación de ajustes.

Resultado esperado:

```text
# tests 101
# pass 101
# fail 0
Verified 30 files, kernel modules and assistant invariants.
```

---

## Límites actuales

- Los datos pertenecen a un solo perfil de navegador.
- No existe sincronización entre dispositivos.
- No hay autenticación ni multiusuario.
- No hay conexión bancaria automática.
- Los movimientos deben registrarse o confirmarse dentro de ORBYTE_.
- El resultado confirmado del mes es ingresos menos gastos registrados; no representa necesariamente el saldo disponible de una cuenta bancaria.
- Las proyecciones son estimaciones y separan explícitamente hechos, compromisos y gasto variable supuesto.
- La calidad de la lectura conversacional depende del modelo local seleccionado, pero los cálculos y modificaciones no dependen de él.
- El almacenamiento del navegador no está cifrado por la aplicación.

---

## Estado del proyecto

ORBYTE_ Personal OS v4.3 incluye:

- Kernel contextual determinista.
- Gestión conectada de proyectos, tareas, hábitos, tiempo y dinero.
- Centro financiero visual.
- Conversación local opcional con Ollama.
- Enrutamiento operativo seguro.
- Propuestas editables.
- Aplicación atómica.
- Edición posterior.
- Deshacer por operaciones inversas.
- Portabilidad JSON.
- Limpieza total para comenzar desde cero.

