import { describe, expect, it } from '@jest/globals';

import {
  DEFAULT_VIDEO_FPS,
  MAX_VIDEO_FPS,
  MAX_VIDEO_UPLOAD_BYTES,
  MIN_VIDEO_FPS,
  hasVideoSignature,
} from './upload-policy.js';

const isoBaseMedia = Buffer.from('000000186674797069736f6d0000000069736f6d', 'hex');
const avi = Buffer.from('524946460000000041564920', 'hex');
const ebml = Buffer.from('1a45dfa300000000', 'hex');
const asf = Buffer.from('3026b2758e66cf11a6d900aa0062ce6c', 'hex');
const flv = Buffer.from('464c5601', 'hex');

describe('video upload policy', () => {
  it('fixes the service limit at exactly 200 MiB and FPS at integer values from 1 to 10', () => {
    expect(MAX_VIDEO_UPLOAD_BYTES).toBe(209_715_200);
    expect({ default: DEFAULT_VIDEO_FPS, minimum: MIN_VIDEO_FPS, maximum: MAX_VIDEO_FPS }).toEqual({
      default: 1,
      minimum: 1,
      maximum: 10,
    });
  });

  it.each([
    ['MP4', isoBaseMedia],
    ['mov', isoBaseMedia],
    ['AVI', avi],
    ['mkv', ebml],
    ['WebM', ebml],
    ['WMV', asf],
    ['flv', flv],
  ])(
    'accepts the %s extension case-insensitively only with matching content',
    (extension, content) => {
      expect(hasVideoSignature(extension, content)).toBe(true);
    },
  );

  it('rejects unknown extensions and mismatched or truncated content', () => {
    expect(hasVideoSignature('mp4', avi)).toBe(false);
    expect(hasVideoSignature('avi', Buffer.from('RIFF'))).toBe(false);
    expect(hasVideoSignature('exe', isoBaseMedia)).toBe(false);
  });
});
