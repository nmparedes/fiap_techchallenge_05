import { describe, expect, test } from '@jest/globals';

import {
  ALLOWED_VIDEO_EXTENSIONS,
  MAX_VIDEO_SIZE_BYTES,
  validateUpload,
} from './upload-validation.js';

function file(name: string, size = 1): File {
  return { name, size } as File;
}

describe('upload validation', () => {
  test.each(ALLOWED_VIDEO_EXTENSIONS)('accepts the %s extension', (extension) => {
    expect(validateUpload(file(`video.${extension.toUpperCase()}`), '1')).toMatchObject({
      valid: true,
      value: { fps: 1 },
    });
  });

  test('rejects a missing or unsupported file', () => {
    expect(validateUpload(undefined, '1')).toEqual({
      valid: false,
      error: { field: 'video', message: 'Selecione um arquivo de vídeo.' },
    });
    expect(validateUpload(file('video.txt'), '1')).toEqual({
      valid: false,
      error: { field: 'video', message: 'Formato de vídeo não permitido.' },
    });
  });

  test('accepts exactly 200 MiB and rejects anything larger', () => {
    expect(validateUpload(file('video.mp4', MAX_VIDEO_SIZE_BYTES), '1')).toMatchObject({
      valid: true,
    });
    expect(validateUpload(file('video.mp4', MAX_VIDEO_SIZE_BYTES + 1), '1')).toEqual({
      valid: false,
      error: { field: 'video', message: 'O arquivo deve ter no máximo 200 MiB.' },
    });
  });

  test.each([
    ['', true, 1],
    ['1', true, 1],
    ['10', true, 10],
    ['0', false, undefined],
    ['11', false, undefined],
    ['1.5', false, undefined],
  ])('validates fps value %s', (value, valid, fps) => {
    const result = validateUpload(file('video.mp4'), value);
    expect(result.valid).toBe(valid);

    if (result.valid) {
      expect(result.value.fps).toBe(fps);
    }
  });
});
