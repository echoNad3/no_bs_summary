import { promises as fs } from 'node:fs';
import { z } from 'zod';
import type { BenchmarkVideo } from './benchmark.js';
import { extractVideoId } from './youtube.js';
import { languageSchema } from './transcript/provider.js';

/**
 * Loads videos.json and turns every link into a video ID.
 * If ANY link is invalid the whole run stops and every bad link is listed —
 * nothing is ever silently skipped.
 */

const videosFileSchema = z.object({
  videos: z
    .array(
      z.object({
        url: z.string().trim().min(1),
        title: z.string().trim().min(1),
        language: languageSchema,
      }),
    )
    .min(1, 'the "videos" list must contain at least one entry'),
});

export async function loadVideos(filePath: string): Promise<BenchmarkVideo[]> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch {
    throw new Error(
      `Could not find ${filePath}. Copy videos.example.json, rename the copy to videos.json ` +
        `and put your YouTube links in it.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${filePath} is not valid JSON. Compare it with videos.example.json.`);
  }

  const file = videosFileSchema.safeParse(parsed);
  if (!file.success) {
    throw new Error(
      `${filePath} has the wrong shape (${file.error.issues[0]?.message ?? 'invalid'}). ` +
        `Compare it with videos.example.json.`,
    );
  }

  const videos: BenchmarkVideo[] = [];
  const problems: string[] = [];
  for (const entry of file.data.videos) {
    try {
      videos.push({ ...entry, videoId: extractVideoId(entry.url) });
    } catch (error) {
      problems.push(`  - ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Some links in ${filePath} are not usable:\n${problems.join('\n')}\n` +
        `Fix or remove them, then run again.`,
    );
  }

  return videos;
}
