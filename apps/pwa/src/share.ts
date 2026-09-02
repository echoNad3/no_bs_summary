import { firstYouTubeUrl } from '../../shared/youtube-input.js';

export interface SharedValues {
  url: string;
  title: string;
  wasShared: boolean;
}

export function readSharedValues(search: string): SharedValues {
  const params = new URLSearchParams(search);
  const directUrl = params.get('url')?.trim() ?? '';
  const text = params.get('text')?.trim() ?? '';
  const url = directUrl || firstYouTubeUrl(text);
  return {
    url,
    title: params.get('title')?.trim() ?? '',
    wasShared: url !== '' || text !== '' || params.has('title'),
  };
}

export { firstYouTubeUrl } from '../../shared/youtube-input.js';
