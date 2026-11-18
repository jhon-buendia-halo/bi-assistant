import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

/**
 * Reference images of the `image-reader` eval cases (agents.md 8.1): PNG,
 * JPEG or WebP files in `backend/src/mastra/evals/__fixtures__/images/`,
 * named in a case's input. The build does not copy them, so a run from
 * `dist/` reads them from the source folder.
 */

/** One image as a model call takes it (`StepImage`). */
export interface EvalImage {
  data: Buffer;
  mediaType: string;
}

const MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

/** The images folder: next to this file, else in the source tree. */
function imagesDir(): string {
  const here = join(__dirname, '__fixtures__', 'images');
  const source = join(
    __dirname,
    '..',
    '..',
    '..',
    'src',
    'mastra',
    'evals',
    '__fixtures__',
    'images',
  );
  return existsSync(here) || !existsSync(source) ? here : source;
}

export const EVAL_IMAGES_DIR = imagesDir();

/** The named files of `dir`, in order, each with its media type. */
export async function loadEvalImages(
  names: readonly string[],
  dir: string = EVAL_IMAGES_DIR,
): Promise<EvalImage[]> {
  return Promise.all(
    names.map(async (name) => {
      if (basename(name) !== name) {
        throw new Error(
          `"${name}" is not a file name in the eval images folder`,
        );
      }
      const mediaType = MEDIA_TYPES[extname(name).toLowerCase()];
      if (!mediaType) {
        throw new Error(`"${name}" is not a PNG, JPEG or WebP image`);
      }
      return { data: await readFile(join(dir, name)), mediaType };
    }),
  );
}
