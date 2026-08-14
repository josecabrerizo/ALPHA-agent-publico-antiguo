import {
  QMainWindow,
  QWidget,
  QLabel,
  QLineEdit,
  QPushButton,
  QMenu,
  QAction,
  QPoint,
  QPixmap,
  QMouseEvent,
  WidgetAttribute,
  WindowType,
  WidgetEventTypes,
  MouseButton,
  TextFormat,
  AspectRatioMode,
  TransformationMode,
} from '@nodegui/nodegui';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { AvatarOption, VoiceOption } from './bridge-client.js';
import { log } from './log.js';
import { STATE_CYCLE, STATE_RHYTHMS, MAX_PULSE, type AvatarState } from './states.js';
import { AGENTS, AGENT_ORDER, type AgentId } from './agents.js';
import { loadSettings, saveSettings, MODEL_OPTIONS, type Settings } from './settings.js';

const WIN_W = 280;
// Zona visual del avatar: la ocupa el retrato del personaje o, si no hay imagen,
// el orbe. Alto fijo para los dos, asi el resto del layout no baila.
const VISUAL_TOP = 10;
const VISUAL_H = 200;
const VISUAL_BOTTOM = VISUAL_TOP + VISUAL_H;
const ORB_CX = WIN_W / 2;
const ORB_CY = VISUAL_TOP + VISUAL_H / 2;
const BASE_RADIUS = 62;
/** Caja donde se encaja el retrato, conservando su proporcion. */
const PORTRAIT_MAX_W = 168;
const PORTRAIT_MAX_H = VISUAL_H;
const CAPTION_MS = 9000; // cuanto se queda el ultimo texto antes de esfumarse

/** Boton de micro: pequeno, en la esquina de la zona del avatar. */
const MIC_SIZE = 30;

const PAD = 12; // margen lateral
const GAP = 10; // separacion vertical entre piezas
const INPUT_H = 34;
const CAPTION_H = 116;

/**
 * Crea un submenu. Rodea un bug de NodeGui 0.74: `addMenu(titulo)` pasa al
 * nativo el SEGUNDO argumento (undefined) en vez del primero, y peta con "A
 * string was expected". Pasando el titulo en ambas posiciones, el segundo
 * argumento —el que usa— lleva el texto correcto.
 */
function addSubmenu(menu: QMenu, title: string): QMenu {
  return (menu.addMenu as (a: string, b: string) => QMenu)(title, title);
}

// border-radius fijo al radio maximo: Qt lo recorta a la mitad del tamano, asi
// que el orbe se ve como circulo perfecto a cualquier tamano del latido.
const CIRCLE_RADIUS = BASE_RADIUS + MAX_PULSE;

// Layout con dos alturas: compacta (orbe + campo de texto pegado debajo) y
// expandida (aparece el bocadillo en medio y el campo baja). Asi en reposo el
// chat no queda separado del orbe por un hueco vacio.
const CAPTION_Y = VISUAL_BOTTOM + GAP;
const INPUT_Y_COMPACT = VISUAL_BOTTOM + GAP;
const INPUT_Y_EXPANDED = CAPTION_Y + CAPTION_H + GAP;
const WIN_H_COMPACT = INPUT_Y_COMPACT + INPUT_H + PAD;
const WIN_H_EXPANDED = INPUT_Y_EXPANDED + INPUT_H + PAD;

/**
 * Ventana flotante del avatar: frameless, translucida, siempre encima y
 * arrastrable. El agente elegido da el color del orbe; el estado, su ritmo.
 * Clic derecho abre el menu de configuracion del asistente.
 */
export class AvatarWindow {
  private readonly win = new QMainWindow();
  private readonly root = new QWidget();
  private readonly orb = new QWidget();
  /** Retrato del personaje. Va despues del orbe para quedar por encima de el. */
  private readonly portrait = new QLabel();
  private readonly caption = new QLabel();
  private readonly input = new QLineEdit();
  /** Interruptor de escucha: apagarlo hace que el motor suelte el microfono. */
  private readonly micButton = new QPushButton();

  /** Tamano base del retrato ya encajado; undefined = no hay imagen que pintar. */
  private portraitBase: { w: number; h: number } | undefined;
  /** Perfiles que manda el motor: el es el dueno de los avatares. */
  private avatars: AvatarOption[] = [];

  /** Se llama al enviar un mensaje escrito (Enter en el campo de texto). */
  private onTextSubmit: ((text: string) => void) | undefined;

  private settings: Settings = loadSettings();
  private state: AvatarState = 'reposo';
  private captionTimer: NodeJS.Timeout | undefined;

  // El menu y sus acciones se guardan para que el GC no se los lleve mientras
  // estan en pantalla.
  private menu: QMenu | undefined;
  private menuRefs: (QMenu | QAction)[] = [];

  private dragging = false;
  private dragDX = 0;
  private dragDY = 0;

  /** Se llama al cambiar la config en el menu, para propagarla al motor. */
  private onSettingsChanged: ((settings: Settings) => void) | undefined;

  /** Microfonos que manda el motor; el menu "Sonido" se llena con ellos. */
  private micDevices: { name: string; isDefault: boolean }[] = [];

  /** Voces disponibles (SAPI locales + Edge nube). */
  private voices: VoiceOption[] = [];

  constructor() {
    this.setupWindow();
    this.setupOrb();
    this.setupPortrait();
    this.setupCaption();
    this.setupInput();
    this.setupMicButton();
    this.setupMouse();
    this.applyPortrait();
  }

  show(): void {
    this.win.show();
  }

  /**
   * Cambia el estado y REPINTA. Guardarlo sin mas dejaba escuchar/pensar/hablar
   * indistinguibles en pantalla: el halo crece y se enciende segun el estado
   * (la amplitud de STATE_RHYTHMS, ahora como tamano fijo en vez de latido).
   */
  setState(state: AvatarState): void {
    if (state === this.state) return;
    this.state = state;
    this.paintOrb();
    this.layoutVisual();
  }

  /** Registra quien recibe los cambios de config (para mandarlos al motor). */
  setOnSettingsChanged(cb: (settings: Settings) => void): void {
    this.onSettingsChanged = cb;
  }

  /** Registra quien recibe los mensajes escritos (chat de texto). */
  setOnTextSubmit(cb: (text: string) => void): void {
    this.onTextSubmit = cb;
  }

  /** La config actual, para sincronizar el motor al conectar. */
  getSettings(): Settings {
    return this.settings;
  }

  /** Recibe del motor la lista de microfonos disponibles. */
  setMicDevices(inputs: { name: string; isDefault: boolean }[]): void {
    this.micDevices = inputs;
  }

  /**
   * Recibe del motor los perfiles de avatar y cual quedo activo. El motor es
   * quien manda: si rechazo un cambio (p. ej. un avatar de nube en modo
   * confidencial), `current` trae el que de verdad esta puesto y la UI se
   * alinea con el en vez de mentir sobre lo que hay corriendo.
   */
  setAvatarOptions(list: AvatarOption[], current?: string): void {
    this.avatars = list;
    if (current && current !== this.settings.agent && AGENT_ORDER.includes(current as AgentId)) {
      this.settings = { ...this.settings, agent: current as AgentId };
      saveSettings(this.settings);
    }
    this.applyPortrait();
  }

  /** Recibe del motor la lista de voces disponibles (SAPI + Edge). */
  setVoiceOptions(list: VoiceOption[]): void {
    this.voices = list;
  }

  /** Muestra texto en el bocadillo (la ventana se expande) y se esfuma sola. */
  showCaption(text: string): void {
    const clean = text.trim();
    if (!clean) return;
    this.caption.setText(clean);
    this.caption.show();
    this.layoutExpanded();
    if (this.captionTimer) clearTimeout(this.captionTimer);
    this.captionTimer = setTimeout(() => {
      this.caption.hide();
      this.layoutCompact();
    }, CAPTION_MS);
  }

  private setupWindow(): void {
    this.win.setWindowFlag(WindowType.FramelessWindowHint, true);
    this.win.setWindowFlag(WindowType.WindowStaysOnTopHint, true);
    this.win.setWindowFlag(WindowType.Tool, true);
    this.win.setAttribute(WidgetAttribute.WA_TranslucentBackground, true);
    this.win.setFixedSize(WIN_W, WIN_H_COMPACT);

    this.root.setInlineStyle('background: transparent;');
    this.win.setCentralWidget(this.root);
  }

  /** Reposo: solo orbe + campo de texto pegado debajo. */
  private layoutCompact(): void {
    this.input.setGeometry(PAD, INPUT_Y_COMPACT, WIN_W - 2 * PAD, INPUT_H);
    this.win.setFixedSize(WIN_W, WIN_H_COMPACT);
  }

  /** Con respuesta: aparece el bocadillo y el campo baja. */
  private layoutExpanded(): void {
    this.win.setFixedSize(WIN_W, WIN_H_EXPANDED);
    this.caption.setGeometry(PAD, CAPTION_Y, WIN_W - 2 * PAD, CAPTION_H);
    this.input.setGeometry(PAD, INPUT_Y_EXPANDED, WIN_W - 2 * PAD, INPUT_H);
  }

  private setupOrb(): void {
    this.orb.setParent(this.root);
    this.paintOrb();
  }

  /**
   * Retrato del avatar. Se queda oculto hasta que el motor manda los perfiles
   * con su imagen; sin imagen, el orbe sigue siendo la cara del asistente.
   */
  private setupPortrait(): void {
    this.portrait.setParent(this.root);
    this.portrait.setInlineStyle('background: transparent;');
    this.portrait.setScaledContents(true);
    this.portrait.hide();
  }

  /**
   * Imagen del avatar. Manda la que da el motor (el perfil puede apuntar a
   * cualquier fichero), pero antes de que conecte se usa la ruta convencional
   * del repo para que el personaje se vea desde el primer segundo.
   */
  private imageFor(id: string): string {
    const fromEngine = this.avatars.find((a) => a.id === id)?.image;
    if (fromEngine) return fromEngine;
    // dist/avatar-window.js -> repoRoot: tres niveles arriba (como el token).
    // Soporta PNG y SVG: intenta SVG primero, luego PNG como fallback.
    const basePath = path.resolve(__dirname, '..', '..', '..', 'assets', 'avatars', id);
    const svgPath = `${basePath}.svg`;
    try {
      if (existsSync(svgPath)) return svgPath;
    } catch {
      // Si falla la busqueda de SVG, usa PNG.
    }
    return `${basePath}.png`;
  }

  /**
   * Carga la imagen del avatar activo. Si no hay perfil, imagen o el fichero no
   * se puede leer, se vuelve al orbe: la ventana nunca se queda en blanco.
   */
  private applyPortrait(): void {
    const file = this.imageFor(this.settings.agent);
    const pixmap = new QPixmap();
    if (!file || !pixmap.load(file)) {
      this.portraitBase = undefined;
      this.portrait.hide();
      this.paintOrb();
      this.layoutVisual();
      log(
        `retrato de "${this.settings.agent}" no disponible (${file || 'sin ruta'}); se usa el orbe`,
      );
      return;
    }
    const scaled = pixmap.scaled(
      PORTRAIT_MAX_W,
      PORTRAIT_MAX_H,
      AspectRatioMode.KeepAspectRatio,
      TransformationMode.SmoothTransformation,
    );
    this.portraitBase = { w: scaled.width(), h: scaled.height() };
    this.portrait.setPixmap(scaled);
    this.portrait.show();
    this.paintOrb();
    this.layoutVisual();
    const isSvg = file.endsWith('.svg');
    log(
      `retrato: ${this.settings.agent} (${scaled.width()}×${scaled.height()})${isSvg ? ' [SVG animado]' : ''}`,
    );
  }

  /** Bocadillo de texto bajo el orbe. Oculto hasta que llega algo que decir. */
  private setupCaption(): void {
    this.caption.setParent(this.root);
    this.caption.setGeometry(PAD, CAPTION_Y, WIN_W - 2 * PAD, CAPTION_H);
    this.caption.setWordWrap(true);
    this.caption.setTextFormat(TextFormat.PlainText);
    this.caption.setInlineStyle(`
      color: rgba(255, 255, 255, 235);
      background: rgba(20, 22, 30, 190);
      border: 1px solid rgba(255, 255, 255, 40);
      border-radius: 12px;
      padding: 8px 10px;
      font-size: 12px;
      qproperty-alignment: 'AlignHCenter | AlignTop';
    `);
    this.caption.hide();
  }

  /** Campo de chat escrito, pegado al orbe (layout compacto). Enter envia. */
  private setupInput(): void {
    this.input.setParent(this.root);
    this.input.setGeometry(PAD, INPUT_Y_COMPACT, WIN_W - 2 * PAD, INPUT_H);
    this.input.setPlaceholderText('Escribe a A.L.P.H.A.…');
    this.input.setInlineStyle(`
      color: rgba(255, 255, 255, 240);
      background: rgba(30, 33, 44, 220);
      border: 1px solid rgba(255, 255, 255, 55);
      border-radius: 16px;
      padding: 4px 12px;
      font-size: 12px;
    `);
    this.input.addEventListener('returnPressed', () => {
      const text = this.input.text().trim();
      if (!text) return;
      this.input.clear();
      this.onTextSubmit?.(text);
    });
  }

  /**
   * Interruptor de escucha. Apagarlo no es cosmetico: el motor cierra la
   * captura y suelta el microfono, asi que el indicador del sistema se apaga.
   * El chat escrito sigue funcionando con el micro cerrado.
   */
  private setupMicButton(): void {
    this.micButton.setParent(this.root);
    this.micButton.setGeometry(PAD, VISUAL_BOTTOM - MIC_SIZE, MIC_SIZE, MIC_SIZE);
    this.micButton.addEventListener('clicked', () => {
      this.update({ micEnabled: !this.settings.micEnabled });
      log(this.settings.micEnabled ? 'micrófono activado' : 'micrófono silenciado');
    });
    this.paintMicButton();
  }

  private paintMicButton(): void {
    const on = this.settings.micEnabled;
    this.micButton.setText(on ? '🎤' : '🔇');
    this.micButton.setToolTip(
      on ? 'Escuchando — clic para silenciar' : 'Micrófono cerrado — clic para escuchar',
    );
    this.micButton.setInlineStyle(`
      background: ${on ? 'rgba(30, 33, 44, 210)' : 'rgba(120, 40, 45, 225)'};
      border: 1px solid rgba(255, 255, 255, ${on ? 55 : 95});
      border-radius: ${MIC_SIZE / 2}px;
      font-size: 13px;
      padding: 0px;
    `);
  }

  /**
   * Intensidad del halo segun el estado, en 0..1. Sale de la amplitud del
   * pulso: el estado mas "nervioso" es tambien el que mas se enciende, asi que
   * la escala ya estaba definida en states.ts y no hay una segunda verdad.
   */
  private stateGlow(): number {
    return STATE_RHYTHMS[this.state].pulse / MAX_PULSE;
  }

  /**
   * Estilo del orbe con el color del agente activo. Con retrato pasa a ser un
   * halo tenue detras del personaje; sin el, es la cara del asistente. El
   * ESTADO modula cuanto se enciende (ver stateGlow).
   */
  private paintOrb(): void {
    const [r, g, b] = AGENTS[this.settings.agent].color;
    const lighten = (c: number) => Math.min(255, c + 45);
    const darken = (c: number) => Math.round(c * 0.5);
    // Reposo no se apaga del todo (0.6) o el avatar pareceria desconectado.
    const glow = 0.6 + 0.4 * this.stateGlow();
    const a = (alpha: number) => Math.round(alpha * glow);
    if (this.portraitBase) {
      this.orb.setInlineStyle(`
        background: qradialgradient(
          cx: 0.5, cy: 0.5, radius: 0.5, fx: 0.5, fy: 0.5,
          stop: 0 rgba(${lighten(r)}, ${lighten(g)}, ${lighten(b)}, ${a(110)}),
          stop: 0.6 rgba(${r}, ${g}, ${b}, ${a(55)}),
          stop: 1 rgba(${darken(r)}, ${darken(g)}, ${darken(b)}, 0)
        );
        border-radius: ${CIRCLE_RADIUS}px;
      `);
      return;
    }
    this.orb.setInlineStyle(`
      background: qradialgradient(
        cx: 0.5, cy: 0.42, radius: 0.75,
        fx: 0.5, fy: 0.42,
        stop: 0 rgba(${lighten(r)}, ${lighten(g)}, ${lighten(b)}, ${a(245)}),
        stop: 0.55 rgba(${r}, ${g}, ${b}, ${a(225)}),
        stop: 1 rgba(${darken(r)}, ${darken(g)}, ${darken(b)}, ${a(90)})
      );
      border-radius: ${CIRCLE_RADIUS}px;
      border: 2px solid rgba(255, 255, 255, ${a(60) + 20});
    `);
  }

  private setupMouse(): void {
    this.root.addEventListener(WidgetEventTypes.MouseButtonPress, (e) => {
      const ev = new QMouseEvent(e as ConstructorParameters<typeof QMouseEvent>[0]);
      if (ev.button() === MouseButton.RightButton) {
        this.openMenu(ev.globalX(), ev.globalY());
        return;
      }
      if (ev.button() !== MouseButton.LeftButton) return;
      const geo = this.win.geometry();
      this.dragDX = ev.globalX() - geo.left();
      this.dragDY = ev.globalY() - geo.top();
      this.dragging = true;
    });

    this.root.addEventListener(WidgetEventTypes.MouseMove, (e) => {
      if (!this.dragging) return;
      const ev = new QMouseEvent(e as ConstructorParameters<typeof QMouseEvent>[0]);
      this.win.move(ev.globalX() - this.dragDX, ev.globalY() - this.dragDY);
    });

    this.root.addEventListener(WidgetEventTypes.MouseButtonRelease, () => {
      this.dragging = false;
    });

    // Doble clic cicla el estado, util para ver los ritmos mientras no hay
    // motor que los conduzca.
    this.root.addEventListener(WidgetEventTypes.MouseButtonDblClick, () => {
      const next = (STATE_CYCLE.indexOf(this.state) + 1) % STATE_CYCLE.length;
      this.setState(STATE_CYCLE[next]!);
    });
  }

  private update(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
    // applyPortrait repinta tambien el orbe/halo, asi que cubre los dos casos.
    this.applyPortrait();
    this.paintMicButton();
    this.onSettingsChanged?.(this.settings);
  }

  private action(
    text: string,
    onTrigger: () => void,
    opts: { checked?: boolean; enabled?: boolean } = {},
  ): QAction {
    const a = new QAction();
    a.setText(text);
    if (opts.checked !== undefined) {
      a.setCheckable(true);
      a.setChecked(opts.checked);
    }
    if (opts.enabled === false) a.setEnabled(false);
    a.addEventListener('triggered', onTrigger);
    this.menuRefs.push(a);
    return a;
  }

  /** Construye el menu de configuracion cada vez, reflejando el estado actual. */
  private openMenu(x: number, y: number): void {
    const menu = new QMenu();
    this.menu = menu;
    this.menuRefs = [menu];

    const active = this.avatars.find((a) => a.id === this.settings.agent);
    const title = this.action(
      `A.L.P.H.A. — ${active?.name ?? AGENTS[this.settings.agent].label}`,
      () => {},
      {
        enabled: false,
      },
    );
    menu.addAction(title);
    menu.addSeparator();

    // Avatar. Los perfiles los manda el motor (personalidad, voz, modelo e
    // imagen viven ahi); si aun no ha conectado, se cae a la lista local.
    const avatarMenu = addSubmenu(menu, 'Avatar');
    this.menuRefs.push(avatarMenu);
    for (const opt of this.avatarChoices()) {
      // En modo confidencial solo se ofrecen los avatares que trabajan en local.
      const blocked = this.settings.confidential && !opt.local;
      const label = `${opt.name} — ${opt.role}${opt.local ? '' : '  (nube)'}`;
      avatarMenu.addAction(
        this.action(label, () => this.update({ agent: opt.id as AgentId }), {
          checked: this.settings.agent === opt.id,
          enabled: !blocked,
        }),
      );
    }

    // Modelo
    const modelMenu = addSubmenu(menu, 'Modelo');
    this.menuRefs.push(modelMenu);
    for (const opt of MODEL_OPTIONS) {
      // En modo confidencial, los modelos de nube quedan deshabilitados.
      const blocked = this.settings.confidential && !opt.local;
      modelMenu.addAction(
        this.action(opt.label, () => this.update({ model: opt.ref }), {
          checked: this.settings.model === opt.ref,
          enabled: !blocked,
        }),
      );
    }

    // Sonido (microfono)
    const soundMenu = addSubmenu(menu, 'Sonido');
    this.menuRefs.push(soundMenu);
    if (this.micDevices.length === 0) {
      soundMenu.addAction(this.action('(motor no conectado)', () => {}, { enabled: false }));
    } else {
      for (const dev of this.micDevices) {
        // "" en settings = predeterminado del sistema; se marca el que toque.
        const isCurrent =
          this.settings.audioDevice === dev.name ||
          (this.settings.audioDevice === '' && dev.isDefault);
        const label = dev.isDefault ? `${dev.name}  (predeterminado)` : dev.name;
        soundMenu.addAction(
          this.action(label, () => this.update({ audioDevice: dev.name }), { checked: isCurrent }),
        );
      }
    }

    // Voz del avatar actual: permite cambiarla entre las disponibles
    const voiceMenu = addSubmenu(menu, 'Voz del avatar');
    this.menuRefs.push(voiceMenu);
    if (this.voices.length === 0) {
      voiceMenu.addAction(this.action('(enumerando voces...)', () => {}, { enabled: false }));
    } else {
      // Buscar la voz del avatar actual o la guardada en settings
      const currentVoiceId = this.settings.voiceId;
      for (const v of this.voices) {
        // En confidencial, solo se ofrecen voces locales
        const blocked = this.settings.confidential && !v.local;
        voiceMenu.addAction(
          this.action(v.name, () => this.update({ voiceId: v.id }), {
            checked: v.id === currentVoiceId,
            enabled: !blocked,
          }),
        );
      }
    }

    // Privacidad
    menu.addSeparator();
    menu.addAction(
      this.action('Modo confidencial (sin nube)', () => this.toggleConfidential(), {
        checked: this.settings.confidential,
      }),
    );

    // Salir
    menu.addSeparator();
    menu.addAction(this.action('Salir', () => this.win.close()));

    // exec (modal) en vez de popup: popup es no bloqueante y el menu puede
    // desvanecerse antes de renderizarse.
    menu.exec(new QPoint(x, y));
  }

  /**
   * Avatares que se pueden elegir. Mientras el motor no conecte no hay perfiles,
   * asi que se muestra la lista local (sin imagen ni privacidad real, pero el
   * menu no se queda vacio).
   */
  private avatarChoices(): AvatarOption[] {
    if (this.avatars.length > 0) return this.avatars;
    return AGENT_ORDER.map((id) => ({
      id,
      name: AGENTS[id].label,
      role: AGENTS[id].tagline,
      local: true,
      image: '',
    }));
  }

  private toggleConfidential(): void {
    const confidential = !this.settings.confidential;
    // Al activar confidencial con un modelo de nube seleccionado, se cae al
    // modelo local por defecto para no quedar en un estado imposible.
    const current = MODEL_OPTIONS.find((m) => m.ref === this.settings.model);
    const model =
      confidential && current && !current.local
        ? (MODEL_OPTIONS.find((m) => m.local)?.ref ?? this.settings.model)
        : this.settings.model;
    // Lo mismo con el avatar: uno de nube no puede seguir puesto en modo
    // confidencial, asi que se propone el primero que trabaje solo en local.
    const avatar = this.avatars.find((a) => a.id === this.settings.agent);
    const agent =
      confidential && avatar && !avatar.local
        ? ((this.avatars.find((a) => a.local)?.id as AgentId | undefined) ?? this.settings.agent)
        : this.settings.agent;
    this.update({ confidential, model, agent });
  }

  /**
   * Coloca retrato y halo. Sin animacion (la respiracion sinusoidal se quito y
   * el dinamismo se replanteara), pero el TAMANO del halo depende del estado:
   * es lo que hace distinguibles escuchando, pensando y hablando de un vistazo.
   */
  private layoutVisual(): void {
    const radius = BASE_RADIUS + STATE_RHYTHMS[this.state].pulse;
    this.orb.setGeometry(
      Math.round(ORB_CX - radius),
      Math.round(ORB_CY - radius),
      radius * 2,
      radius * 2,
    );
    if (!this.portraitBase) return;
    // Anclado por abajo: los pies del personaje quedan al ras del bocadillo.
    const { w, h } = this.portraitBase;
    this.portrait.setGeometry(Math.round(ORB_CX - w / 2), VISUAL_BOTTOM - h, w, h);
  }

  dispose(): void {
    if (this.captionTimer) clearTimeout(this.captionTimer);
  }
}
