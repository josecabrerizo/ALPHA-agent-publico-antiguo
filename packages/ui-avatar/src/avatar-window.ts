import {
  QMainWindow,
  QWidget,
  QMenu,
  QAction,
  QPoint,
  QMouseEvent,
  WidgetAttribute,
  WindowType,
  WidgetEventTypes,
  MouseButton,
} from '@nodegui/nodegui';
import { STATE_RHYTHMS, STATE_CYCLE, MAX_PULSE, type AvatarState } from './states.js';
import { AGENTS, AGENT_ORDER, type AgentId } from './agents.js';
import { loadSettings, saveSettings, MODEL_OPTIONS, type Settings } from './settings.js';

const WINDOW_SIZE = 200; // lienzo; el orbe pulsa dentro con margen de sobra
const BASE_RADIUS = 62;

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

/**
 * Ventana flotante del avatar: frameless, translucida, siempre encima y
 * arrastrable. El agente elegido da el color del orbe; el estado, su ritmo.
 * Clic derecho abre el menu de configuracion del asistente.
 */
export class AvatarWindow {
  private readonly win = new QMainWindow();
  private readonly root = new QWidget();
  private readonly orb = new QWidget();

  private settings: Settings = loadSettings();
  private state: AvatarState = 'reposo';
  private timer: NodeJS.Timeout | undefined;
  private phase = 0;

  // El menu y sus acciones se guardan para que el GC no se los lleve mientras
  // estan en pantalla.
  private menu: QMenu | undefined;
  private menuRefs: (QMenu | QAction)[] = [];

  private dragging = false;
  private dragDX = 0;
  private dragDY = 0;

  constructor() {
    this.setupWindow();
    this.setupOrb();
    this.setupMouse();
    this.startBreathing();
  }

  show(): void {
    this.win.show();
  }

  setState(state: AvatarState): void {
    this.state = state;
  }

  private setupWindow(): void {
    this.win.setWindowFlag(WindowType.FramelessWindowHint, true);
    this.win.setWindowFlag(WindowType.WindowStaysOnTopHint, true);
    this.win.setWindowFlag(WindowType.Tool, true);
    this.win.setAttribute(WidgetAttribute.WA_TranslucentBackground, true);
    this.win.resize(WINDOW_SIZE, WINDOW_SIZE);
    this.win.setFixedSize(WINDOW_SIZE, WINDOW_SIZE);

    this.root.setInlineStyle('background: transparent;');
    this.win.setCentralWidget(this.root);
  }

  private setupOrb(): void {
    this.orb.setParent(this.root);
    this.paintOrb();
  }

  /** Estilo del orbe: color del agente activo, degradado radial y halo. */
  private paintOrb(): void {
    const [r, g, b] = AGENTS[this.settings.agent].color;
    const lighten = (c: number) => Math.min(255, c + 45);
    const darken = (c: number) => Math.round(c * 0.5);
    this.orb.setInlineStyle(`
      background: qradialgradient(
        cx: 0.5, cy: 0.42, radius: 0.75,
        fx: 0.5, fy: 0.42,
        stop: 0 rgba(${lighten(r)}, ${lighten(g)}, ${lighten(b)}, 245),
        stop: 0.55 rgba(${r}, ${g}, ${b}, 225),
        stop: 1 rgba(${darken(r)}, ${darken(g)}, ${darken(b)}, 90)
      );
      border-radius: ${CIRCLE_RADIUS}px;
      border: 2px solid rgba(255, 255, 255, 60);
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
    this.paintOrb();
  }

  private action(text: string, onTrigger: () => void, opts: { checked?: boolean; enabled?: boolean } = {}): QAction {
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

    const title = this.action(`A.L.P.H.A. — ${AGENTS[this.settings.agent].label}`, () => {}, { enabled: false });
    menu.addAction(title);
    menu.addSeparator();

    // Avatar
    const avatarMenu = addSubmenu(menu, 'Avatar');
    this.menuRefs.push(avatarMenu);
    for (const id of AGENT_ORDER) {
      const agent = AGENTS[id];
      avatarMenu.addAction(
        this.action(`${agent.label} — ${agent.tagline}`, () => this.update({ agent: id }), {
          checked: this.settings.agent === id,
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

  private toggleConfidential(): void {
    const confidential = !this.settings.confidential;
    // Al activar confidencial con un modelo de nube seleccionado, se cae al
    // modelo local por defecto para no quedar en un estado imposible.
    const current = MODEL_OPTIONS.find((m) => m.ref === this.settings.model);
    const model =
      confidential && current && !current.local
        ? (MODEL_OPTIONS.find((m) => m.local)?.ref ?? this.settings.model)
        : this.settings.model;
    this.update({ confidential, model });
  }

  /**
   * "Respiracion": el orbe crece y mengua con una sinusoide, recentrandose en
   * el lienzo. El ritmo lo marca el estado actual.
   */
  private startBreathing(): void {
    const FPS = 30;
    this.timer = setInterval(() => {
      const { breatheMs, pulse } = STATE_RHYTHMS[this.state];
      this.phase += (1000 / FPS / breatheMs) * 2 * Math.PI;
      const radius = BASE_RADIUS + Math.sin(this.phase) * pulse;
      const center = WINDOW_SIZE / 2;
      this.orb.setGeometry(
        Math.round(center - radius),
        Math.round(center - radius),
        Math.round(radius * 2),
        Math.round(radius * 2),
      );
    }, 1000 / FPS);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
