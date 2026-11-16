import {
  IMAGES_MAX_COUNT,
  IMAGE_MAX_BYTES,
} from '../../services/workflow-input-validation';

/** The file types an image field takes (PNG, JPEG or WebP). */
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** The image files a paste or a drop carries (any `image/*`; the type is checked on adding). */
export function imageFilesOf(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];
  const files = Array.from(data.files ?? []);
  const fromFiles = files.filter((file) => file.type.startsWith('image/'));
  if (fromFiles.length > 0) return fromFiles;
  // A paste lists its files as `items` only.
  return Array.from(data.items ?? [])
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

/** Whether a drag carries files (the box shows it takes them). */
export function dragHasFiles(data: DataTransfer | null | undefined): boolean {
  return Array.from(data?.types ?? []).includes('Files');
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Not a data URL'));
    reader.onerror = () => reject(reader.error ?? new Error('Read failed'));
    reader.readAsDataURL(file);
  });
}

/** What adding files to a list of images came to. */
export interface AddedImages {
  /** The `data:` URLs of the files taken, in order. */
  accepted: string[];
  /** The first refusal, with the backend's wording; null when every file was taken. */
  error: string | null;
}

/**
 * Turns picked, pasted or dropped files into `data:` URLs for a list that
 * already holds `existing` images and takes at most `max`: another type, a
 * file over 5 MB and files beyond the limit are refused with the messages of
 * api.md 118 (`<label> must be PNG, JPEG or WebP images`, `… at most 5 MB
 * each`, `… at most <max> images`); the rest are taken.
 */
export async function addImageFiles(
  files: readonly File[],
  existing: number,
  label: string,
  max: number = IMAGES_MAX_COUNT,
): Promise<AddedImages> {
  const accepted: string[] = [];
  let error: string | null = null;
  for (const file of files) {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      error ??= `${label} must be PNG, JPEG or WebP images`;
    } else if (file.size > IMAGE_MAX_BYTES) {
      error ??= `${label} must be at most ${IMAGE_MAX_BYTES / (1024 * 1024)} MB each`;
    } else if (existing + accepted.length >= max) {
      error ??= `${label} must be at most ${max} images`;
    } else {
      try {
        accepted.push(await readAsDataUrl(file));
      } catch {
        error ??= `${label}: ${file.name} could not be read`;
      }
    }
  }
  return { accepted, error };
}
