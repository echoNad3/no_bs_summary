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

export function firstYouTubeUrl(text: string): string {
  const match = text.match(
    /https?:\/\/(?:www\.)?(?:youtu\.be\/|youtube\.com\/(?:watch|shorts\/|live\/))[^\s<]+/iu,
  );
  if (!match) return '';
  return match[0].replace(/[),.;!?]+$/u, '');
}
