import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import BetterSqlite3 from 'better-sqlite3';
import { SqliteDocStore } from '../../infrastructure/database/sqlite-doc-store';
import { PersonasRepository } from './repositories/personas.repository';
import { PersonasService } from './personas.service';
import type { UserPersona } from './entities/user-persona.entity';
import { DEMO_PERSONA } from './demo-persona';

describe('PersonasService', () => {
  let db: BetterSqlite3.Database;
  let service: PersonasService;

  beforeEach(() => {
    db = new BetterSqlite3(':memory:');
    const store = new SqliteDocStore<UserPersona>(db, 'user_personas');
    service = new PersonasService(
      new PersonasRepository(store, new SqliteDocStore(db, 'settings')),
    );
  });

  afterEach(() => db.close());

  describe('default personas (user-personas R13)', () => {
    it('seeds Demo Finance Analyst with every field on first start', async () => {
      await service.onModuleInit();
      const [demo] = await service.list();
      expect(demo).toMatchObject({ ...DEMO_PERSONA });
      expect(demo.name).toBe('Demo Finance Analyst');
      for (const field of ['role', 'description', 'goals', 'answerStyle']) {
        expect((demo as unknown as Record<string, string>)[field]).not.toBe('');
      }
      expect(demo.typicalQuestions.length).toBeGreaterThan(0);
    });

    it('seeds only once, so a deleted demo persona stays deleted', async () => {
      await service.onModuleInit();
      const [demo] = await service.list();
      await service.delete(demo.id);
      await service.onModuleInit();
      await expect(service.list()).resolves.toEqual([]);
    });

    it('does not duplicate a persona already named like the demo one', async () => {
      await service.create({ name: 'demo finance analyst', role: 'Mine' });
      await service.onModuleInit();
      const all = await service.list();
      expect(all).toHaveLength(1);
      expect(all[0].role).toBe('Mine');
    });

    it('passes its own validation', async () => {
      // The seed goes through create(), so an invalid demo would throw here.
      await expect(service.seedDefaults()).resolves.toBeUndefined();
    });
  });

  it('creates with defaults and trims', async () => {
    const created = await service.create({ name: '  Analyst  ' });

    expect(created).toMatchObject({
      name: 'Analyst',
      role: '',
      description: '',
      goals: '',
      typicalQuestions: [],
      expertise: 'intermediate',
      answerStyle: '',
    });
    expect(created.id).toBeTruthy();
    expect(created.createdAt).toBeTruthy();
    expect(created.updatedAt).toBeTruthy();
  });

  it('drops blank typical questions and trims the rest', async () => {
    const created = await service.create({
      name: 'A',
      typicalQuestions: [' one ', '  ', 'two'],
    });
    expect(created.typicalQuestions).toEqual(['one', 'two']);
  });

  const invalid: Array<[string, Record<string, unknown>, string]> = [
    ['blank name', { name: '   ' }, 'Name is required'],
    ['missing name', {}, 'Name is required'],
    ['long name', { name: 'x'.repeat(81) }, 'Name is at most 80 characters'],
    [
      'long role',
      { name: 'a', role: 'x'.repeat(81) },
      'Role is at most 80 characters',
    ],
    [
      'long description',
      { name: 'a', description: 'x'.repeat(2001) },
      'Description is at most 2,000 characters',
    ],
    [
      'long goals',
      { name: 'a', goals: 'x'.repeat(2001) },
      'Goals are at most 2,000 characters',
    ],
    [
      'too many questions',
      {
        name: 'a',
        typicalQuestions: Array.from({ length: 11 }, (_, i) => `q${i}`),
      },
      'At most 10 typical questions',
    ],
    [
      'long question',
      { name: 'a', typicalQuestions: ['x'.repeat(301)] },
      'A typical question is at most 300 characters',
    ],
    [
      'bad expertise',
      { name: 'a', expertise: 'guru' },
      'Expertise must be novice, intermediate or expert',
    ],
    [
      'long answer style',
      { name: 'a', answerStyle: 'x'.repeat(501) },
      'Answer style is at most 500 characters',
    ],
  ];

  it.each(invalid)('rejects %s', async (_label, body, message) => {
    const error = await service.create(body as never).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).message).toBe(message);
  });

  it('allows ten questions after dropping blanks', async () => {
    const questions = [...Array.from({ length: 10 }, (_, i) => `q${i}`), ' '];
    await expect(
      service.create({ name: 'a', typicalQuestions: questions }),
    ).resolves.toBeDefined();
  });

  it('rejects a duplicate name ignoring case and spaces', async () => {
    await service.create({ name: 'Analyst' });

    const error = await service
      .create({ name: '  analyst ' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).message).toBe(
      'A persona named "analyst" already exists',
    );
  });

  it('updates partially, keeping omitted fields and restamping updatedAt', async () => {
    const created = await service.create({
      name: 'Analyst',
      role: 'BI',
      expertise: 'expert',
    });
    await new Promise((r) => setTimeout(r, 5));

    const updated = await service.update(created.id, { goals: ' ship ' });

    expect(updated).toMatchObject({
      name: 'Analyst',
      role: 'BI',
      expertise: 'expert',
      goals: 'ship',
    });
    expect(updated.updatedAt >= created.updatedAt).toBe(true);
    expect(updated.createdAt).toBe(created.createdAt);
  });

  it('validates fields on update', async () => {
    const created = await service.create({ name: 'Analyst' });
    await expect(service.update(created.id, { name: ' ' })).rejects.toThrow(
      'Name is required',
    );
    await expect(
      service.update(created.id, { expertise: 'x' as never }),
    ).rejects.toThrow(BadRequestException);
  });

  it('allows keeping its own name on update but not another persona name', async () => {
    const a = await service.create({ name: 'Alpha' });
    await service.create({ name: 'Beta' });

    await expect(
      service.update(a.id, { name: 'ALPHA' }),
    ).resolves.toMatchObject({ name: 'ALPHA' });
    await expect(service.update(a.id, { name: ' beta ' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('lists sorted by name, case-insensitive', async () => {
    await service.create({ name: 'charlie' });
    await service.create({ name: 'Alpha' });
    await service.create({ name: 'bravo' });

    const names = (await service.list()).map((p) => p.name);
    expect(names).toEqual(['Alpha', 'bravo', 'charlie']);
  });

  it('deletes a persona', async () => {
    const created = await service.create({ name: 'Analyst' });
    await service.delete(created.id);
    await expect(service.list()).resolves.toEqual([]);
  });

  it('throws 404 for an unknown id on update and delete', async () => {
    await expect(service.update('nope', { name: 'x' })).rejects.toThrow(
      new NotFoundException('Persona not found'),
    );
    await expect(service.delete('nope')).rejects.toThrow(
      new NotFoundException('Persona not found'),
    );
  });
});
