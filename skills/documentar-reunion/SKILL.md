---
name: documentar-reunion
description: Graba una reunión, la transcribe y redacta un acta con acuerdos y tareas. Úsala cuando el usuario pida documentar, resumir o tomar acta de una reunión o llamada.
requires:
  bin: [ffmpeg]
---

# Documentar una reunión

Objetivo: convertir una reunión hablada en un acta útil, con acuerdos y tareas.

## Pasos

1. **Confirma el alcance** con el usuario antes de grabar: ¿solo su voz
   (micrófono) o también lo que se oye en el PC (los demás participantes, por
   loopback)? Para una reunión con otros, hace falta el audio del sistema.

2. **Avisa de que vas a escuchar** y de cuándo empieza y termina la captura. No
   grabes sin que el usuario lo sepa.

3. **Transcribe** el audio capturado. Ten en cuenta que la transcripción puede
   traer errores de nombres propios; no los inventes, déjalos como sonaron si no
   estás seguro.

4. **Redacta el acta** con esta estructura, en español y conciso:
   - **Asunto y fecha**.
   - **Participantes** (si se identifican).
   - **Puntos tratados**: los temas, en viñetas.
   - **Acuerdos**: decisiones tomadas.
   - **Tareas**: cada una con responsable y, si se dijo, fecha. Formato
     `[ ] Tarea — responsable — fecha`.

5. **No añadas nada que no se dijera.** Si algo quedó ambiguo, márcalo como
   "pendiente de confirmar" en vez de rellenarlo.

## Notas

- Si el usuario solo quiere un resumen rápido, ofrécele el acta corta (asunto +
  acuerdos + tareas) y pregunta si quiere el detalle.
- Guarda el acta donde el usuario indique; si no dice nada, muéstrasela y
  pregunta dónde guardarla.
