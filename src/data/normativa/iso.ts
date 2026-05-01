/**
 * ISO 45001:2018 — Universal Occupational Health and Safety Management System.
 *
 * Used as the last-resort fallback when the user is in an unsupported country
 * or country detection fails.
 *
 * Clauses 4-10 follow the Annex SL High-Level Structure (HLS):
 *  4 — Context of the organization
 *  5 — Leadership and worker participation
 *  6 — Planning (risks, opportunities, legal & other requirements, OH&S objectives)
 *  7 — Support (resources, competence, awareness, communication, documented information)
 *  8 — Operation (operational planning, hazard elimination, MOC, procurement, emergency)
 *  9 — Performance evaluation (monitoring, internal audit, management review)
 * 10 — Improvement (incident, nonconformity, corrective action, continual improvement)
 *
 * Source: ISO 45001:2018 official text (purchasable at iso.org); summaries below
 * are paraphrased from the public table of contents and clause headings.
 */
import type { CountryPack } from '../../services/normativa/countryPacks';

export const ISO_PACK: CountryPack = {
  code: 'ISO',
  name: 'ISO 45001 (Universal)',
  flag: '🌐',
  language: 'en',
  iso45001Compatibility: 'high',
  notes:
    'Universal fallback. ISO 45001:2018 is jurisdiction-agnostic; pair with local legal counsel for country-specific obligations.',
  thresholds: {
    /**
     * ISO 45001 does not prescribe numeric worker thresholds; it requires "consultation
     * and participation of workers" (clause 5.4) appropriate to organisation size & risk.
     * We expose 0 to signal "always required" for the participation mechanism.
     */
    comiteRequiredAtWorkers: 0,
    preventionDeptRequiredAtWorkers: 0,
    monthlyMeetingsRequired: false,
  },
  regulations: [
    {
      id: 'iso-45001-cl4',
      title: 'ISO 45001:2018 — Clause 4: Context of the Organization',
      reference: 'ISO 45001:2018, §4',
      scope:
        'Understand the organisation and its context, needs of interested parties (workers + others), scope of the OH&S MS, and the OH&S MS itself.',
      url: 'https://www.iso.org/standard/63787.html',
    },
    {
      id: 'iso-45001-cl5',
      title: 'ISO 45001:2018 — Clause 5: Leadership and Worker Participation',
      reference: 'ISO 45001:2018, §5',
      scope:
        'Top management commitment, OH&S policy, organisational roles & responsibilities, consultation and participation of workers (§5.4 — non-managerial).',
      url: 'https://www.iso.org/standard/63787.html',
    },
    {
      id: 'iso-45001-cl6',
      title: 'ISO 45001:2018 — Clause 6: Planning',
      reference: 'ISO 45001:2018, §6',
      scope:
        'Hazard identification, risk & opportunity assessment, legal/other requirements, OH&S objectives and planning to achieve them.',
      url: 'https://www.iso.org/standard/63787.html',
    },
    {
      id: 'iso-45001-cl7',
      title: 'ISO 45001:2018 — Clause 7: Support',
      reference: 'ISO 45001:2018, §7',
      scope:
        'Resources, competence, awareness, communication (internal/external), documented information.',
      url: 'https://www.iso.org/standard/63787.html',
    },
    {
      id: 'iso-45001-cl8',
      title: 'ISO 45001:2018 — Clause 8: Operation',
      reference: 'ISO 45001:2018, §8',
      scope:
        'Operational planning & control, hierarchy of controls (eliminate→substitute→engineer→admin→PPE), management of change, procurement, contractors & outsourcing, emergency preparedness.',
      url: 'https://www.iso.org/standard/63787.html',
    },
    {
      id: 'iso-45001-cl9',
      title: 'ISO 45001:2018 — Clause 9: Performance Evaluation',
      reference: 'ISO 45001:2018, §9',
      scope:
        'Monitoring, measurement, analysis & evaluation; evaluation of compliance; internal audit; management review.',
      url: 'https://www.iso.org/standard/63787.html',
    },
    {
      id: 'iso-45001-cl10',
      title: 'ISO 45001:2018 — Clause 10: Improvement',
      reference: 'ISO 45001:2018, §10',
      scope:
        'Incident, nonconformity & corrective action; continual improvement of the OH&S MS suitability, adequacy and effectiveness.',
      url: 'https://www.iso.org/standard/63787.html',
    },
  ],
};
