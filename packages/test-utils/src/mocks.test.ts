import { describe, expect, it } from '@jest/globals';

import { createMock } from './mocks.js';

type Handler = (videoId: string) => Promise<string>;

describe('shared test mocks', () => {
  it('creates a typed Jest mock', async () => {
    const handler = createMock<Handler>();
    handler.mockResolvedValue('completed');

    await expect(handler('video-1')).resolves.toBe('completed');
    expect(handler).toHaveBeenCalledWith('video-1');
  });
});
