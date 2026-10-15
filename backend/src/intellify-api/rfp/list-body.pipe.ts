import { BadRequestException, PipeTransform, Type } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';

/** Flattens class-validator errors (nested ones too) into messages. */
function messages(errors: ValidationError[], prefix = ''): string[] {
  return errors.flatMap((error) => [
    ...Object.values(error.constraints ?? {}).map((m) => `${prefix}${m}`),
    ...messages(error.children ?? [], `${prefix}${error.property}.`),
  ]);
}

/**
 * Validates a JSON array body item by item against `item` (the `PUT` list
 * routes, I24-I27). Problems answer `400 validation` with one detail per
 * problem, prefixed `Item <n>:` (1-based, the item's future position).
 */
export class ListBodyPipe<T extends object> implements PipeTransform {
  constructor(private readonly item: Type<T>) {}

  async transform(value: unknown): Promise<T[]> {
    if (!Array.isArray(value)) {
      throw new BadRequestException(['the body must be a JSON array']);
    }
    const out: T[] = [];
    const problems: string[] = [];
    for (const [index, raw] of value.entries()) {
      const label = `Item ${index + 1}: `;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        problems.push(`${label}must be an object`);
        continue;
      }
      const instance = plainToInstance(this.item, raw as object);
      const errors = await validate(instance, { whitelist: true });
      problems.push(...messages(errors).map((m) => label + m));
      out.push(instance);
    }
    if (problems.length) throw new BadRequestException(problems);
    return out;
  }
}
