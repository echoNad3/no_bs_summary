import { describe, expect, it } from 'vitest';
import { extractVideoId } from '../src/youtube.js';

const ID = 'dQw4w9WgXcQ';

describe('extractVideoId', () => {
  it('parses a normal watch link', () => {
    expect(extractVideoId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID);
  });

  it('parses a youtu.be short link', () => {
    expect(extractVideoId(`https://youtu.be/${ID}`)).toBe(ID);
  });

  it('parses a Shorts link', () => {
    expect(extractVideoId(`https://www.youtube.com/shorts/${ID}`)).toBe(ID);
  });

  it('parses a live link', () => {
    expect(extractVideoId(`https://www.youtube.com/live/${ID}`)).toBe(ID);
  });

  it('ignores extra query parameters', () => {
    expect(extractVideoId(`https://www.youtube.com/watch?v=${ID}&t=42s&list=PLx&si=abc`)).toBe(ID);
    expect(extractVideoId(`https://youtu.be/${ID}?si=share-junk&t=10`)).toBe(ID);
  });

  it('accepts mobile and music subdomains', () => {
    expect(extractVideoId(`https://m.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(extractVideoId(`https://music.youtube.com/watch?v=${ID}`)).toBe(ID);
  });

  it('rejects non-URLs', () => {
    expect(() => extractVideoId('not a link')).toThrow('Not a valid web address');
  });

  it('rejects non-YouTube links', () => {
    expect(() => extractVideoId('https://vimeo.com/12345')).toThrow('Not a YouTube link');
  });

  it('rejects unsupported YouTube pages', () => {
    expect(() => extractVideoId('https://www.youtube.com/@somechannel')).toThrow('not supported');
    expect(() => extractVideoId('https://www.youtube.com/playlist?list=PLx')).toThrow(
      'not supported',
    );
  });

  it('rejects watch links with a malformed video ID', () => {
    expect(() => extractVideoId('https://www.youtube.com/watch?v=tooshort')).toThrow(
      'valid video ID',
    );
  });

  it('rejects non-web protocols', () => {
    expect(() => extractVideoId(`ftp://youtube.com/watch?v=${ID}`)).toThrow('https://');
  });
});
