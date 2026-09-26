export const MAX_VIDEO_UPLOAD_BYTES = 200 * 1024 * 1024;
export const DEFAULT_VIDEO_FPS = 1;
export const MIN_VIDEO_FPS = 1;
export const MAX_VIDEO_FPS = 10;

function startsWith(content: Buffer, signature: readonly number[]): boolean {
  return (
    content.length >= signature.length &&
    signature.every((value, index) => content[index] === value)
  );
}

function hasAscii(content: Buffer, offset: number, value: string): boolean {
  return (
    content.length >= offset + value.length &&
    content.toString('ascii', offset, offset + value.length) === value
  );
}

export function hasVideoSignature(extension: string, content: Buffer): boolean {
  switch (extension.toLowerCase()) {
    case 'mp4':
      return hasAscii(content, 4, 'ftyp');
    case 'mov':
      return ['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip'].some((atom) =>
        hasAscii(content, 4, atom),
      );
    case 'avi':
      return hasAscii(content, 0, 'RIFF') && hasAscii(content, 8, 'AVI ');
    case 'mkv':
    case 'webm':
      return startsWith(content, [0x1a, 0x45, 0xdf, 0xa3]);
    case 'wmv':
      return startsWith(
        content,
        [
          0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9, 0x00, 0xaa, 0x00, 0x62, 0xce,
          0x6c,
        ],
      );
    case 'flv':
      return hasAscii(content, 0, 'FLV');
    default:
      return false;
  }
}
