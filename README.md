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

`setup:stt` acepta `--model base|small|medium`. Por defecto `small`: `base` es
notablemente flojo en español.

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
