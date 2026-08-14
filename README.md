# A.L.P.H.A.

**A**sistente **L**ocal **P**roactivo **H**íbrido **A**bierto.

Asistente de escritorio con avatar flotante que escucha, habla y ve la pantalla.
En el espíritu del viejo Clippy, pero con un cerebro de verdad y sin ceder la
privacidad: la captura, el VAD y la transcripción corren en la máquina; la nube
es un acelerador opcional que el **modo confidencial** apaga por completo.

Todo Node/TypeScript, sin Python. Se desarrolla en **Windows**; en **Linux**
funciona la conversación, pero no todo (ver la tabla).

## Estado

MVP conversacional **funcionando de punta a punta**: hablas o escribes al avatar,
A.L.P.H.A. piensa (con herramientas y skills) y responde con voz. Falta la visión.

| Capa | Windows | Linux |
|---|---|---|
| Captura de micrófono (ffmpeg) | ✅ dshow | ✅ pulse |
| Captura del audio del sistema | ✅ WASAPI loopback | ⬜ falta PipeWire/PulseAudio |
| VAD por energía | ✅ | ✅ |
| STT (whisper.cpp) | ✅ | ✅ |
| Cerebro LLM (compatible-OpenAI: Ollama + nube) | ✅ | ✅ |
| Voz de nube (msedge-tts) | ✅ | ✅ |
| Voz local / modo confidencial | ✅ SAPI | ✅ espeak-ng (hay que instalarlo) |
| Avatar flotante (NodeGui) + menú de configuración | ✅ | ✅ |
| Interruptor de micrófono (suelta el dispositivo) | ✅ | ✅ |
| Puente motor↔avatar (TCP local con token) | ✅ | ✅ |
| Bucle completo escuchar→pensar→hablar | ✅ | ✅ |
| Chat escrito | ✅ | ✅ |
| Herramientas (tool-calling) | ✅ | ✅ |
| Skills (estándar SKILL.md, el agente las crea) | ✅ | ✅ |
| Visión de pantalla | ⬜ | ⬜ |

El menú de voces del avatar solo enumera voces locales en Windows (SAPI). En
Linux la voz local es la de espeak-ng y no aparece en esa lista todavía.

Ejecuta todo con `npm run spike:conversar` (motor) y `npm run avatar` (cara).

## Requisitos

- **Node ≥ 22**
- **ffmpeg** en el `PATH` — captura el audio y, más adelante, la pantalla
- **Ollama** (opcional hasta que exista el cerebro)
- En **Linux**, `espeak-ng` si quieres voz sin nube (`apt install espeak-ng`).
  Sin él el modo confidencial se queda sin voz y lo dice al arrancar, en vez de
  fallar en cada frase.

## Puesta en marcha

```bash
npm install
npm run setup:stt      # descarga whisper.cpp + modelo (~500 MB, una vez)
npm run devices        # ver micrófonos disponibles
npm run spike:stt      # hablar y ver la transcripción
```

### Diagnóstico

Cuando el asistente "no oye", estos guiones separan el problema por capas en vez
de adivinar:

```bash
npm run mic-check              # ¿capta el micro? Ritmo y nivel en dBFS
npm run mic-check -- 10        # ...durante 10s
npm run spike:stt-file -- x.wav  # ¿transcribe? Sin micro de por medio
npm run spike:system           # transcribe lo que SUENA en el PC (loopback, solo Windows)
npm test                       # ¿segmenta el VAD? Con audio sintético
```

`mic-check` mide en **dBFS**, que es como se leen los niveles de audio: una
sala en calma ronda -60, hablar cerca del micro entre -30 y -20, y el silencio
digital da -Infinity. En porcentaje todo esto se ve como "0,0%" y no distingue
un micro mudo de uno que simplemente no tiene a nadie delante.

### Qué micrófono usa

El **predeterminado del sistema**, el que tengas configurado en Windows. No es
gratis averiguarlo: DirectShow —de donde tira ffmpeg— no tiene el concepto de
"predeterminado" y entrega los dispositivos en orden arbitrario, así que se le
pregunta a Core Audio (`IMMDeviceEnumerator`) y se empareja por GUID de
endpoint, no por nombre. En Linux no hace falta: `default` de PulseAudio ya lo
resuelve.

Para forzar otro, `ALPHA_AUDIO_DEVICE` con el nombre exacto que dé
`npm run devices`.

### Micrófonos flojos: ganancia y normalización

Un array integrado en la tapa del portátil entrega la voz 20-30 dB más floja
que un micro de diadema, a menudo por debajo del umbral del VAD. Dos palancas,
por variable de entorno:

```bash
ALPHA_MIC_GAIN=20      # ganancia fija en dB (micro constante pero flojo)
ALPHA_MIC_NORMALIZE=1  # normalización dinámica (dynaudnorm)
```

Calibra siempre con `mic-check` antes: busca **pico entre -20 y -12 dBFS**
hablando normal. Un pico cerca de 0 satura y hace que **whisper alucine frases**
en vez de transcribir; demasiado bajo y devuelve vacío.

Aviso: la normalización dinámica también amplifica el ruido en las pausas, así
que no mejora la relación señal/ruido — solo sube el volumen. Con un micro malo
o con AGC agresivo en el driver (típico de los "Smart Sound" de Intel), ni la
ganancia ni la normalización dan un resultado fiable. Para STT de verdad, un
micro decente (diadema USB, auriculares BT) marca toda la diferencia.

Dos cosas que confunden y conviene saber:

- Un dispositivo **desenchufado no aparece** en la lista. Si esperabas ver un
  casco y no está, no está puesto.
- Un adaptador USB de audio **sin micrófono conectado sí aparece**, y captura
  con normalidad: entrega silencio (~-90 dBFS) en vez de dar error. Si es tu
  predeterminado, el asistente será sordo sin decir por qué. `mic-check` es
  justo para eso.

`setup:stt` acepta `--model base|small|medium`. Por defecto `small`: `base` es
notablemente flojo en español.

### Si `setup:stt` no puede bajar el modelo

Los modelos viven en **huggingface.co**, que en la red de la oficina está
filtrado por dominio (el TLS se establece, la petición sale y no vuelve nada;
GitHub y el resto de CloudFront sí funcionan, así que el binario se descarga
bien). Dos salidas:

**Colocarlo a mano** — descarga desde otra red y déjalo en `models/` con el
nombre exacto `ggml-<tamaño>.bin`:

```
https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin
  →  models/ggml-small.bin
```

Luego `npm run setup:stt` verifica su SHA1 contra el oficial y avisa si la
descarga vino truncada.

**Usar otro host** — cualquier réplica, vía `ALPHA_HF_HOST`:

```bash
ALPHA_HF_HOST=https://hf-mirror.com npm run setup:stt
```

En ambos casos el script valida el **SHA1 publicado por whisper.cpp** en su
repo de GitHub antes de dar el modelo por bueno, y descarta el fichero si no
cuadra. Por eso el origen es indiferente: o los bytes son los oficiales, o no
se instalan.

Si el micrófono por defecto no es el que quieres:

```bash
set ALPHA_AUDIO_DEVICE=Headset Microphone (Realtek(R) Audio)
npm run spike:stt
```

## Arquitectura

Monorepo con el cerebro separado de la cara por un contrato explícito:

```
packages/
  engine/      Motor headless. Sin UI. Todo el cerebro y la E/S.
    audio/     captura (ffmpeg) + VAD
    stt/       transcripción (whisper.cpp)
    spikes/    guiones ejecutables para validar cada capa por separado
    brain/     cerebro compatible-OpenAI + herramientas + skills
    conversation/  bucle escuchar→pensar→hablar + puente con el avatar
    tts/       voz (Edge online / SAPI local)
    config/    esquema unificado + carga por capas + perfiles de avatar
  ui-avatar/   App NodeGui: retrato flotante, menú de configuración y chat escrito
```

El motor no sabe que existe una UI: expone un **puente TCP local** (127.0.0.1,
con token de sesión) y la app del avatar es un cliente delgado. Esto no es
ceremonia — es lo que permite cambiar NodeGui por otra capa de presentación sin
reescribir el cerebro. El avatar es el panel de control: lo que se configura en
su menú (agente, modelo, sonido, privacidad) viaja al motor por ese puente.

El puente va en los dos sentidos, y **manda el motor**: él es el dueño de los
perfiles de avatar y de la lista de micrófonos, y los envía al conectar. Si
rechaza un cambio —un avatar de nube con el modo confidencial puesto— responde
con el que de verdad quedó activo, y la UI se alinea con él en vez de mentir
sobre lo que está corriendo.

### Por qué procesos externos y (casi) ningún módulo nativo

La cadena de **micrófono**→texto no usa ningún addon `.node`, y es deliberado:

- Los bindings de whisper publicados en npm traen prebuilds compilados contra el
  ABI de **Electron**, que no cargan en Node; el resto exige compilar whisper.cpp
  en cada máquina.
- `naudiodon` (PortAudio) lleva sin tocarse desde 2021 y `naudiodon-loopback`
  ni siquiera existe en npm.

En su lugar se spawnean **ffmpeg** y el **binario oficial de whisper.cpp**, que
publican releases por plataforma. Sin ABI, sin toolchain de compilación, y el
mismo patrón que ya estaba previsto para Piper.

**La única excepción es el audio del sistema.** Capturar lo que suena en el PC
(reuniones, vídeos) necesita **WASAPI loopback**, que ffmpeg no soporta. La vía
automática —sin Mezcla estéreo, sin cable virtual, sin que el usuario habilite
nada— pasa por un módulo nativo: [`audify`](https://www.npmjs.com/package/audify)
(RtAudio), con **prebuilds N-API** (no compila en la instalación). Es justo el
caso que el plan original preveía para módulos nativos con prebuilds. `audify`
entrega 48 kHz estéreo; se remuestrea a 16 kHz mono con ffmpeg leyendo por
stdin, así `captureSystemAudio` tiene la **misma interfaz** que `captureMicrophone`
y el VAD y whisper no distinguen el origen.

> Nota de seguridad: `npm audit` reporta varias vulnerabilidades (a día de hoy
> ~5 altas y 2 moderadas), concentradas en dependencias de **instalación y
> tooling** de los módulos nativos —`tar`, `cmake-js`, NodeGui, audify—, no en el
> código que se ejecuta en runtime. **No** ejecutar `npm audit fix --force`: la
> corrección que propone para NodeGui implica un cambio mayor/downgrade. Revisar
> actualizaciones compatibles a mano.

## Configuración

Un solo esquema, tres capas que se funden en este orden (gana la última):

```
valores por defecto  →  config/default.yaml  →  config/local.yaml  →  config/alpha.settings.json
        (código)            (versionado)          (tuyo, ignorado)      (lo que toca el avatar)
```

`config/local.yaml` es el sitio para lo tuyo: no va al repo.

## Los cuatro agentes

El avatar no es un personaje cableado sino un **perfil** que reconfigura al
asistente: al elegirlo cambian de golpe su nombre, personalidad, modelo, voz e
imagen. Viven en `config/avatars.yaml`, así que se editan sin tocar código:

```yaml
avatars:
  - id: nexus
    name: Nexus
    role: El Guardián de Datos
    personality: Directo y preciso. Vas al grano...
    local: true                       # solo recursos de la máquina
    model: ollama/ornith:9b
    image: assets/avatars/nexus.png   # cualquier ruta del disco
    voice: { engine: sapi, name: Microsoft Helena Desktop, rate: -1 }
```

| Agente | Avatar | Rol | Privacidad |
|---|---|---|---|
| **Vulpis.AI** | Zorro antropomórfico | El Explorador Proactivo | nube |
| **Unit-A** | Robot / droide | El Asistente Cibernético | **solo local** |
| **Nexus** | Ser de energía cristalina | El Guardián de Datos | **solo local** |
| **Synapse** | Espíritu etéreo | La Guía Neural | nube |

**La privacidad es del avatar, y se cumple sola.** Un perfil `local: true` no
puede hablar con una voz de nube: si el YAML lo pide, el cargador lo corrige a la
voz del sistema (SAPI). Y con el **modo confidencial** activo el menú solo ofrece
avatares locales; si el que está puesto usa la nube, se cambia al primero que no
lo haga en vez de dejar el asistente en un estado imposible.

Con una sola voz española instalada en Windows (Helena), lo que distingue a los
avatares locales es el **ritmo** (`rate`), no el timbre. Para variedad real hacen
falta más voces SAPI instaladas o Piper.

### Silenciar el micrófono

El icono 🎤 de la ventana **cierra la captura**, no la ignora: ffmpeg muere y el
dispositivo queda libre, así que el indicador de micrófono de Windows se apaga.
Un mute que dejara el micro abierto sería una media verdad. El chat escrito
sigue funcionando con el micrófono cerrado.

### Dos motores a la vez

El puente usa un puerto fijo, así que un segundo motor lo encuentra ocupado y se
queda sin avatar. Lo dice al arrancar en vez de anunciar que escucha, y se puede
levantar otra instancia completa para probar sin matar la que esté en uso: la
**misma** variable la entienden motor y avatar, y cada puerto tiene su propio
fichero de token, así que las dos instancias no se pisan la autenticación.

```bash
ALPHA_BRIDGE_PORT=43118 npm run spike:conversar   # motor de pruebas
ALPHA_BRIDGE_PORT=43118 npm run avatar            # su avatar
```

### Vulnerabilidades de dependencias

`npm audit --omit=dev` reporta 7 avisos (1 crítico, 5 altos, 1 moderado). **No
ejecutes `npm audit fix --force`**: su "arreglo" es bajar `@nodegui/nodegui` de
0.74 a 0.37, es decir, retroceder años en la UI.

De dónde salen y qué exponen de verdad:

- **`tar` 6.2.1** (crítico/alto) — entra por `@nodegui/qode` y por `cmake-js`
  (dependencia de `audify`). Solo se usa **al instalar**, para descargar y
  descomprimir Qt y los prebuilds nativos; no toca archivos del usuario en
  tiempo de ejecución. Aun así es superficie de cadena de suministro real. Las
  correcciones están en `tar` 7.x, y ni `cmake-js` 7.4 ni `qode` lo soportan: no
  se puede forzar con `overrides` sin romper la instalación.
- **`postcss` 7.0.39** (alto) — lo usa NodeGui **en ejecución** para procesar los
  estilos (`setInlineStyle`). Los avisos son de lectura de ficheros `.map` por
  `sourceMappingURL` y de escapado al serializar; aquí el CSS lo escribimos
  nosotros en el código, no viene de fuera. Subir a postcss 8 rompería
  `postcss-nodegui-autoprefixer`, que usa la API de plugins de la 7.

Es decir: nada accionable sin que actualicen NodeGui y `audify`/`cmake-js`. La
salida de fondo, si esto pesa, es sustituir la capa de UI o el módulo nativo de
audio; no un `fix --force`.

## Licencia

Privado — DigitalTPM.
