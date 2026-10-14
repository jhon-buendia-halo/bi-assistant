import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { deflateRawSync } from 'zlib';

const workspaces = mkdtempSync(join(tmpdir(), 'rfp-packages-'));
jest.mock('../../mastra/session-workspaces', () => ({
  sessionWorkspacePath: (sessionId: string) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('path') as typeof import('path')).join(
      workspaces,
      `session-${sessionId}`,
    ),
}));
jest.mock('../datasources/datasources.service', () => ({
  DatasourcesService: class {},
}));

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createZip } from '../sessions/zip-archive';
import { RfpPackagesService } from './rfp-packages.service';
import { readZip } from './zip-reader';

const RFP_ID = '7b0c2f0e-1d2a-4c9b-9a51-0f6f1c2d3e4f';
const MANIFEST = JSON.stringify({
  rfpId: RFP_ID,
  title: 'Orchard Manufacturing — 2027 benefits RFP',
  generatedAt: '2026-10-14T10:00:00.000Z',
  files: ['rfp.md', 'exhibits/exhibit-a-census.csv', 'manifest.json'],
});

/** The package the API serves (api.md I34), stored entries. */
function packageZip(): Buffer {
  return createZip([
    { name: 'rfp.md', data: '# Orchard Manufacturing — 2027 benefits RFP\n' },
    {
      name: 'exhibits/exhibit-a-census.csv',
      data: 'state,employees\nOH,120\n',
    },
    { name: 'manifest.json', data: MANIFEST },
  ]);
}

/** A one-file ZIP with a deflated entry, as zip tools usually write. */
function deflatedZip(name: string, content: string): Buffer {
  const data = Buffer.from(content);
  const packed = deflateRawSync(data);
  const fileName = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(fileName.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(packed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(fileName.length, 28);
  central.writeUInt32LE(0, 42);
  const centralOffset = local.length + fileName.length + packed.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + fileName.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, fileName, packed, central, fileName, end]);
}

function build(kind: 'rest' | 'postgres' = 'rest') {
  const datasources = {
    get: jest.fn().mockResolvedValue({
      id: 'ds-1',
      name: 'Intellify RFP API',
      kind,
      config: {
        baseUrl: 'http://127.0.0.1:3100/',
        auth: { type: 'api-key-header', headerName: 'X-API-Key', token: 'k' },
        endpoints: [],
      },
    }),
  };
  return {
    service: new RfpPackagesService(datasources as never),
    datasources,
  };
}

const fetchMock = jest.fn();

beforeAll(() => {
  global.fetch = fetchMock;
});

afterAll(() => rmSync(workspaces, { recursive: true, force: true }));

beforeEach(() => fetchMock.mockReset());

describe('readZip', () => {
  it('reads the stored entries createZip writes', () => {
    expect(
      readZip(packageZip()).map((file) => [
        file.name,
        file.data.toString('utf8'),
      ]),
    ).toEqual([
      ['rfp.md', '# Orchard Manufacturing — 2027 benefits RFP\n'],
      ['exhibits/exhibit-a-census.csv', 'state,employees\nOH,120\n'],
      ['manifest.json', MANIFEST],
    ]);
  });

  it('inflates deflated entries', () => {
    const [file] = readZip(deflatedZip('rfp.md', 'Hello '.repeat(50)));
    expect(file.name).toBe('rfp.md');
    expect(file.data.toString('utf8')).toBe('Hello '.repeat(50));
  });

  it('refuses something that is not a ZIP archive', () => {
    expect(() => readZip(Buffer.from('not a zip'))).toThrow(
      'Invalid ZIP archive',
    );
  });
});

describe('RfpPackagesService', () => {
  it('resolves the REST target with the headers the connector builds (agents.md 3.10)', async () => {
    const { service } = build();
    await expect(service.restTarget('ds-1')).resolves.toEqual({
      baseUrl: 'http://127.0.0.1:3100',
      headers: { Accept: 'application/json', 'X-API-Key': 'k' },
    });
  });

  it('refuses a datasource that is not REST', async () => {
    await expect(build('postgres').service.restTarget('ds-1')).rejects.toThrow(
      'Datasource "Intellify RFP API" is not a REST datasource',
    );
  });

  it('unzips the package into the session workspace, replacing an earlier export', async () => {
    const { service } = build();
    const archive = packageZip();
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array(archive), { status: 200 }),
    );

    const result = await service.exportRfpPackage('s-1', 'ds-1', RFP_ID);

    expect(fetchMock).toHaveBeenCalledWith(
      `http://127.0.0.1:3100/v1/rfps/${RFP_ID}/package.zip`,
      expect.objectContaining({
        headers: { Accept: 'application/zip', 'X-API-Key': 'k' },
      }),
    );
    expect(result).toEqual({
      rfpId: RFP_ID,
      title: 'Orchard Manufacturing — 2027 benefits RFP',
      files: [
        { name: 'rfp.md', bytes: expect.any(Number) as number },
        {
          name: 'exhibits/exhibit-a-census.csv',
          bytes: 'state,employees\nOH,120\n'.length,
        },
        { name: 'manifest.json', bytes: Buffer.byteLength(MANIFEST) },
      ],
      exportedAt: expect.any(String) as string,
    });
    const folder = join(workspaces, 'session-s-1', 'rfp', RFP_ID);
    expect(
      readFileSync(join(folder, 'exhibits/exhibit-a-census.csv'), 'utf8'),
    ).toBe('state,employees\nOH,120\n');

    // Exporting again overwrites the folder (data-model 4.1).
    fetchMock.mockResolvedValue(
      new Response(
        new Uint8Array(createZip([{ name: 'rfp.md', data: 'v2' }])),
        { status: 200 },
      ),
    );
    await service.exportRfpPackage('s-1', 'ds-1', RFP_ID);
    expect(readFileSync(join(folder, 'rfp.md'), 'utf8')).toBe('v2');
    expect(existsSync(join(folder, 'manifest.json'))).toBe(false);
  });

  it("reports the API's error as the tools do", async () => {
    const { service } = build();
    fetchMock.mockResolvedValue(
      Response.json(
        { code: 'not_found', message: `RFP "${RFP_ID}" not found` },
        { status: 404 },
      ),
    );
    await expect(
      service.exportRfpPackage('s-2', 'ds-1', RFP_ID),
    ).rejects.toThrow(`404 not_found: RFP "${RFP_ID}" not found`);

    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED'));
    await expect(
      service.exportRfpPackage('s-2', 'ds-1', RFP_ID),
    ).rejects.toThrow(
      'Intellify API unreachable at http://127.0.0.1:3100: connect ECONNREFUSED',
    );
  });

  it('refuses a package whose paths leave its folder', async () => {
    const { service } = build();
    fetchMock.mockResolvedValue(
      new Response(
        new Uint8Array(createZip([{ name: '../escape.md', data: 'x' }])),
        { status: 200 },
      ),
    );
    await expect(
      service.exportRfpPackage('s-3', 'ds-1', RFP_ID),
    ).rejects.toThrow('unsafe path "../escape.md"');
    expect(existsSync(join(workspaces, 'session-s-3', 'escape.md'))).toBe(
      false,
    );
  });

  describe('download (api.md #105)', () => {
    async function exported() {
      const { service } = build();
      fetchMock.mockResolvedValue(
        new Response(new Uint8Array(packageZip()), { status: 200 }),
      );
      await service.exportRfpPackage('s-4', 'ds-1', RFP_ID);
      return service;
    }

    it('zips the whole package, named after its title', async () => {
      const service = await exported();
      const download = await service.download('s-4', RFP_ID);
      expect(download.filename).toBe(
        'rfp-orchard-manufacturing-2027-benefits-rfp.zip',
      );
      expect(download.contentType).toBe('application/zip');
      expect(readZip(download.body).map((file) => file.name)).toEqual([
        'exhibits/exhibit-a-census.csv',
        'manifest.json',
        'rfp.md',
      ]);
    });

    it('serves one file with its content type', async () => {
      const service = await exported();
      const download = await service.download(
        's-4',
        RFP_ID,
        'exhibits/exhibit-a-census.csv',
      );
      expect(download).toEqual({
        filename: 'exhibit-a-census.csv',
        contentType: 'text/csv',
        body: Buffer.from('state,employees\nOH,120\n'),
      });
      expect(
        (await service.download('s-4', RFP_ID, 'rfp.md')).contentType,
      ).toBe('text/markdown');
    });

    it('answers 404 for a package or a file that was never exported', async () => {
      const service = await exported();
      await expect(service.download('s-4', 'other-rfp')).rejects.toThrow(
        new NotFoundException('RFP package "other-rfp" not found'),
      );
      await expect(service.download('s-5', RFP_ID)).rejects.toThrow(
        NotFoundException,
      );
      await expect(
        service.download('s-4', RFP_ID, 'exhibits/nope.csv'),
      ).rejects.toThrow(
        `RFP package "${RFP_ID}" has no file "exhibits/nope.csv"`,
      );
      await expect(service.download('s-4', '..')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses an absolute or `..` file name', async () => {
      const service = await exported();
      for (const file of [
        '../../secret.txt',
        '/etc/passwd',
        'exhibits/../../x',
        '..\\x',
        'C:\\x',
      ]) {
        await expect(service.download('s-4', RFP_ID, file)).rejects.toThrow(
          new BadRequestException(`Invalid file name "${file}"`),
        );
      }
    });
  });
});
