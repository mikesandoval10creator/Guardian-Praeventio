// src/navigation/searchNav.ts
import type { NavBlock, NavItem } from './navCatalog';

export interface NavSearchResult {
  item: NavItem;
  blockTitle: string;
}

/** Lowercase + strip diacritics for accent/case-insensitive matching. */
function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Busca módulos en el catálogo por substring de título o bloque.
 * Orden: prefijo-de-título > substring-de-título > substring-de-bloque.
 */
export function searchNav(
  blocks: NavBlock[],
  query: string,
  limit = 8,
): NavSearchResult[] {
  const q = fold(query.trim());
  if (!q) return [];
  const scored: Array<NavSearchResult & { score: number }> = [];
  for (const block of blocks) {
    const fb = fold(block.title);
    for (const item of block.items) {
      const ft = fold(item.title);
      let score = -1;
      if (ft.startsWith(q)) score = 3;
      else if (ft.includes(q)) score = 2;
      else if (fb.includes(q)) score = 1;
      if (score >= 0) scored.push({ item, blockTitle: block.title, score });
    }
  }
  scored.sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title));
  return scored.slice(0, limit).map(({ item, blockTitle }) => ({ item, blockTitle }));
}
