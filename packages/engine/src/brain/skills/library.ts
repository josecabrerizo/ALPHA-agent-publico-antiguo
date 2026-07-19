import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadSkills } from './loader.js';
import type { Skill, SkippedSkill } from './types.js';
import type { Tool } from '../tools/types.js';

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
        const nombre = String(args['nombre'] ?? '').trim();
        const skill = this.skills.get(nombre);
        if (!skill) {
          const disponibles = this.list().map((s) => s.name).join(', ') || '(ninguna)';
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
        return this.list().map((s) => `- ${s.name}: ${s.description}`).join('\n');
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
      run: async (args) => {
        const slug = slugify(String(args['nombre'] ?? ''));
        const descripcion = String(args['descripcion'] ?? '').trim();
        const contenido = String(args['contenido'] ?? '').trim();
        if (!slug) return 'Nombre de skill invalido.';
        if (!descripcion || !contenido) return 'Faltan la descripcion o el contenido.';

        const dir = path.join(this.skillsDir, slug);
        const md = `---\nname: ${slug}\ndescription: ${descripcion}\n---\n\n${contenido}\n`;
        try {
          await mkdir(dir, { recursive: true });
          await writeFile(path.join(dir, 'SKILL.md'), md, 'utf8');
          await this.load(); // recargar para que quede disponible ya
          return `Skill "${slug}" creada y disponible.`;
        } catch (error) {
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
