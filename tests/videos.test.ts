import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadVideos } from '../src/videos.js';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nbs-videos-test-'));
  file = path.join(dir, 'videos.json');
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('loadVideos', () => {
  it('loads and normalizes a valid list', async () => {
    await fs.writeFile(
      file,
      JSON.stringify({
        videos: [
          {
            url: 'https://youtu.be/dQw4w9WgXcQ',
            title: 'English video',
            language: 'en',
          },
          {
            url: 'https://www.youtube.com/watch?v=abcdefghijk',
            title: 'German video',
            language: 'de',
          },
        ],
      }),
    );
    const videos = await loadVideos(file);
    expect(videos).toEqual([
      {
        url: 'https://youtu.be/dQw4w9WgXcQ',
        videoId: 'dQw4w9WgXcQ',
        title: 'English video',
        language: 'en',
      },
      {
        url: 'https://www.youtube.com/watch?v=abcdefghijk',
        videoId: 'abcdefghijk',
        title: 'German video',
        language: 'de',
      },
    ]);
  });

  it('gives a helpful error when the file is missing', async () => {
    await expect(loadVideos(file)).rejects.toThrow('videos.example.json');
  });

  it('rejects invalid JSON', async () => {
    await fs.writeFile(file, '{ oops');
    await expect(loadVideos(file)).rejects.toThrow('not valid JSON');
  });

  it('rejects an empty list', async () => {
    await fs.writeFile(file, JSON.stringify({ videos: [] }));
    await expect(loadVideos(file)).rejects.toThrow('at least one');
  });

  it('lists every bad link instead of silently skipping', async () => {
    await fs.writeFile(
      file,
      JSON.stringify({
        videos: [
          { url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Good', language: 'en' },
          { url: 'https://vimeo.com/1', title: 'Bad one', language: 'en' },
          { url: 'not a link', title: 'Bad two', language: 'en' },
        ],
      }),
    );
    const error = await loadVideos(file).catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('vimeo.com');
    expect((error as Error).message).toContain('not a link');
  });

  it('requires a title and valid requested caption language', async () => {
    await fs.writeFile(
      file,
      JSON.stringify({
        videos: [{ url: 'https://youtu.be/dQw4w9WgXcQ', title: '', language: 'english' }],
      }),
    );
    await expect(loadVideos(file)).rejects.toThrow('wrong shape');
  });
});
