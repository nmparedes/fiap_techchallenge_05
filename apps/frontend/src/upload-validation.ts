export const ALLOWED_VIDEO_EXTENSIONS = ['mp4', 'avi', 'mov', 'mkv', 'wmv', 'flv', 'webm'] as const;
export const VIDEO_ACCEPT_VALUE = ALLOWED_VIDEO_EXTENSIONS.map((extension) => `.${extension}`).join(
  ',',
);
export const MAX_VIDEO_SIZE_BYTES = 200 * 1024 * 1024;
export const DEFAULT_VIDEO_FPS = 1;

export interface ValidUpload {
  file: File;
  fps: number;
}

export interface InvalidUpload {
  field: 'video' | 'fps';
  message: string;
}

export type UploadValidationResult =
  { valid: true; value: ValidUpload } | { valid: false; error: InvalidUpload };

export function validateUpload(file: File | undefined, fpsValue: string): UploadValidationResult {
  if (file === undefined) {
    return { valid: false, error: { field: 'video', message: 'Selecione um arquivo de vídeo.' } };
  }

  const extension = file.name.split('.').pop()?.toLowerCase();

  if (
    extension === undefined ||
    !ALLOWED_VIDEO_EXTENSIONS.includes(extension as (typeof ALLOWED_VIDEO_EXTENSIONS)[number])
  ) {
    return { valid: false, error: { field: 'video', message: 'Formato de vídeo não permitido.' } };
  }

  if (file.size > MAX_VIDEO_SIZE_BYTES) {
    return {
      valid: false,
      error: { field: 'video', message: 'O arquivo deve ter no máximo 200 MiB.' },
    };
  }

  const fps = fpsValue.trim() === '' ? DEFAULT_VIDEO_FPS : Number(fpsValue);

  if (!Number.isInteger(fps) || fps < 1 || fps > 10) {
    return {
      valid: false,
      error: { field: 'fps', message: 'FPS deve ser um número inteiro de 1 a 10.' },
    };
  }

  return { valid: true, value: { file, fps } };
}
