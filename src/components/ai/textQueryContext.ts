// Experimental lexical projection of an already-loaded client snapshot.
// Not authorization, a complete project scan, semantic recall or anonymization.
import { redactPii } from '../../services/observability/piiRedactor';
export function localProjectTextContext(query: string, nodes: readonly unknown[], projectId?: string) {
  const ranked: { id: string; title: string; description: string; type: string; score: number }[] = [];
  let truncated = false;
  const text = (value: unknown, limit: number) => {
    if (typeof value !== 'string') return '';
    if (value.length > 16_384) { truncated = true; return ''; }
    const clean = redactPii(value).redacted;
    const result = clean.slice(0, limit).replace(/[\uD800-\uDBFF]$/, '');
    if (result !== clean) truncated = true;
    return result;
  };
  const tokens = (value: string) => new Set((value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => word.length > 2));
  const allTerms = query.length <= 16_384 ? Array.from(tokens(query)) : [];
  if (query.length > 16_384 || allTerms.length > 64) truncated = true;
  const terms = allTerms.slice(0, 64);
  const seen = new Set<string>();
  let candidates = 0;
  if (projectId && terms.length > 0) for (const node of nodes) {
    if (!node || typeof node !== 'object' || !('projectId' in node) || node.projectId !== projectId) continue;
    if (!('id' in node) || typeof node.id !== 'string' || node.id.length === 0 || node.id.length > 1500) { truncated = true; continue; }
    if (seen.has(node.id)) continue;
    if (candidates === 500) { truncated = true; break; }
    seen.add(node.id);
    candidates += 1;
    const title = text('title' in node ? node.title : '', 200);
    const description = text('description' in node ? node.description : '', 600);
    const type = text('type' in node ? node.type : '', 80);
    const titleTokens = tokens(title), descriptionTokens = tokens(description);
    let score = 0;
    for (const term of terms) { if (titleTokens.has(term)) score += 3; if (descriptionTokens.has(term)) score += 1; }
    if (score > 0) ranked.push({ id: node.id, title, description, type, score });
  }
  ranked.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const records: { id: string; title: string; description: string; type: string }[] = [];
  const serialize = (items: typeof records) => JSON.stringify({ source: 'local-project-records', method: 'lexical-experimental', projection: { coverage: 'partial-client-snapshot', candidateLimit: 500, recordLimit: 5, truncated }, records: items });
  for (const { id, title, description, type } of ranked) {
    if (records.length === 5) { truncated = true; break; }
    const record = { id, title, description, type };
    if (serialize([...records, record]).length > 4000) { truncated = true; continue; }
    records.push(record);
  }
  return { context: serialize(records), selectedCount: records.length, truncated };
}
