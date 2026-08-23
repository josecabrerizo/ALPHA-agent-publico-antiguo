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
  QImage,
  QImageFormat,
  QPainter,
  QMouseEvent,
  WidgetAttribute,
  WindowType,
  WidgetEventTypes,
  MouseButton,
  TextFormat,
  GlobalColor,
  AspectRatioMode,
  TransformationMode,
} from '@nodegui/nodegui';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_ORB_COLOR,
  type AvatarConfigMessage,
  type AvatarOption,
  type ModelOption,
  type OrbColor,
  type VoiceOption,
} from '@alpha/protocol';
import { log } from './log.js';
import { STATE_CYCLE, STATE_RHYTHMS, MAX_PULSE, type AvatarState } from './states.js';
import { FALLBACK_AGENTS, AGENT_ORDER } from './agents.js';
import { loadSettings, saveSettings, type Settings } from './settings.js';
import { POSES, poseForState, posesDirFor, poseFile, breathAt, type Pose } from './poses.js';
import { PoseAnimator } from './animator.js';

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
 * Ritmo del bucle de animacion. 33 ms = 30 fps, de sobra para una respiracion y
 * un fundido; componer un fotograma cuesta 0,08 ms, asi que el coste real lo
 * pone Qt al reescalar, no nosotros.
 */
const FRAME_MS = 33;
/**
 * Cuanto crece el personaje al inspirar, en tanto por uno. Muy poco a
 * proposito: la respiracion tiene que notarse sin que parezca que late.
 */
const BREATH_SCALE = 0.018;
/** Y cuanto sube, en pixeles. Un avatar que solo escala parece un globo. */
const BREATH_LIFT = 2.5;

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
  /**
   * Poses ya escaladas a la caja del retrato. Se escalan UNA vez al cargar el
   * avatar: reescalar 433x600 en cada fotograma seria tirar CPU por tener el
   * personaje respirando.
   */
  private poses = new Map<Pose, QPixmap>();
  private readonly animator = new PoseAnimator();
  private frameTimer: NodeJS.Timeout | undefined;
  /** Ultima mezcla pintada, para no recomponer un fotograma identico. */
  private lastPainted = '';
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

  /** Se llama al cambiar la config en el menu, para propagar SOLO el cambio. */
  private onSettingsChanged: ((patch: Partial<Settings>) => void) | undefined;
  /** Cambios de modelo, voz y privacidad, que pertenecen a un perfil. */
  private onAvatarSettingsChanged: ((message: AvatarConfigMessage) => void) | undefined;

  /** Microfonos que manda el motor; el menu "Sonido" se llena con ellos. */
  private micDevices: { name: string; isDefault: boolean }[] = [];

  /** Voces disponibles (SAPI locales + Edge nube). */
  private voices: VoiceOption[] = [];
  /** Modelos disponibles, enviados por el registro autoritativo del motor. */
  private models: ModelOption[] = [];

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
   * Cambia el estado: repinta el halo y pide la pose que le toca. La pose no
   * cambia de golpe, se funde (ver PoseAnimator), y siempre pasando por reposo.
   */
  setState(state: AvatarState): void {
    if (state === this.state) return;
    this.state = state;
    this.paintOrb();
    this.layoutVisual();
    this.animator.goTo(poseForState(state), Date.now());
  }

  /**
   * Gesto puntual de saludo: agita la mano y vuelve solo a reposo. No es un
   * estado —el asistente no esta "saludando" mientras dure el turno— sino algo
   * que ocurre una vez, cuando saluda o devuelve el saludo.
   */
  greet(): void {
    if (!this.poses.has('saludo')) return;
    this.animator.gesture('saludo', Date.now());
  }

  /** Registra quien recibe los cambios de config (para mandarlos al motor). */
  setOnSettingsChanged(cb: (patch: Partial<Settings>) => void): void {
    this.onSettingsChanged = cb;
  }

  setOnAvatarSettingsChanged(cb: (message: AvatarConfigMessage) => void): void {
    this.onAvatarSettingsChanged = cb;
  }

  /** Registra quien recibe los mensajes escritos (chat de texto). */
  setOnTextSubmit(cb: (text: string) => void): void {
    this.onTextSubmit = cb;
  }

  /** La config actual, para sincronizar el motor al conectar. */
  getSettings(): Settings {
    return this.settings;
  }

  /** Recibe del motor la lista de microfonos disponibles y cual esta activo. */
  setMicDevices(inputs: { name: string; isDefault: boolean }[], current?: string): void {
    this.micDevices = inputs;
    // El dispositivo activo lo dice el MOTOR: la cache se alinea sin reenviar
    // (antes se descartaba y el menu podia marcar un micro que no era el real).
    if (current !== undefined && current !== this.settings.audioDevice) {
      this.settings = { ...this.settings, audioDevice: current };
      saveSettings(this.settings);
    }
  }

  /**
   * Estado REAL del microfono segun el MOTOR (autoritativo): se refleja en la
   * cache y el boton sin reenviarlo. La cache de esta UI puede venir de otro
   * arranque, y un icono de silencio sobre una captura viva es una mentira de
   * privacidad.
   */
  setMicEnabled(enabled: boolean): void {
    if (this.settings.micEnabled === enabled) return;
    this.settings = { ...this.settings, micEnabled: enabled };
    saveSettings(this.settings);
    this.paintMicButton();
  }

  /**
   * Recibe del motor los perfiles de avatar y cual quedo activo. El motor es
   * quien manda: si rechazo un cambio (p. ej. un avatar de nube en modo
   * confidencial), `current` trae el que de verdad esta puesto y la UI se
   * alinea con el en vez de mentir sobre lo que hay corriendo.
   */
  setAvatarOptions(list: AvatarOption[], current?: string): void {
    this.avatars = list;
    // Sin filtro por catalogo local: el motor es el dueno de la lista, y un
    // avatar que esta UI no conozca se pinta igual (color y arte por imageId).
    if (current && current !== this.settings.agent) {
      this.settings = { ...this.settings, agent: current };
      saveSettings(this.settings);
    }
    this.applyPortrait();
  }

  /** Recibe del motor la lista de voces disponibles (SAPI + Edge). */
  setVoiceOptions(list: VoiceOption[]): void {
    this.voices = list;
  }

  setModelOptions(list: ModelOption[]): void {
    this.models = list;
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
   * Imagen del avatar. El motor manda un imageId (no una ruta): el arte es de
   * la presentacion y se resuelve contra la carpeta de assets LOCAL, asi que
   * motor y avatar pueden vivir en checkouts distintos. Antes de conectar se
   * usa el propio id, que es la convencion de assets/avatars/<id>.png.
   */
  private imageFor(id: string): string {
    const imageId = this.avatars.find((a) => a.id === id)?.imageId ?? id;
    // dist/avatar-window.js -> repoRoot: tres niveles arriba. ALPHA_ASSETS_DIR
    // la mueve (por ejemplo, si el avatar corre desde otro checkout).
    const assetsDir =
      process.env['ALPHA_ASSETS_DIR'] ??
      path.resolve(__dirname, '..', '..', '..', 'assets', 'avatars');
    // Soporta PNG y SVG: intenta SVG primero, luego PNG como fallback.
    const basePath = path.join(assetsDir, imageId);
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
    this.loadPoses(file);
    this.paintOrb();
    this.layoutVisual();
    log(`retrato: ${this.settings.agent} (${scaled.width()}×${scaled.height()})`);
  }

  /**
   * Carga las poses del avatar, si las tiene. Viven en la carpeta hermana del
   * retrato (unit-a.png -> unit-a/), asi que un avatar sin poses simplemente no
   * tiene carpeta y se queda con su imagen fija: nada se rompe por no tenerlas.
   *
   * Se exigen TODAS o ninguna. Con un juego a medias, una transicion se quedaria
   * sin uno de sus extremos y el personaje desapareceria a mitad del fundido.
   */
  private loadPoses(portraitFile: string): void {
    this.poses.clear();
    const dir = posesDirFor(portraitFile);
    const cargadas = new Map<Pose, QPixmap>();
    for (const pose of POSES) {
      const file = poseFile(dir, pose);
      const pix = new QPixmap();
      if (!existsSync(file) || !pix.load(file)) return this.sinPoses(dir);
      cargadas.set(
        pose,
        pix.scaled(
          PORTRAIT_MAX_W,
          PORTRAIT_MAX_H,
          AspectRatioMode.KeepAspectRatio,
          TransformationMode.SmoothTransformation,
        ),
      );
    }
    this.poses = cargadas;
    // El tamano lo marcan las poses, que estan todas en el mismo lienzo; asi el
    // personaje no cambia de escala al cambiar de pose.
    const base = cargadas.get('reposo');
    if (base) this.portraitBase = { w: base.width(), h: base.height() };
    this.startFrames();
    log(`poses de ${this.settings.agent}: ${[...cargadas.keys()].join(', ')}`);
  }

  private sinPoses(dir: string): void {
    this.poses.clear();
    this.stopFrames();
    log(`sin poses para "${this.settings.agent}" (${dir}); retrato fijo`);
  }

  /** Arranca el bucle de animacion. Idempotente. */
  private startFrames(): void {
    if (this.frameTimer) return;
    this.frameTimer = setInterval(() => this.tick(), FRAME_MS);
    // Que el temporizador no impida cerrar el proceso.
    this.frameTimer.unref?.();
  }

  private stopFrames(): void {
    if (!this.frameTimer) return;
    clearInterval(this.frameTimer);
    this.frameTimer = undefined;
  }

  /**
   * Un fotograma. La respiracion es SIEMPRE (mueve la geometria, que es barato)
   * y la mezcla de poses solo cuando hay fundido en curso: en reposo no se
   * recompone ningun pixel.
   */
  private tick(): void {
    if (this.poses.size === 0) return;
    const now = Date.now();
    const frame = this.animator.frameAt(now);

    const clave = frame.moving ? `${frame.from}>${frame.to}@${frame.mix.toFixed(3)}` : frame.to;
    if (clave !== this.lastPainted) {
      this.lastPainted = clave;
      const pix = frame.moving
        ? this.blend(frame.from, frame.to, frame.mix)
        : this.poses.get(frame.to);
      if (pix) this.portrait.setPixmap(pix);
    }

    this.layoutVisual(breathAt(now, STATE_RHYTHMS[this.state].breatheMs));
  }

  /**
   * Mezcla dos poses en una sola imagen. Como estan alineadas por la cabeza y
   * los pies, el torso queda solido y solo se difuminan los brazos: se lee como
   * desenfoque de movimiento y no como una disolvencia.
   */
  private blend(from: Pose, to: Pose, mix: number): QPixmap | undefined {
    const a = this.poses.get(from);
    const b = this.poses.get(to);
    if (!a || !b) return undefined;
    const img = new QImage(a.width(), a.height(), QImageFormat.ARGB32_Premultiplied);
    img.fill(GlobalColor.transparent);
    const p = new QPainter();
    if (!p.begin(img)) return undefined;
    p.setOpacity(1 - mix);
    p.drawPixmap(0, 0, a);
    p.setOpacity(mix);
    p.drawPixmap(0, 0, b);
    p.end();
    return QPixmap.fromImage(img, 0);
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
   * Color de identidad del avatar activo: el que manda el motor, o el del
   * catalogo de respaldo, o el neutro. Nunca revienta con un id desconocido
   * (antes, un quinto avatar en avatars.yaml era un TypeError al elegirlo).
   */
  private activeColor(): OrbColor {
    return (
      this.avatars.find((a) => a.id === this.settings.agent)?.color ??
      FALLBACK_AGENTS[this.settings.agent]?.color ??
      DEFAULT_ORB_COLOR
    );
  }

  /**
   * Estilo del orbe con el color del agente activo. Con retrato pasa a ser un
   * halo tenue detras del personaje; sin el, es la cara del asistente. El
   * ESTADO modula cuanto se enciende (ver stateGlow).
   */
  private paintOrb(): void {
    const [r, g, b] = this.activeColor();
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
    // SOLO el parche: reenviar la cache entera podia resucitar un micEnabled
    // o un microfono rancios si el motor tenia otra cosa (la cache de esta UI
    // es presentacion, no la verdad; la verdad la persiste el motor).
    this.onSettingsChanged?.(patch);
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
      `A.L.P.H.A. — ${active?.name ?? FALLBACK_AGENTS[this.settings.agent]?.label ?? this.settings.agent}`,
      () => {},
      {
        enabled: false,
      },
    );
    menu.addAction(title);
    menu.addSeparator();

    // Cada avatar es un perfil completo. Modelo, voz y privacidad se editan
    // dentro de su submenu y el motor los persiste en avatars.yaml.
    const avatarMenu = addSubmenu(menu, 'Avatar');
    this.menuRefs.push(avatarMenu);
    for (const profile of this.avatarChoices()) {
      const profileMenu = addSubmenu(
        avatarMenu,
        `${profile.name} — ${profile.role}${profile.confidential ? '  (confidencial)' : ''}`,
      );
      this.menuRefs.push(profileMenu);
      profileMenu.addAction(
        this.action('Usar este avatar', () => this.update({ agent: profile.id }), {
          checked: this.settings.agent === profile.id,
        }),
      );

      const modelMenu = addSubmenu(profileMenu, 'Modelo');
      this.menuRefs.push(modelMenu);
      if (this.models.length === 0) {
        modelMenu.addAction(this.action('(motor no conectado)', () => {}, { enabled: false }));
      } else {
        for (const option of this.models) {
          modelMenu.addAction(
            this.action(option.label, () => this.changeAvatar(profile.id, { model: option.ref }), {
              checked: profile.model === option.ref,
              enabled: !profile.confidential || option.local,
            }),
          );
        }
      }

      const voiceMenu = addSubmenu(profileMenu, 'Voz');
      this.menuRefs.push(voiceMenu);
      if (this.voices.length === 0) {
        voiceMenu.addAction(this.action('(enumerando voces...)', () => {}, { enabled: false }));
      } else {
        const currentVoiceId = `${profile.voice.engine}:${profile.voice.name}`;
        for (const option of this.voices) {
          voiceMenu.addAction(
            this.action(option.name, () => this.changeAvatar(profile.id, { voiceId: option.id }), {
              checked: currentVoiceId === option.id,
              enabled: !profile.confidential || option.local,
            }),
          );
        }
      }

      profileMenu.addSeparator();
      profileMenu.addAction(
        this.action('Modo confidencial (sin nube)', () => this.toggleAvatarConfidential(profile), {
          checked: profile.confidential,
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
    return AGENT_ORDER.map((id) => {
      const agent = FALLBACK_AGENTS[id]!;
      return {
        id,
        name: agent.label,
        role: agent.tagline,
        model: '',
        confidential: true,
        voice: { engine: 'sapi' as const, name: '', rate: 0 },
        imageId: id,
        color: agent.color,
      };
    });
  }

  private changeAvatar(avatarId: string, settings: AvatarConfigMessage['settings']): void {
    this.onAvatarSettingsChanged?.({ type: 'avatar-config', avatarId, settings });
  }

  private toggleAvatarConfidential(profile: AvatarOption): void {
    const confidential = !profile.confidential;
    const model = this.models.find((option) => option.ref === profile.model);
    const voiceId = `${profile.voice.engine}:${profile.voice.name}`;
    const voice = this.voices.find((option) => option.id === voiceId);
    const settings: AvatarConfigMessage['settings'] = { confidential };
    // Al activar el modo se elige una combinacion local valida en el mismo
    // comando; nunca se persiste un perfil confidencial que use la nube.
    if (confidential && (!model || !model.local)) {
      const fallback = this.models.find((option) => option.local);
      if (fallback) settings.model = fallback.ref;
    }
    if (confidential && (!voice || !voice.local)) {
      const fallback = this.voices.find((option) => option.local);
      if (fallback) settings.voiceId = fallback.id;
    }
    this.changeAvatar(profile.id, settings);
  }

  /**
   * Coloca retrato y halo. El TAMANO del halo depende del estado —es lo que
   * hace distinguibles escuchando, pensando y hablando de un vistazo— y el
   * retrato respira: `breath` (-1..1) lo escala y lo levanta un poco.
   *
   * La respiracion se hace moviendo la GEOMETRIA, no repintando pixeles: la
   * etiqueta tiene setScaledContents, asi que Qt reescala el pixmap ya cargado.
   * Sale gratis comparado con recomponer la imagen en cada fotograma.
   */
  private layoutVisual(breath = 0): void {
    const radius = BASE_RADIUS + STATE_RHYTHMS[this.state].pulse;
    this.orb.setGeometry(
      Math.round(ORB_CX - radius),
      Math.round(ORB_CY - radius),
      radius * 2,
      radius * 2,
    );
    if (!this.portraitBase) return;
    const { w, h } = this.portraitBase;
    const escala = 1 + BREATH_SCALE * breath;
    const bw = Math.round(w * escala);
    const bh = Math.round(h * escala);
    const alza = Math.round(BREATH_LIFT * breath);
    // Anclado por abajo: los pies del personaje quedan al ras del bocadillo, y
    // al inspirar crece hacia ARRIBA en vez de hundirse en el suelo.
    this.portrait.setGeometry(Math.round(ORB_CX - bw / 2), VISUAL_BOTTOM - bh - alza, bw, bh);
  }

  dispose(): void {
    if (this.captionTimer) clearTimeout(this.captionTimer);
    this.stopFrames();
  }
}
