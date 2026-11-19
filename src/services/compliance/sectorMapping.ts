// Only sectors used by sector-specific rules are mapped. Unmapped industries
// still receive rules that do not require a sector.
const industryToSector = new Map([
  ['mining', 'GP-MIN'],
  ['construction', 'GP-CONS'],
  ['energy', 'GP-ELEC'],
]);

export function resolveComplianceSector(project: Record<string, unknown>): string | undefined {
  if (typeof project.sectorId === 'string' && project.sectorId.startsWith('GP-')) {
    return project.sectorId;
  }
  return typeof project.industry_code === 'string' ? industryToSector.get(project.industry_code) : undefined;
}