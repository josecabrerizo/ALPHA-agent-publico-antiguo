# A.L.P.H.A.

**A**sistente **L**ocal **P**roactivo **H**íbrido **A**bierto.

Asistente de escritorio con avatar flotante que escucha, habla y ve la pantalla.
En el espíritu del viejo Clippy, pero con un cerebro de verdad y sin ceder la
privacidad: la captura, el VAD y la transcripción corren en la máquina; la nube
es un acelerador opcional que el **modo confidencial** apaga por completo.

Windows y Linux. Todo Node/TypeScript, sin Python.

## Estado

MVP 1 en construcción: *Clippy conversacional*. Hoy funciona el primer eslabón,
la cadena **audio→texto**. Lo demás (cerebro, voz, visión, avatar) viene detrás.

| Capa | Estado |
|---|---|
| Captura de micrófono (ffmpeg) | ✅ |
| VAD por energía | ✅ |
| STT (whisper.cpp) | ✅ |
| Cerebro LLM (Ollama + nube) | ⬜ |
| Voz (msedge-tts / Piper) | ⬜ |
| Visión de pantalla | ⬜ |
| Avatar flotante (NodeGui) | ⬜ |

## Requisitos

- **Node ≥ 22**
- **ffmpeg** en el `PATH` — captura el audio y, más adelante, la pantalla
- **Ollama** (opcional hasta que exista el cerebro)

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
npm test                       # ¿segmenta el VAD? Con audio sintético
```

`mic-check` mide en **dBFS**, que es como se leen los niveles de audio: una
sala en calma ronda -60, hablar cerca del micro entre -30 y -20, y el silencio
digital da -Infinity. En porcentaje todo esto se ve como "0,0%" y no distingue
un micro mudo de uno que simplemente no tiene a nadie delante.

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
  ui-avatar/   (pendiente) App NodeGui: ventana flotante + avatar animado
```

El motor no sabe que existe una UI: expondrá un servidor WebSocket local y la
app del avatar será un cliente delgado. Esto no es ceremonia — es lo que permite
cambiar NodeGui por otra capa de presentación sin reescribir el cerebro.

### Por qué procesos externos y no módulos nativos

La cadena audio→texto **no usa ningún addon `.node`**, y es deliberado:

- Los bindings de whisper publicados en npm traen prebuilds compilados contra el
  ABI de **Electron**, que no cargan en Node; el resto exige compilar whisper.cpp
  en cada máquina.
- `naudiodon` (PortAudio) lleva sin tocarse desde 2021 y `naudiodon-loopback`
  ni siquiera existe en npm.

En su lugar se spawnean **ffmpeg** y el **binario oficial de whisper.cpp**, que
publican releases por plataforma. Sin ABI, sin toolchain de compilación, y el
mismo patrón que ya estaba previsto para Piper.

## Los cuatro agentes

El avatar no es un personaje cableado sino un recurso enchufable. Están
definidos cuatro, cada uno con su carácter:

| Agente | Avatar | Rol |
|---|---|---|
| **Vulpis.AI** | Zorro antropomórfico | El Explorador Proactivo |
| **Unit-A** | Robot / droide | El Asistente Cibernético |
| **Nexus** | Ser de energía cristalina | El Guardián de Datos |
| **Synapse** | Espíritu etéreo | La Guía Neural |

## Licencia

Privado — DigitalTPM.
