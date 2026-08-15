import { readdir, readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { Skill, SkillRequires, SkippedSkill } from './types.js';

/**
 * Carga las skills de un directorio. Cada skill es una subcarpeta con un
 * SKILL.md (frontmatter YAML + cuerpo markdown). Aplica el filtrado por
 * dependencias: una skill que declara `requires` solo se carga si el equipo las
 * cumple (SO y binarios en el PATH).
 */
export async function loadSkills(
  skillsDir: string,
): Promise<{ skills: Skill[]; skipped: SkippedSkill[] }> {
  const skills: Skill[] = [];
  const skipped: SkippedSkill[] = [];

  let entries: string[];
  try {
    entries = await readdir(skillsDir);
  } catch {
    return { skills, skipped }; // no hay directorio de skills todavia
  }

  for (const entry of entries) {
    const dir = path.join(skillsDir, entry);
    const file = path.join(dir, 'SKILL.md');
    let raw: string;
    try {
      raw = await readFile(file, 'utf8');
    } catch {
      continue; // no es una carpeta de skill
    }

    const parsed = parseSkillFile(raw);
    if (!parsed) {
      skipped.push({ name: entry, reason: 'SKILL.md sin frontmatter valido (name/description)' });
      continue;
    }

    // Cuarentena ANTES que nada: una skill que nadie ha aprobado no se carga,
    // no entra en el prompt del sistema y usar_skill no la encuentra. Es lo que
    // impide que una inyeccion de prompt se convierta en instrucciones
    // permanentes para todas las sesiones siguientes.
    if (parsed.pending) {
      skipped.push({
        name: parsed.name,
        reason: 'pendiente de aprobar: revisa su SKILL.md y quita "pending: true"',
      });
      continue;
    }

    const unmet = await checkRequires(parsed.requires);
    if (unmet) {
      skipped.push({ name: parsed.name, reason: unmet });
      continue;
    }

    skills.push({
      name: parsed.name,
      description: parsed.description,
      body: parsed.body,
      ...(parsed.requires ? { requires: parsed.requires } : {}),
      dir,
    });
  }

  return { skills, skipped };
}

interface ParsedSkill {
  name: string;
  description: string;
  body: string;
  requires?: SkillRequires;
  /** En cuarentena: la creo el agente y nadie la ha aprobado todavia. */
  pending?: boolean;
}

/** Separa el frontmatter YAML del cuerpo y valida los campos minimos. */
function parseSkillFile(raw: string): ParsedSkill | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) return undefined;

  let front: Record<string, unknown>;
  try {
    front = (parseYaml(match[1]!) ?? {}) as Record<string, unknown>;
  } catch {
    return undefined;
  }

  const name = typeof front['name'] === 'string' ? front['name'] : undefined;
  const description = typeof front['description'] === 'string' ? front['description'] : undefined;
  if (!name || !description) return undefined;

  const requires = normalizeRequires(front['requires']);
  return {
    name,
    description,
    body: (match[2] ?? '').trim(),
    ...(requires ? { requires } : {}),
    ...(front['pending'] === true ? { pending: true } : {}),
  };
}

function normalizeRequires(value: unknown): SkillRequires | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  const toArray = (x: unknown): string[] | undefined =>
    Array.isArray(x) ? x.filter((i): i is string => typeof i === 'string') : undefined;
  const bin = toArray(v['bin']);
  const os = toArray(v['os']);
  if (!bin && !os) return undefined;
  return { ...(bin ? { bin } : {}), ...(os ? { os } : {}) };
}

/** Devuelve el motivo si algun requisito no se cumple, o undefined si todo ok. */
async function checkRequires(requires: SkillRequires | undefined): Promise<string | undefined> {
  if (!requires) return undefined;

  if (requires.os && !requires.os.includes(process.platform)) {
    return `requiere SO ${requires.os.join('/')}, y este es ${process.platform}`;
  }

  for (const bin of requires.bin ?? []) {
    if (!(await hasBinary(bin))) return `falta el binario "${bin}" en el PATH`;
  }
  return undefined;
}

/** ¿Esta el ejecutable en alguno de los directorios del PATH? */
async function hasBinary(name: string): Promise<boolean> {
  const dirs = (process.env['PATH'] ?? '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      try {
        await access(path.join(dir, name + ext), constants.X_OK);
        return true;
      } catch {
        // sigue buscando
      }
    }
  }
  return false;
}
