import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { VisualsRepository } from './repositories/visuals.repository';
import { DEFAULT_VISUALS } from './default-visuals';
import {
  VISUAL_CATEGORIES,
  VISUAL_PREVIEW_KEYS,
  VISUAL_PREVIEW_NONE,
} from './entities/visual-chart.entity';
import type {
  VisualChart,
  VisualChartInput,
} from './entities/visual-chart.entity';
import type { CreateVisualDto } from './dto/create-visual.dto';
import type { UpdateVisualDto } from './dto/update-visual.dto';
import { SPEC_CHART_FORMS } from '../sessions/visual-spec';

const MAX_NAME = 80;
const MAX_CATEGORY = 60;
const MAX_TEXT = 1000;
const MAX_DATA_SHAPE = 200;

const lower = (value: string) => value.trim().toLowerCase();

@Injectable()
export class VisualsService implements OnModuleInit {
  private readonly logger = new Logger(VisualsService.name);

  constructor(private readonly repository: VisualsRepository) {}

  /** Seeds the default catalog on backend start. */
  async onModuleInit(): Promise<void> {
    try {
      await this.seedDefaults();
    } catch (err) {
      // A failed seed never stops the backend; it is retried next start.
      this.logger.warn(
        `Default visuals not seeded: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Inserts every default chart whose name is not taken, once per data dir:
   * skipped when the seed marker is present (so a deleted default stays
   * deleted); the marker is written afterwards.
   */
  async seedDefaults(): Promise<void> {
    if (await this.repository.isSeeded()) return;
    const taken = new Set(
      (await this.repository.list()).map((c) => lower(c.name)),
    );
    for (const def of DEFAULT_VISUALS) {
      if (taken.has(lower(def.name))) continue;
      const now = new Date().toISOString();
      await this.repository.insert({
        id: randomUUID(),
        ...def,
        builtIn: true,
        createdAt: now,
        updatedAt: now,
      });
    }
    await this.repository.markSeeded();
  }

  /**
   * Shipped categories first in their order, other categories after
   * alphabetically; within a category by name, case-insensitive.
   */
  async list(): Promise<VisualChart[]> {
    const all = await this.repository.list();
    const rank = (category: string) => {
      const i = VISUAL_CATEGORIES.findIndex(
        (c) => lower(c) === lower(category),
      );
      return i === -1 ? VISUAL_CATEGORIES.length : i;
    };
    const cmp = (a: string, b: string) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' });
    return [...all].sort(
      (a, b) =>
        rank(a.category) - rank(b.category) ||
        cmp(a.category, b.category) ||
        cmp(a.name, b.name),
    );
  }

  async create(dto: CreateVisualDto): Promise<VisualChart> {
    const clean = validate(dto, true) as VisualChartInput;
    await this.assertNameFree(clean.name);
    const now = new Date().toISOString();
    return this.repository.insert({
      id: randomUUID(),
      ...clean,
      builtIn: false,
      createdAt: now,
      updatedAt: now,
    });
  }

  async update(id: string, dto: UpdateVisualDto): Promise<VisualChart> {
    const existing = await this.repository.get(id);
    if (!existing) throw new NotFoundException('Chart not found');
    const patch = validate(dto, false);
    if (patch.name !== undefined) await this.assertNameFree(patch.name, id);
    const saved = await this.repository.update(id, {
      ...patch,
      updatedAt: new Date().toISOString(),
    });
    if (!saved) throw new NotFoundException('Chart not found');
    return saved;
  }

  async delete(id: string): Promise<void> {
    const existing = await this.repository.get(id);
    if (!existing) throw new NotFoundException('Chart not found');
    await this.repository.delete(id);
  }

  private async assertNameFree(name: string, exceptId?: string): Promise<void> {
    const key = lower(name);
    const all = await this.repository.list();
    if (all.some((c) => c.id !== exceptId && lower(c.name) === key)) {
      throw new ConflictException(`A chart named "${name}" already exists`);
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
  dto: UpdateVisualDto | CreateVisualDto,
  full: boolean,
): Partial<VisualChartInput> {
  const input = (dto ?? {}) as Record<string, unknown>;
  const has = (key: string) => full || input[key] !== undefined;
  const out: Partial<VisualChartInput> = {};

  if (has('name')) {
    const name = text(input.name);
    if (!name) throw new BadRequestException('Name is required');
    if (name.length > MAX_NAME) {
      throw new BadRequestException(`Name is at most ${MAX_NAME} characters`);
    }
    out.name = name;
  }
  if (has('category')) {
    const category = text(input.category);
    if (!category) throw new BadRequestException('Category is required');
    if (category.length > MAX_CATEGORY) {
      throw new BadRequestException(
        `Category is at most ${MAX_CATEGORY} characters`,
      );
    }
    out.category = category;
  }
  if (has('previewKey')) {
    const previewKey = input.previewKey ?? VISUAL_PREVIEW_NONE;
    if (
      previewKey !== VISUAL_PREVIEW_NONE &&
      !(VISUAL_PREVIEW_KEYS as readonly unknown[]).includes(previewKey)
    ) {
      throw new BadRequestException('Unknown preview');
    }
    out.previewKey = previewKey as string;
  }
  if (has('rendererForm')) {
    const form = input.rendererForm ?? null;
    if (
      form !== null &&
      !(SPEC_CHART_FORMS as readonly unknown[]).includes(form)
    ) {
      throw new BadRequestException('Unknown renderer form');
    }
    out.rendererForm = form as string | null;
  }
  const limited: [keyof VisualChartInput, string, number, string][] = [
    ['description', 'Description', MAX_TEXT, '1,000'],
    ['whenToUse', 'When to use', MAX_TEXT, '1,000'],
    ['whenToAvoid', 'When to avoid', MAX_TEXT, '1,000'],
    ['dataShape', 'Data needed', MAX_DATA_SHAPE, '200'],
  ];
  for (const [key, label, max, shown] of limited) {
    if (!has(key)) continue;
    const value = text(input[key]);
    if (value.length > max) {
      throw new BadRequestException(`${label} is at most ${shown} characters`);
    }
    (out as Record<string, unknown>)[key] = value;
  }
  if (has('enabled')) {
    const enabled = input.enabled ?? true;
    if (typeof enabled !== 'boolean') {
      throw new BadRequestException('Enabled must be true or false');
    }
    out.enabled = enabled;
  }
  return out;
}
