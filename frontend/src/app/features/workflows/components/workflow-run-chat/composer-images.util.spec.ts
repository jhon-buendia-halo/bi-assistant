import { IMAGE_MAX_BYTES } from '../../services/workflow-input-validation';
import {
  addImageFiles,
  dragHasFiles,
  imageFilesOf,
} from './composer-images.util';

function imageFile(name: string, type = 'image/png', bytes = 4): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function transfer(...files: File[]): DataTransfer {
  const data = new DataTransfer();
  for (const file of files) data.items.add(file);
  return data;
}

describe('imageFilesOf', () => {
  it('keeps the image files of a paste or a drop and leaves the rest', () => {
    const png = imageFile('a.png');
    const text = new File(['hello'], 'a.txt', { type: 'text/plain' });
    expect(imageFilesOf(transfer(png, text))).toEqual([png]);
  });

  it('finds nothing in a plain text paste', () => {
    const data = new DataTransfer();
    data.setData('text/plain', 'hello');
    expect(imageFilesOf(data)).toEqual([]);
    expect(imageFilesOf(null)).toEqual([]);
  });

  it('knows a drag that carries files', () => {
    expect(dragHasFiles(transfer(imageFile('a.png')))).toBeTrue();
    expect(dragHasFiles(null)).toBeFalse();
  });
});

describe('addImageFiles', () => {
  const label = 'Reference images';

  it('turns accepted files into data URLs, in order', async () => {
    const { accepted, error } = await addImageFiles(
      [imageFile('a.png'), imageFile('b.jpg', 'image/jpeg')],
      0,
      label,
    );
    expect(error).toBeNull();
    expect(accepted.length).toBe(2);
    expect(accepted[0]).toMatch(/^data:image\/png;base64,/);
    expect(accepted[1]).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('refuses another type', async () => {
    const result = await addImageFiles(
      [imageFile('a.gif', 'image/gif'), imageFile('b.webp', 'image/webp')],
      0,
      label,
    );
    expect(result.error).toBe(
      'Reference images must be PNG, JPEG or WebP images',
    );
    expect(result.accepted.length).toBe(1);
  });

  it('refuses a file over 5 MB', async () => {
    const result = await addImageFiles(
      [imageFile('big.png', 'image/png', IMAGE_MAX_BYTES + 1)],
      0,
      label,
    );
    expect(result.error).toBe('Reference images must be at most 5 MB each');
    expect(result.accepted).toEqual([]);
  });

  it('stops at the limit, counting the images already held', async () => {
    const result = await addImageFiles(
      [imageFile('a.png'), imageFile('b.png'), imageFile('c.png')],
      2,
      label,
      4,
    );
    expect(result.accepted.length).toBe(2);
    expect(result.error).toBe('Reference images must be at most 4 images');
  });
});
