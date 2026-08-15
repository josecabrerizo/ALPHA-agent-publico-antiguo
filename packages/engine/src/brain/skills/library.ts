import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { loadSkills } from './loader.js';
import type { Skill, SkippedSkill } from './types.js';
import { textArg, type Tool } from '../tools/types.js';

/**
 * Biblioteca de skills: las carga del disco, arma la seccion del prompt que le
 * dice al agente cuales tiene, y expone las herramientas para usarlas, listarlas
 * y —el objetivo— crear las suyas propias.
 */
export class SkillLibrary {
  private skills = new Map<string, Skill>();
  private skipped: SkippedSkill[] = [];

  constructor(private readonly skillsDir: string) {}

  async load(): Promise<void> {
    const { skills, skipped } = await loadSkills(this.skillsDir);
    this.skills = new Map(skills.map((s) => [s.name, s]));
    this.skipped = skipped;
  }

  list(): Skill[] {
    return [...this.skills.values()];
  }

  skippedSkills(): SkippedSkill[] {
    return this.skipped;
  }

  /**
   * Seccion para el prompt del sistema: los nombres y descripciones (no los
   * cuerpos). El agente carga el cuerpo con usar_skill solo cuando le hace falta.
   */
  promptSection(): string {
    if (this.skills.size === 0) return '';
    const lines = this.list()
      .map((s) => `- ${s.name}: ${s.description}`)
      .join('\n');
    return (
      'Tienes SKILLS (procedimientos paso a paso) disponibles. Cuando una encaje ' +
      'con lo que te piden, cargala con la herramienta usar_skill(nombre) y sigue ' +
      'sus instrucciones al pie de la letra:\n' +
      lines
    );
  }

  /** Herramientas que el agente registra para trabajar con skills. */
  tools(): Tool[] {
    return [this.usarSkillTool(), this.listarSkillsTool(), this.crearSkillTool()];
  }

  private usarSkillTool(): Tool {
    return {
      name: 'usar_skill',
      description:
        'Carga las instrucciones completas de una skill por su nombre y las ' +
        'devuelve para que las sigas. Usala en cuanto una skill encaje con la tarea.',
      parameters: {
        type: 'object',
        properties: { nombre: { type: 'string', description: 'Nombre exacto de la skill' } },
        required: ['nombre'],
      },
      run: async (args) => {
        const nombre = textArg(args, 'nombre');
        const skill = this.skills.get(nombre);
        if (!skill) {
          const disponibles =
            this.list()
              .map((s) => s.name)
              .join(', ') || '(ninguna)';
          return `No existe la skill "${nombre}". Disponibles: ${disponibles}.`;
        }
        return `Instrucciones de la skill "${skill.name}":\n\n${skill.body}`;
      },
    };
  }

  private listarSkillsTool(): Tool {
    return {
      name: 'listar_skills',
      description: 'Lista las skills disponibles con su descripcion.',
      parameters: { type: 'object', properties: {} },
      run: async () => {
        if (this.skills.size === 0) return 'No hay skills disponibles todavia.';
        return this.list()
          .map((s) => `- ${s.name}: ${s.description}`)
          .join('\n');
      },
    };
  }

  private crearSkillTool(): Tool {
    return {
      name: 'crear_skill',
      description:
        'Crea una skill nueva (un procedimiento reutilizable) escribiendo su ' +
        'SKILL.md. Usala cuando aprendas una forma repetible de hacer algo que ' +
        'convenga recordar. El contenido son instrucciones en markdown.',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: 'Nombre corto en minusculas-con-guiones' },
          descripcion: { type: 'string', description: 'Una linea: que hace y cuando usarla' },
          contenido: { type: 'string', description: 'Las instrucciones paso a paso, en markdown' },
        },
        required: ['nombre', 'descripcion', 'contenido'],
      },
      destructive: true,
      run: async (args) => {
        const slug = slugify(textArg(args, 'nombre'));
        // La descripcion va en el frontmatter y se declara "una linea": se
        // aplasta a una. Es tambien la primera barrera contra que un salto de
        // linea abra claves nuevas ahi dentro.
        const descripcion = textArg(args, 'descripcion').replace(/\s+/g, ' ');
        const contenido = textArg(args, 'contenido');
        if (!slug) return 'Nombre de skill invalido.';
        if (!descripcion || !contenido) return 'Faltan la descripcion o el contenido.';

        const dir = path.join(this.skillsDir, slug);
        const destino = path.join(dir, 'SKILL.md');

        // Nunca se pisa una skill existente: reescribirla en silencio permitiria
        // secuestrar un procedimiento en el que el usuario ya confia.
        try {
          await access(destino);
          return `Ya existe una skill "${slug}". Elige otro nombre; para cambiar la que hay, tiene que editarla una persona.`;
        } catch {
          // no existe: adelante
        }

        // El frontmatter se SERIALIZA, no se interpola. Con plantillas, una
        // descripcion con un salto de linea metia claves arbitrarias (requires,
        // y cualquier campo que este formato gane en el futuro).
        const front = stringifyYaml({
          name: slug,
          description: descripcion,
          // En cuarentena hasta que una persona la apruebe. El agente propone;
          // no se auto-concede instrucciones permanentes.
          pending: true,
        }).trimEnd();
        const md = `---\n${front}\n---\n\n${contenido}\n`;

        const temporal = `${destino}.${process.pid}.tmp`;
        try {
          await mkdir(dir, { recursive: true });
          // Escritura atomica: si esto se corta a medias, no queda un SKILL.md
          // truncado que el cargador interpretaria como pueda.
          await writeFile(temporal, md, 'utf8');
          await rename(temporal, destino);
          await this.load(); // que aparezca ya en la lista de pendientes
          return (
            `Skill "${slug}" escrita en ${destino}, PENDIENTE DE APROBACION. ` +
            `No esta activa y no puedes usarla todavia: una persona tiene que ` +
            `revisarla y quitarle "pending: true".`
          );
        } catch (error) {
          await rm(temporal, { force: true }).catch(() => {});
          return `No se pudo crear la skill: ${(error as Error).message}`;
        }
      },
    };
  }
}

/** Nombre seguro para carpeta: minusculas, guiones, sin travesias de ruta. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
