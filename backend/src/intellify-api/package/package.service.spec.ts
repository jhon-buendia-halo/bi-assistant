jest.mock('marked', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return
  require('../../../node_modules/marked/lib/marked.umd.js'),
);

import { NotFoundException } from '@nestjs/common';
import type { RfpService } from '../rfp/rfp.service';
import type { ExhibitsQueries } from './exhibits.queries';
import { PackageController, packageFileName } from './package.controller';
import {
  buildPackageFiles,
  generationTime,
  PackageService,
} from './package.service';
import { fixtureData, fixtureRfp, GENERATED_AT } from './rfp-package.stub';

/** Entries of a stored (uncompressed) zip, from its local headers. */
function unzip(zip: Buffer): { name: string; data: Buffer }[] {
  const out: { name: string; data: Buffer }[] = [];
  let at = 0;
  while (zip.readUInt32LE(at) === 0x04034b50) {
    const size = zip.readUInt32LE(at + 18);
    const nameLength = zip.readUInt16LE(at + 26);
    const extra = zip.readUInt16LE(at + 28);
    const name = zip.subarray(at + 30, at + 30 + nameLength).toString('utf8');
    const start = at + 30 + nameLength + extra;
    out.push({ name, data: zip.subarray(start, start + size) });
    at = start + size;
  }
  return out;
}

const FILES = [
  'rfp.md',
  'rfp.pdf',
  'exhibits/exhibit-a-census.csv',
  'exhibits/exhibit-b-plan-designs.csv',
  'exhibits/exhibit-c-financials.csv',
  'exhibits/exhibit-d-carriers.csv',
  'manifest.json',
];

describe('RFP package', () => {
  it('builds the seven files and a manifest listing them', async () => {
    const files = await buildPackageFiles(
      fixtureRfp(),
      fixtureData(),
      GENERATED_AT,
    );
    expect(files.map((f) => f.name)).toEqual(FILES);
    const manifest: unknown = JSON.parse(files[6].data.toString('utf8'));
    expect(manifest).toEqual({
      rfpId: fixtureRfp().id,
      title: 'Orchard Manufacturing — 2027 benefits RFP',
      generatedAt: GENERATED_AT,
      files: FILES,
    });
    expect(files[0].data.toString('utf8')).toContain('## 3. Scope of this RFP');
    expect(files[1].data.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('marks a draft package: title, draft line, manifest draft and stage (BA-229)', async () => {
    const files = await buildPackageFiles(
      fixtureRfp(),
      fixtureData(),
      GENERATED_AT,
      { draft: true, compressPdf: false },
    );
    expect(files.map((f) => f.name)).toEqual(FILES);
    const markdown = files[0].data.toString('utf8').split('\n');
    expect(markdown[0]).toBe(
      '# DRAFT — Orchard Manufacturing — 2027 benefits RFP',
    );
    expect(markdown[2]).toBe(
      `Draft exported ${GENERATED_AT.slice(0, 10)} at stage 4 of 7 — not for release to carriers.`,
    );
    const manifest = JSON.parse(files[6].data.toString('utf8')) as Record<
      string,
      unknown
    >;
    expect(manifest).toMatchObject({ draft: true, stage: 4, files: FILES });

    // The final package carries none of it.
    const final = await buildPackageFiles(
      fixtureRfp(),
      fixtureData(),
      GENERATED_AT,
    );
    expect(final[0].data.toString('utf8')).not.toContain('DRAFT');
    expect(JSON.parse(final[6].data.toString('utf8'))).not.toHaveProperty(
      'draft',
    );
  });

  describe('PackageService', () => {
    const rfps = { get: jest.fn() } as unknown as jest.Mocked<RfpService>;
    const queries = {
      load: jest.fn(),
    } as unknown as jest.Mocked<ExhibitsQueries>;
    const service = new PackageService(rfps, queries);

    beforeEach(() => {
      rfps.get.mockResolvedValue(fixtureRfp());
      queries.load.mockResolvedValue(fixtureData());
    });

    it('zips the package files', async () => {
      const { zip } = await service.zip(fixtureRfp().id);
      const entries = unzip(zip);
      expect(entries.map((e) => e.name)).toEqual(FILES);
      expect(entries[0].data.toString('utf8')).toContain('Delta Dental');
      expect(entries[5].data.toString('utf8').split('\r\n')[0]).toBe(
        'position,insurerName,lines,incumbent,contactEmail,notes',
      );
    });

    it('zips a draft package on request', async () => {
      const { zip } = await service.zip(fixtureRfp().id, { draft: true });
      const entries = unzip(zip);
      expect(entries[0].data.toString('utf8')).toMatch(/^# DRAFT — /);
      expect(
        JSON.parse(entries[6].data.toString('utf8')) as unknown,
      ).toMatchObject({ draft: true, stage: 4 });
    });

    it('answers 404 for an unknown exhibit name', async () => {
      await expect(service.exhibitCsv('id', 'exhibit-z')).rejects.toThrow(
        new NotFoundException('Exhibit "exhibit-z" not found'),
      );
      expect(await service.exhibitCsv('id', 'exhibit-a-census')).toMatch(
        /^documentId,clientOneCode,/,
      );
    });

    it('lets an unknown RFP surface as its 404', async () => {
      rfps.get.mockRejectedValue(new NotFoundException('RFP "x" not found'));
      await expect(service.markdown('x')).rejects.toThrow('RFP "x" not found');
      await expect(service.exhibitCsv('x', 'nope')).rejects.toThrow(
        'RFP "x" not found',
      );
    });
  });

  it('package.zip takes draft=true only when it is exactly "true" (BA-229)', async () => {
    const zip = jest
      .fn()
      .mockResolvedValue({ rfp: fixtureRfp(), zip: Buffer.from('z') });
    const controller = new PackageController({ zip } as never);
    await controller.packageZip('id', 'true');
    expect(zip).toHaveBeenLastCalledWith('id', { draft: true });
    await controller.packageZip('id');
    expect(zip).toHaveBeenLastCalledWith('id', { draft: false });
    await controller.packageZip('id', 'yes');
    expect(zip).toHaveBeenLastCalledWith('id', { draft: false });
  });

  it('names files and stamps generation time to the second', () => {
    expect(
      packageFileName('Orchard Manufacturing — 2027 benefits RFP', 'zip'),
    ).toBe('rfp-orchard-manufacturing-2027-benefits-rfp.zip');
    expect(generationTime(new Date('2026-10-14T09:30:00.123Z'))).toBe(
      '2026-10-14T09:30:00Z',
    );
  });
});
