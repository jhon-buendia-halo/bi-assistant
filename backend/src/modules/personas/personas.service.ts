import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PersonasRepository } from './repositories/personas.repository';
import { DEMO_PERSONA } from './demo-persona';
import { PERSONA_EXPERTISE_LEVELS } from './entities/user-persona.entity';
import type {
  PersonaExpertise,
  UserPersona,
  UserPersonaInput,
} from './entities/user-persona.entity';
import type { CreatePersonaDto } from './dto/create-persona.dto';
import type { UpdatePersonaDto } from './dto/update-persona.dto';

const MAX_NAME = 80;
const MAX_ROLE = 80;
const MAX_DESCRIPTION = 2000;
const MAX_GOALS = 2000;
const MAX_QUESTIONS = 10;
const MAX_QUESTION = 300;
const MAX_ANSWER_STYLE = 500;

@Injectable()
export class PersonasService implements OnModuleInit {
  private readonly logger = new Logger(PersonasService.name);

  constructor(private readonly repository: PersonasRepository) {}

  /** Seeds the default personas on backend start (user-personas R13). */
  async onModuleInit(): Promise<void> {
    try {
      await this.seedDefaults();
    } catch (err) {
      // A failed seed never stops the backend; it is retried next start.
      this.logger.warn(
        `Default personas not seeded: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Adds the demo persona once per data dir: skipped when the seed marker is
   * present (so a deleted demo persona stays deleted) or when a persona of
   * that name already exists; the marker is written either way.
   */
  async seedDefaults(): Promise<void> {
    if (await this.repository.isSeeded()) return;
    const taken = (await this.repository.list()).some(
      (p) =>
        p.name.trim().toLowerCase() === DEMO_PERSONA.name.trim().toLowerCase(),
    );
    if (!taken) await this.create({ ...DEMO_PERSONA });
    await this.repository.markSeeded();
  }

  /** Sorted by name, case-insensitive. */
  async list(): Promise<UserPersona[]> {
    const all = await this.repository.list();
    return [...all].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    );
  }

  async create(dto: CreatePersonaDto): Promise<UserPersona> {
    const clean = validate(dto, true) as UserPersonaInput;
    await this.assertNameFree(clean.name);
    const now = new Date().toISOString();
    return this.repository.insert({
      id: randomUUID(),
      ...clean,
      createdAt: now,
      updatedAt: now,
    });
  }

  async update(id: string, dto: UpdatePersonaDto): Promise<UserPersona> {
    const existing = await this.repository.get(id);
    if (!existing) throw new NotFoundException('Persona not found');
    const patch = validate(dto, false);
    if (patch.name !== undefined) await this.assertNameFree(patch.name, id);
    const saved = await this.repository.update(id, {
      ...patch,
      updatedAt: new Date().toISOString(),
    });
    if (!saved) throw new NotFoundException('Persona not found');
    return saved;
  }

  async delete(id: string): Promise<void> {
    const existing = await this.repository.get(id);
    if (!existing) throw new NotFoundException('Persona not found');
    await this.repository.delete(id);
  }

  private async assertNameFree(name: string, exceptId?: string): Promise<void> {
    const key = name.trim().toLowerCase();
    const all = await this.repository.list();
    const taken = all.some(
      (p) => p.id !== exceptId && p.name.trim().toLowerCase() === key,
    );
    if (taken) {
      throw new ConflictException(`A persona named "${name}" already exists`);
    }
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Validates and normalises a payload. On create (`full`) absent fields take
 * their defaults; on update only the present fields are returned.
 */
function validate(
  dto: UpdatePersonaDto | CreatePersonaDto,
  full: boolean,
): Partial<UserPersonaInput> {
  const input = (dto ?? {}) as Record<string, unknown>;
  const has = (key: string) => full || input[key] !== undefined;
  const out: Partial<UserPersonaInput> = {};

  if (has('name')) {
    const name = text(input.name);
    if (!name) throw new BadRequestException('Name is required');
    if (name.length > MAX_NAME) {
      throw new BadRequestException(`Name is at most ${MAX_NAME} characters`);
    }
    out.name = name;
  }
  if (has('role')) {
    const role = text(input.role);
    if (role.length > MAX_ROLE) {
      throw new BadRequestException(`Role is at most ${MAX_ROLE} characters`);
    }
    out.role = role;
  }
  if (has('description')) {
    const description = text(input.description);
    if (description.length > MAX_DESCRIPTION) {
      throw new BadRequestException('Description is at most 2,000 characters');
    }
    out.description = description;
  }
  if (has('goals')) {
    const goals = text(input.goals);
    if (goals.length > MAX_GOALS) {
      throw new BadRequestException('Goals are at most 2,000 characters');
    }
    out.goals = goals;
  }
  if (has('typicalQuestions')) {
    const raw = input.typicalQuestions ?? [];
    if (!Array.isArray(raw)) {
      throw new BadRequestException('Typical questions must be an array');
    }
    const questions = raw.map(text).filter((q) => q.length > 0);
    if (questions.length > MAX_QUESTIONS) {
      throw new BadRequestException(
        `At most ${MAX_QUESTIONS} typical questions`,
      );
    }
    if (questions.some((q) => q.length > MAX_QUESTION)) {
      throw new BadRequestException(
        `A typical question is at most ${MAX_QUESTION} characters`,
      );
    }
    out.typicalQuestions = questions;
  }
  if (has('expertise')) {
    const expertise = input.expertise ?? 'intermediate';
    if (!PERSONA_EXPERTISE_LEVELS.includes(expertise as PersonaExpertise)) {
      throw new BadRequestException(
        'Expertise must be novice, intermediate or expert',
      );
    }
    out.expertise = expertise as PersonaExpertise;
  }
  if (has('answerStyle')) {
    const answerStyle = text(input.answerStyle);
    if (answerStyle.length > MAX_ANSWER_STYLE) {
      throw new BadRequestException(
        `Answer style is at most ${MAX_ANSWER_STYLE} characters`,
      );
    }
    out.answerStyle = answerStyle;
  }
  return out;
}
