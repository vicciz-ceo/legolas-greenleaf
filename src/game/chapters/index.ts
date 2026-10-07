import type { ChapterDef } from '../../core/types';

/**
 * Chapter registry. Every file in this folder named `cN_<id>.ts` (N = 0..9) must
 * `export const chapter: ChapterDef`. They are discovered automatically — do not
 * list them here by hand.
 */
const modules = import.meta.glob<{ chapter: ChapterDef }>('./c[0-9]_*.ts', { eager: true });

export const CHAPTERS: ChapterDef[] = Object.values(modules)
  .map((m) => m.chapter)
  .filter((c): c is ChapterDef => !!c)
  .sort((a, b) => a.number - b.number);

export function chapterById(id: string): ChapterDef | undefined {
  return CHAPTERS.find((c) => c.id === id);
}

/** Story chapters (excludes the dev arena) */
export function storyChapters(): ChapterDef[] {
  return CHAPTERS.filter((c) => !c.dev && c.number > 0);
}
