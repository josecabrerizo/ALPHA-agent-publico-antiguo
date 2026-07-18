import {
  QMainWindow,
  QWidget,
  QMouseEvent,
  WidgetAttribute,
  WindowType,
  WidgetEventTypes,
  MouseButton,
} from '@nodegui/nodegui';
import { STATE_STYLES, STATE_CYCLE, type AvatarState } from './states.js';

const WINDOW_SIZE = 200; // lienzo; el orbe pulsa dentro con margen de sobra
const BASE_RADIUS = 62;
// El orbe mas grande posible (radio base + el pulso mas amplio de todos los
// estados). Qt recorta border-radius a la mitad del tamano, asi que fijarlo en
// este maximo garantiza un circulo perfecto sea cual sea el tamano del latido.
const MAX_RADIUS = BASE_RADIUS + Math.max(...Object.values(STATE_STYLES).map((s) => s.pulse));

/**
 * Ventana flotante del avatar: frameless, translucida, siempre encima y
 * arrastrable. De momento pinta un orbe que "respira" como marcador de
 * posicion del personaje; la mecanica de ventana es lo definitivo.
 */
export class AvatarWindow {
  private readonly win = new QMainWindow();
  private readonly root = new QWidget();
  private readonly orb = new QWidget();

  private state: AvatarState = 'reposo';
  private timer: NodeJS.Timeout | undefined;
  private phase = 0;

  // Arrastre: desfase entre el cursor y la esquina de la ventana al pulsar.
  private dragging = false;
  private dragDX = 0;
  private dragDY = 0;

  constructor() {
    this.setupWindow();
    this.setupOrb();
    this.setupDrag();
    this.startBreathing();
  }

  show(): void {
    this.win.show();
  }

  /** Cambia el estado (color y ritmo). Lo llamara el motor via IPC mas adelante. */
  setState(state: AvatarState): void {
    this.state = state;
    this.paintOrb();
  }

  private setupWindow(): void {
    // Sin marco, siempre encima, y Tool para no salir en la barra de tareas.
    this.win.setWindowFlag(WindowType.FramelessWindowHint, true);
    this.win.setWindowFlag(WindowType.WindowStaysOnTopHint, true);
    this.win.setWindowFlag(WindowType.Tool, true);
    // Fondo translucido: solo se ve lo que pintemos, no un rectangulo.
    this.win.setAttribute(WidgetAttribute.WA_TranslucentBackground, true);
    this.win.resize(WINDOW_SIZE, WINDOW_SIZE);
    this.win.setFixedSize(WINDOW_SIZE, WINDOW_SIZE);

    // Fondo del lienzo transparente (propiedades directas: un selector #root
    // aqui no lo parsea Qt). La translucidez real la da WA_TranslucentBackground.
    this.root.setInlineStyle('background: transparent;');
    this.win.setCentralWidget(this.root);
  }

  private setupOrb(): void {
    this.orb.setParent(this.root);
    this.paintOrb();
  }

  /** Estilo del orbe segun el estado: circulo con degradado radial y halo. */
  private paintOrb(): void {
    const [r, g, b] = STATE_STYLES[this.state].color;
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
      border-radius: ${MAX_RADIUS}px;
      border: 2px solid rgba(255, 255, 255, 60);
    `);
  }

  private setupDrag(): void {
    this.root.addEventListener(WidgetEventTypes.MouseButtonPress, (e) => {
      const ev = new QMouseEvent(e as ConstructorParameters<typeof QMouseEvent>[0]);
      if (ev.button() === MouseButton.RightButton) {
        this.cycleState();
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

    // Doble clic para cerrar, mientras no hay bandeja ni menu.
    this.root.addEventListener(WidgetEventTypes.MouseButtonDblClick, () => {
      this.win.close();
    });
  }

  private cycleState(): void {
    const next = (STATE_CYCLE.indexOf(this.state) + 1) % STATE_CYCLE.length;
    this.setState(STATE_CYCLE[next]!);
  }

  /**
   * "Respiracion": el orbe crece y mengua con una sinusoide, recentrandose en
   * el lienzo en cada paso. Se conduce con un temporizador en vez de
   * QPropertyAnimation para no depender de que propiedad expone NodeGui.
   */
  private startBreathing(): void {
    const FPS = 30;
    this.timer = setInterval(() => {
      const { breatheMs, pulse } = STATE_STYLES[this.state];
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
