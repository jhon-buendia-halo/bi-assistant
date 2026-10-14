import { Injectable, NotFoundException } from '@nestjs/common';
import { createZip } from '../../common/zip-archive';
import { RfpService } from '../rfp/rfp.service';
import type { Rfp } from '../rfp/rfp.types';
import { renderRfpMarkdown } from './document';
import {
  buildExhibits,
  exhibitCsv,
  isExhibitName,
  type Exhibit,
} from './exhibits';
import { ExhibitsQueries, type PackageData } from './exhibits.queries';
import { renderPdf } from './pdf';

/** `manifest.json` of the package zip (api.md 2.16.5 I34). */
export interface PackageManifest {
  rfpId: string;
  title: string;
  generatedAt: string;
  files: string[];
}

export interface PackageFile {
  name: string;
  data: Buffer;
}

/** Now, to the second, as `YYYY-MM-DDTHH:MM:SSZ`. */
export function generationTime(now = new Date()): string {
  return now.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Every file of the package, in order: `rfp.md`, `rfp.pdf`, the four
 * exhibits, then `manifest.json` (which lists all seven). Pure given its
 * inputs: the same record, data and `generatedAt` give the same bytes.
 */
export async function buildPackageFiles(
  rfp: Rfp,
  data: PackageData,
  generatedAt: string,
  options: { compressPdf?: boolean } = {},
): Promise<PackageFile[]> {
  const markdown = renderRfpMarkdown(rfp, data, generatedAt);
  const pdf = await renderPdf(markdown, {
    title: rfp.title,
    createdAt: new Date(generatedAt),
    compress: options.compressPdf,
  });
  const files: PackageFile[] = [
    { name: 'rfp.md', data: Buffer.from(markdown, 'utf8') },
    { name: 'rfp.pdf', data: pdf },
    ...buildExhibits(rfp, data).map((exhibit) => ({
      name: `exhibits/${exhibit.name}.csv`,
      data: Buffer.from(exhibitCsv(exhibit), 'utf8'),
    })),
  ];
  const manifest: PackageManifest = {
    rfpId: rfp.id,
    title: rfp.title,
    generatedAt,
    files: [...files.map((f) => f.name), 'manifest.json'],
  };
  files.push({
    name: 'manifest.json',
    data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8'),
  });
  return files;
}

/**
 * The RFP package (api.md 2.16.5): a projection of the stored record and the
 * live Intellify data, regenerated on every request; nothing is snapshotted.
 */
@Injectable()
export class PackageService {
  constructor(
    private readonly rfps: RfpService,
    private readonly queries: ExhibitsQueries,
  ) {}

  private async load(id: string): Promise<{ rfp: Rfp; data: PackageData }> {
    const rfp = await this.rfps.get(id);
    return { rfp, data: await this.queries.load(rfp) };
  }

  async markdown(id: string): Promise<string> {
    const { rfp, data } = await this.load(id);
    return renderRfpMarkdown(rfp, data, generationTime());
  }

  async pdf(id: string): Promise<{ rfp: Rfp; pdf: Buffer }> {
    const { rfp, data } = await this.load(id);
    const generatedAt = generationTime();
    const markdown = renderRfpMarkdown(rfp, data, generatedAt);
    const pdf = await renderPdf(markdown, {
      title: rfp.title,
      createdAt: new Date(generatedAt),
    });
    return { rfp, pdf };
  }

  async exhibits(id: string): Promise<Exhibit[]> {
    const { rfp, data } = await this.load(id);
    return buildExhibits(rfp, data);
  }

  async exhibitCsv(id: string, name: string): Promise<string> {
    if (!isExhibitName(name)) {
      // Unknown RFP first, as every package route answers.
      await this.rfps.get(id);
      throw new NotFoundException(`Exhibit "${name}" not found`);
    }
    const exhibit = (await this.exhibits(id)).find((e) => e.name === name)!;
    return exhibitCsv(exhibit);
  }

  async zip(id: string): Promise<{ rfp: Rfp; zip: Buffer }> {
    const { rfp, data } = await this.load(id);
    const generatedAt = generationTime();
    const files = await buildPackageFiles(rfp, data, generatedAt);
    return { rfp, zip: createZip(files, new Date(generatedAt)) };
  }
}
