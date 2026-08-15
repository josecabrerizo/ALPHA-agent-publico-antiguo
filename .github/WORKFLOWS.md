# GitHub Actions Workflows

## `ci.yml` - Compilar y probar

En cada push a `master` y en cada PR contra `master`, sobre **Windows y Linux**:

```bash
npm ci
npm run check     # lint + formato + tipos (tests incluidos) + tests
npm run coverage  # informativo, sin umbral
```

Ninguna prueba necesita micrófono, ffmpeg, whisper ni red: el audio es
sintético y los servicios externos, dobles.

## `claude.yml` - Resolver issues con Claude

Detecta issues o comentarios con `@claude` y ejecuta Claude Code para implementar la solución.

> **Quién puede dispararlo.** Este workflow arranca un agente con permisos de
> escritura sobre el repositorio: edita ficheros, ejecuta Bash y hace push. Por
> eso los comentarios `@claude` **solo** los atiende de OWNER, MEMBER o
> COLLABORATOR; de cualquier otro se ignoran. La vía de la etiqueta la cierra
> GitHub por sí misma, porque poner etiquetas ya exige permiso de triage.
>
> El job usa el entorno `claude-agent`. Si le añades revisores obligatorios en
> **Settings → Environments**, cada ejecución pedirá aprobación manual antes de
> arrancar. Sin revisores configurados, el entorno no protege nada.

### Cómo usar

**Opción 1: Etiquetar una issue**

1. Crea una issue con la descripción de la tarea
2. Etiquétala con `agent-ready`
3. El workflow detecta la etiqueta y Claude implementa la solución
4. Se abre automáticamente un PR en `master`

**Opción 2: Comentario en una issue**

```
@claude Arregla el bug en la autenticación cuando el token expira
```

1. Claude lee el comentario y lo implementa
2. Se abre automáticamente un PR en `master`

**Opción 3: Comentario en un PR existente**

```
@claude Refactoriza la función calculateTotal() para ser más eficiente
```

1. Claude aplica los cambios a esa rama del PR
2. Hace push automáticamente (sin abrir un PR nuevo)

### Secretos requeridos

- `CLAUDE_CODE_OAUTH_TOKEN`: Token OAuth de Claude Code
  - Obtener en: https://github.com/settings/connections/applications/Xxxxxxxxxx
  - Pedir acceso en Claude Code settings

## `codex-trigger.yml` - Revisar PRs con Codex

Automáticamente comenta `@codex review` en cada PR nuevo contra `master`, disparando la revisión de Codex.

### Cómo funciona

1. Se abre un PR en `master`
2. El workflow comenta automáticamente `@codex review`
3. Codex revisa el código y comenta sus hallazgos
4. Puedes pedirle ajustes comentando `@codex fix ...`

### Secretos requeridos

- `CODEX_TRIGGER_TOKEN`: PAT (Personal Access Token) de GitHub
  - Debe tener permisos de `repo` y `workflow`
  - La cuenta vinculada debe tener acceso a Codex

## Configuración de secretos en GitHub

1. Ve a: `https://github.com/DigitalTPM/digitaltpm-ALPHA/settings/secrets/actions`
2. Click en "New repository secret"
3. Agrega:
   - `CLAUDE_CODE_OAUTH_TOKEN`: Token de Claude
   - `CODEX_TRIGGER_TOKEN`: PAT de GitHub

## Flujo completo

```
Issue creada con @claude
         ↓
Claude resuelve y crea PR
         ↓
Codex revisa automáticamente
         ↓
Comentarios de Codex en el PR
         ↓
Revisión y merge manual
```

## Notas

- Los PRs se crean con base en `master`, nunca contra otras ramas
- Codex solo atiende a usuarios con su cuenta vinculada
- El PAT (`CODEX_TRIGGER_TOKEN`) debe ser de usuario, no de bot
- Respuestas de Codex siempre en español
- Las actions van fijadas por SHA, no por tag: un tag se puede reapuntar a otro
  commit, y aquí eso sería ejecutar código ajeno con permiso de escritura
