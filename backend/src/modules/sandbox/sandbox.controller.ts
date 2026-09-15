import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { SandboxRepository } from './repositories/sandbox.repository';
import type {
  SandboxDoc,
  SandboxEntitySnapshot,
} from './repositories/sandbox.repository';

@Controller('sandbox')
export class SandboxController {
  constructor(private readonly sandboxRepository: SandboxRepository) {}

  @Get()
  async list(): Promise<{ sandboxes: SandboxDoc[] }> {
    return { sandboxes: await this.sandboxRepository.list() };
  }

  @Post()
  async create(
    @Body() body: { name?: unknown; tables?: unknown; entities?: unknown },
  ): Promise<{ ok: boolean; message: string }> {
    try {
      const name = typeof body?.name === 'string' ? body.name.trim() : '';
      if (!name) return { ok: false, message: 'Sandbox name is required' };
      const tables = Array.isArray(body?.tables)
        ? body.tables.map((t) => String(t))
        : [];
      if (tables.length === 0) {
        return { ok: false, message: 'Include at least one entity' };
      }
      const entities = Array.isArray(body?.entities)
        ? (body.entities as SandboxEntitySnapshot[])
        : [];
      await this.sandboxRepository.save(name, tables, entities);
      return {
        ok: true,
        message: `Sandbox "${name}" saved — ${tables.length} entities`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }

  @Delete(':name')
  async remove(
    @Param('name') name: string,
  ): Promise<{ ok: boolean; message: string }> {
    const removed = await this.sandboxRepository.delete(name);
    if (removed === 0) {
      return { ok: false, message: `Sandbox "${name}" not found` };
    }
    return { ok: true, message: `Sandbox "${name}" deleted` };
  }
}
