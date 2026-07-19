/**
 * Skills al estilo del estandar AgentSkills (el mismo SKILL.md que usan Hermes,
 * OpenClaw y Claude). Una skill NO es codigo: es un fichero markdown que le
 * ensena al agente COMO encadenar sus herramientas para un flujo concreto
 * ("documentar una reunion", "revisar codigo"...). Portable: una skill de
 * ClawHub cae en skills/ y funciona.
 *
 * El agente ve solo el nombre y la descripcion de cada skill; carga el cuerpo
 * completo bajo demanda (herramienta usar_skill). Es la "revelacion progresiva"
 * que evita llenar el contexto con todas las instrucciones a la vez.
 */

/** Requisitos para que una skill este disponible (idea de OpenClaw). */
export interface SkillRequires {
  /** Binarios que deben estar en el PATH (p. ej. ffmpeg). */
  bin?: string[];
  /** Plataformas soportadas (process.platform: win32, linux, darwin). */
  os?: string[];
}

export interface Skill {
  name: string;
  description: string;
  /** El markdown tras el frontmatter: las instrucciones para el agente. */
  body: string;
  requires?: SkillRequires;
  /** Carpeta de la skill, para recursos que referencie y para reescribirla. */
  dir: string;
}

/** Skill que existe pero no se cargo, y por que (dependencia sin cumplir). */
export interface SkippedSkill {
  name: string;
  reason: string;
}
