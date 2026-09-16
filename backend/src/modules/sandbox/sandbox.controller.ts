import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { SandboxService } from './sandbox.service';
import type { SandboxDoc } from './repositories/sandbox.repository';
import type { SandboxEntitySnapshot } from './repositories/sandbox.repository';

@Controller('sandbox')
export class SandboxController {
  constructor(private readonly sandboxes: SandboxService) {}

  @Get()
  async list(): Promise<{ sandboxes: SandboxDoc[] }> {
    return { sandboxes: await this.sandboxes.list() };
  }

  @Post()
  async create(
    @Body()
    body: {
      name?: unknown;
      tables?: unknown;
      entities?: unknown;
      datasourceId?: unknown;
      datasourceKind?: unknown;
    },
  ): Promise<{ ok: boolean; message: string }> {
    try {
      const name = typeof body?.name === 'string' ? body.name.trim() : '';
      const tables = Array.isArray(body?.tables)
        ? body.tables.map((t) => String(t))
        : [];
      const saved = await this.sandboxes.save({
        name,
        tables,
        entities: Array.isArray(body?.entities)
          ? (body.entities as SandboxEntitySnapshot[])
          : [],
        datasourceId:
          typeof body?.datasourceId === 'string'
            ? body.datasourceId.trim()
            : '',
        datasourceKind: body?.datasourceKind,
      });
      return {
        ok: true,
        message: `Sandbox "${saved?.name ?? name}" saved — ${tables.length} entities`,
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
    const removed = await this.sandboxes.delete(name);
    if (removed === 0) {
      return { ok: false, message: `Sandbox "${name}" not found` };
    }
    return { ok: true, message: `Sandbox "${name}" deleted` };
  }
}
