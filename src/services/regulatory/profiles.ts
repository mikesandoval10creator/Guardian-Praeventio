// Sprint 48 E.4 — Perfiles de jurisdicción para 6 países (UK/CA/AU/JP/KR/IN)
// + Chile/US/EU/MX/BR/CN/TW/RU. Capa aditiva sobre los `*_REFERENCES`
// existentes; consumida por `jurisdictionRegistry.ts`.
//
// Cada perfil concentra:
//   - regulator primario y statutes principales
//   - umbrales numéricos (comités, written risk assessment, stress check)
//   - deadlines incidentes (RIDDOR 7-day, OSHA-K immediate, etc.)
//   - régimen de privacidad asociado
//   - números de emergencia locales
//
// NUNCA usar free-text para retention/deadlines: todos los días/horas son
// numéricos.

import type { JurisdictionCode } from './types.js';
import type { PrivacyRegimeCode } from './privacyRegimes.js';

export interface JurisdictionRegulationEntry {
  id: string;
  title: string;
  category:
    | 'statute'
    | 'regulation'
    | 'code-of-practice'
    | 'standard'
    | 'criminal-liability';
  /** Umbral mínimo (≥) de trabajadores que activa la norma. */
  mandatoryAtCount?: number;
  reference: string;
}

export interface IncidentReporting {
  authority: string;
  /** Deadline genérico (días) para reportar accidentes serios (no fatales). */
  deadlineDays: number;
  /** Fatalidad → reporte inmediato (true) o dentro del deadline general. */
  fatalityImmediate: boolean;
  formName: string;
  electronicSubmission: boolean;
}

export interface MandatoryCommittee {
  name: string;
  /** Umbral (≥) de trabajadores que dispara la obligación. */
  minEmployees: number;
  scope: string;
}

export interface LocalizedEmergencyNumbers {
  medical: string;
  fire: string;
  police: string;
}

export interface JurisdictionProfile {
  code: JurisdictionCode;
  name: string;
  primaryRegulator: string;
  regulations: JurisdictionRegulationEntry[];
  incidentReporting: IncidentReporting;
  privacyRegime: PrivacyRegimeCode;
  mandatoryCommittees: MandatoryCommittee[];
  localizedNumbers: LocalizedEmergencyNumbers;
}

// ────────────────────────────────────────────────────────────────────────
// UK — HSE
// ────────────────────────────────────────────────────────────────────────

export const PROFILE_UK: JurisdictionProfile = {
  code: 'UK',
  name: 'United Kingdom',
  primaryRegulator: 'Health and Safety Executive (HSE)',
  regulations: [
    {
      id: 'HSWA-1974',
      title: 'Health and Safety at Work etc. Act 1974',
      category: 'statute',
      reference: 'https://www.legislation.gov.uk/ukpga/1974/37',
    },
    {
      id: 'MHSWR-1999',
      title: 'Management of Health and Safety at Work Regulations 1999',
      category: 'regulation',
      // KW rule — written risk assessment requerido cuando hay 5+ empleados.
      mandatoryAtCount: 5,
      reference: 'https://www.legislation.gov.uk/uksi/1999/3242',
    },
    {
      id: 'RIDDOR-2013',
      title:
        'Reporting of Injuries, Diseases and Dangerous Occurrences Regulations 2013',
      category: 'regulation',
      reference: 'https://www.hse.gov.uk/riddor/',
    },
    {
      id: 'COSHH-2002',
      title: 'Control of Substances Hazardous to Health Regulations 2002',
      category: 'regulation',
      reference: 'https://www.hse.gov.uk/coshh/',
    },
    {
      id: 'PPER-2022',
      title:
        'Personal Protective Equipment at Work (Amendment) Regulations 2022',
      category: 'regulation',
      reference: 'https://www.hse.gov.uk/ppe/ppe-regulations-2022.htm',
    },
    {
      id: 'CDM-2015',
      title: 'Construction (Design and Management) Regulations 2015',
      category: 'regulation',
      reference: 'https://www.hse.gov.uk/construction/cdm/2015/',
    },
  ],
  incidentReporting: {
    authority: 'HSE',
    // RIDDOR 7-day rule: incapacidad >7 días → reporte.
    deadlineDays: 7,
    fatalityImmediate: true,
    formName: 'RIDDOR Form F2508',
    electronicSubmission: true,
  },
  privacyRegime: 'UK-DPA',
  mandatoryCommittees: [
    {
      name: 'Safety Representatives (SRSCR 1977)',
      minEmployees: 1,
      scope:
        'Sindicato reconocido designa representantes; aplica desde 1 trabajador en empresa sindicalizada',
    },
    {
      name: 'Safety Committee (SRSCR 1977 reg.9)',
      minEmployees: 2,
      scope:
        'Comité formal obligatorio si los representantes sindicales lo solicitan por escrito',
    },
  ],
  localizedNumbers: { medical: '999', fire: '999', police: '999' },
};

// ────────────────────────────────────────────────────────────────────────
// Canadá — federal + provincial (Ontario JHSC threshold)
// ────────────────────────────────────────────────────────────────────────

export const PROFILE_CA: JurisdictionProfile = {
  code: 'CA',
  name: 'Canada',
  primaryRegulator: 'Labour Program (Employment and Social Development Canada) + CCOHS',
  regulations: [
    {
      id: 'CLC-Part-II',
      title: 'Canada Labour Code Part II',
      category: 'statute',
      reference: 'https://laws-lois.justice.gc.ca/eng/acts/L-2/',
    },
    {
      id: 'COHSR',
      title: 'Canada Occupational Health and Safety Regulations',
      category: 'regulation',
      reference: 'https://laws-lois.justice.gc.ca/eng/regulations/sor-86-304/',
    },
    {
      id: 'ON-OHSA',
      title: 'Ontario Occupational Health and Safety Act',
      category: 'statute',
      // JHSC obligatorio ≥20 trabajadores en Ontario.
      mandatoryAtCount: 20,
      reference: 'https://www.ontario.ca/laws/statute/90o01',
    },
    {
      id: 'AB-OHSA',
      title: 'Alberta Occupational Health and Safety Act',
      category: 'statute',
      reference: 'https://kings-printer.alberta.ca/1266.cfm?page=O02P1.cfm',
    },
    {
      id: 'BC-WCA',
      title: 'British Columbia Workers Compensation Act',
      category: 'statute',
      reference: 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/19001',
    },
    {
      id: 'WHMIS-2015',
      title: 'Workplace Hazardous Materials Information System 2015 (HPR)',
      category: 'regulation',
      reference: 'https://www.ccohs.ca/oshanswers/chemicals/whmis_ghs/',
    },
  ],
  incidentReporting: {
    authority: 'Labour Program / provincial board',
    deadlineDays: 3,
    fatalityImmediate: true,
    formName: 'Hazardous Occurrence Investigation Report (LAB1070)',
    electronicSubmission: true,
  },
  privacyRegime: 'PIPEDA',
  mandatoryCommittees: [
    {
      name: 'Workplace Health and Safety Committee (federal)',
      minEmployees: 20,
      scope:
        'COHSR Part XX — obligatorio en lugares de jurisdicción federal con ≥20 trabajadores',
    },
    {
      name: 'Joint Health and Safety Committee (Ontario)',
      minEmployees: 20,
      scope: 'Ontario OHSA §9 — JHSC con mínimo 2 miembros (1 trabajador + 1 empleador)',
    },
    {
      name: 'Health and Safety Representative (Ontario)',
      minEmployees: 6,
      scope: 'Ontario OHSA §8 — representante obligatorio entre 6 y 19 trabajadores',
    },
  ],
  localizedNumbers: { medical: '911', fire: '911', police: '911' },
};

// ────────────────────────────────────────────────────────────────────────
// Australia — Model WHS (federal harmonized) + state
// ────────────────────────────────────────────────────────────────────────

export const PROFILE_AU: JurisdictionProfile = {
  code: 'AU',
  name: 'Australia',
  primaryRegulator: 'Safe Work Australia + state regulators (SafeWork NSW, WorkSafe Vic, etc.)',
  regulations: [
    {
      id: 'WHS-Act-2011',
      title: 'Work Health and Safety Act 2011 (model law)',
      category: 'statute',
      reference: 'https://www.safeworkaustralia.gov.au/law-and-regulation/model-whs-laws/model-whs-act',
    },
    {
      id: 'WHS-Regulations-2011',
      title: 'Work Health and Safety Regulations 2011 (model)',
      category: 'regulation',
      reference: 'https://www.safeworkaustralia.gov.au/law-and-regulation/model-whs-laws/model-whs-regulations',
    },
    {
      id: 'VIC-OHS-Act-2004',
      title: 'Victoria Occupational Health and Safety Act 2004',
      category: 'statute',
      reference: 'https://www.legislation.vic.gov.au/in-force/acts/occupational-health-and-safety-act-2004',
    },
    {
      id: 'ICAM',
      title: 'ICAM — Incident Cause Analysis Method (industry framework)',
      category: 'code-of-practice',
      reference: 'https://www.safeworkaustralia.gov.au/',
    },
    {
      id: 'COP-Hazardous-Manual-Tasks',
      title: 'Code of Practice — Hazardous Manual Tasks',
      category: 'code-of-practice',
      reference: 'https://www.safeworkaustralia.gov.au/doc/model-code-practice-hazardous-manual-tasks',
    },
  ],
  incidentReporting: {
    authority: 'State WHS regulator (e.g. SafeWork NSW)',
    // Notifiable incidents (muerte/lesión grave/dangerous incident) → inmediato + record-keeping 5 años.
    deadlineDays: 0,
    fatalityImmediate: true,
    formName: 'Notifiable Incident Notification',
    electronicSubmission: true,
  },
  privacyRegime: 'APP',
  mandatoryCommittees: [
    {
      name: 'Health and Safety Representative (HSR)',
      // HSR election se puede solicitar a partir de 1 trabajador; el "workgroup
      // ≥20" es un umbral conservador para el ICAM root-cause requirement.
      minEmployees: 20,
      scope: 'WHS Act 2011 Part 5 — workers pueden solicitar elección de HSR; PCBU debe facilitar',
    },
    {
      name: 'Health and Safety Committee',
      minEmployees: 20,
      scope: 'WHS Act 2011 §75 — comité obligatorio si HSR o ≥5 trabajadores lo solicitan',
    },
  ],
  localizedNumbers: { medical: '000', fire: '000', police: '000' },
};

// ────────────────────────────────────────────────────────────────────────
// Japón — ISHA 1972 + Stress Check 50+
// ────────────────────────────────────────────────────────────────────────

export const PROFILE_JP: JurisdictionProfile = {
  code: 'JP',
  name: '日本 (Japan)',
  primaryRegulator: 'Ministry of Health, Labour and Welfare (MHLW)',
  regulations: [
    {
      id: 'ISHA-1972',
      title: 'Industrial Safety and Health Act (労働安全衛生法) Law No.57 of 1972',
      category: 'statute',
      reference: 'https://www.mhlw.go.jp/english/',
    },
    {
      id: 'ISH-Reg-Ordinance',
      title: 'Industrial Safety and Health Regulation Ordinance (労働安全衛生規則)',
      category: 'regulation',
      reference: 'https://www.mhlw.go.jp/english/',
    },
    {
      id: 'JIS-Z-45001',
      title: 'JIS Z 45001:2018 — OH&S Management Systems',
      category: 'standard',
      reference: 'https://www.jisc.go.jp',
    },
    {
      id: 'ISHA-1972-art.10',
      title: 'ISHA art.10 — General Safety and Health Manager (総括安全衛生管理者)',
      category: 'regulation',
      // Safety & Health Manager obligatorio en sitios con ≥50/100/300 trabajadores
      // según industria (manufacturing 100, construction 50, retail 300). Usamos
      // 50 como umbral conservador inicial.
      mandatoryAtCount: 50,
      reference: 'https://www.mhlw.go.jp/english/',
    },
    {
      id: 'ISHA-1972-art.66-10',
      title: 'ISHA art.66-10 — Stress Check Program (ストレスチェック制度)',
      category: 'regulation',
      mandatoryAtCount: 50,
      reference: 'https://www.mhlw.go.jp/english/',
    },
    {
      id: 'ASW-certification',
      title: 'Authorized Safety Worker (作業主任者) certification',
      category: 'regulation',
      reference: 'https://www.mhlw.go.jp/english/',
    },
  ],
  incidentReporting: {
    authority: 'Labour Standards Inspection Office (労働基準監督署)',
    deadlineDays: 1,
    fatalityImmediate: true,
    formName: '労働者死傷病報告 (Workers Casualty Report)',
    electronicSubmission: true,
  },
  privacyRegime: 'PIPA-JP',
  mandatoryCommittees: [
    {
      name: 'Safety and Health Committee (安全衛生委員会)',
      minEmployees: 50,
      scope:
        'ISHA art.17–19 — comité paritario obligatorio en sitios con ≥50 trabajadores; reuniones mensuales',
    },
    {
      name: 'Industrial Physician (産業医)',
      minEmployees: 50,
      scope:
        'ISHA art.13 — designación obligatoria de médico ocupacional en sitios con ≥50 trabajadores',
    },
  ],
  localizedNumbers: { medical: '119', fire: '119', police: '110' },
};

// ────────────────────────────────────────────────────────────────────────
// Corea del Sur — OSHA-K 1981/2019 + SAPA 2022
// ────────────────────────────────────────────────────────────────────────

export const PROFILE_KR: JurisdictionProfile = {
  code: 'KR',
  name: '대한민국 (South Korea)',
  primaryRegulator: 'Ministry of Employment and Labor (MOEL) + KOSHA',
  regulations: [
    {
      id: 'OSHA-K-1981',
      title: 'Occupational Safety and Health Act (산업안전보건법) 1981 (reformed 2019)',
      category: 'statute',
      reference: 'https://www.moel.go.kr/english/',
    },
    {
      id: 'OSHA-K-Enforcement-Decree',
      title: 'Enforcement Decree of OSH Act (산업안전보건법 시행령)',
      category: 'regulation',
      reference: 'https://www.moel.go.kr/english/',
    },
    {
      id: 'SAPA-2022',
      title: 'Serious Accidents Punishment Act (중대재해처벌법) — 2022',
      category: 'criminal-liability',
      // Criterio penal: ≥1 muerte o ≥2 trabajadores con lesión grave en una empresa ≥50 empleados.
      mandatoryAtCount: 50,
      reference: 'https://www.moel.go.kr/english/',
    },
    {
      id: 'KOSHA-MS',
      title: 'KOSHA-MS — Korea OSH Management System',
      category: 'standard',
      reference: 'https://www.kosha.or.kr/english',
    },
    {
      id: 'KCS-04-01',
      title: 'KCS-04-01 — Construction safety standard',
      category: 'standard',
      reference: 'https://www.kosha.or.kr/english',
    },
  ],
  incidentReporting: {
    authority: 'MOEL Labour Office + KOSHA',
    deadlineDays: 1,
    fatalityImmediate: true,
    formName: '산업재해조사표 (Industrial Accident Investigation Report)',
    electronicSubmission: true,
  },
  privacyRegime: 'PIPA-KR',
  mandatoryCommittees: [
    {
      name: 'Industrial Safety and Health Committee (산업안전보건위원회)',
      minEmployees: 100,
      scope:
        'OSHA-K art.24 — comité paritario obligatorio en sitios ≥100 trabajadores (algunas industrias ≥50)',
    },
    {
      name: 'Safety and Health Manager (안전보건관리책임자)',
      minEmployees: 50,
      scope:
        'OSHA-K art.15 — designación obligatoria de safety manager en sitios ≥50 trabajadores',
    },
  ],
  localizedNumbers: { medical: '119', fire: '119', police: '112' },
};

// ────────────────────────────────────────────────────────────────────────
// India — Factories Act 1948 + OSH Code 2020
// ────────────────────────────────────────────────────────────────────────

export const PROFILE_IN: JurisdictionProfile = {
  code: 'IN',
  name: 'भारत (India)',
  primaryRegulator: 'Ministry of Labour & Employment + state Factory Inspectorates',
  regulations: [
    {
      id: 'Factories-Act-1948',
      title: 'Factories Act 1948 (Amendment 2014)',
      category: 'statute',
      // §41G safety committee obligatorio en fábricas con processes hazardous;
      // pero el umbral genérico para comité es ≥250 trabajadores (state factory rules).
      reference: 'https://labour.gov.in',
    },
    {
      id: 'OSH-Code-2020',
      title:
        'Occupational Safety, Health and Working Conditions Code 2020',
      category: 'statute',
      reference: 'https://labour.gov.in/sites/default/files/OSH_Code_Gazette.pdf',
    },
    {
      id: 'BOCW-Act-1996',
      title: 'Building and Other Construction Workers Act 1996',
      category: 'statute',
      mandatoryAtCount: 10,
      reference: 'https://labour.gov.in',
    },
    {
      id: 'Factories-Act-s.41G',
      title: 'Factories Act §41G — Safety Committee',
      category: 'regulation',
      mandatoryAtCount: 250,
      reference: 'https://labour.gov.in',
    },
    {
      id: 'Mines-Act-1952',
      title: 'Mines Act 1952 + Mines Rules 1955',
      category: 'statute',
      reference: 'https://labour.gov.in',
    },
    {
      id: 'NSC-HIRA',
      title: 'NSC India — Risk Assessment & HIRA Guidance',
      category: 'code-of-practice',
      reference: 'https://nsc.org.in',
    },
  ],
  incidentReporting: {
    authority: 'Inspector-cum-Facilitator (state Factory Inspectorate)',
    deadlineDays: 1,
    fatalityImmediate: true,
    formName: 'Form 18 (Notice of Accident)',
    electronicSubmission: false,
  },
  privacyRegime: 'DPDP',
  mandatoryCommittees: [
    {
      name: 'Safety Committee (Factories Act §41G)',
      minEmployees: 250,
      scope:
        'Factories Act §41G — obligatorio en fábricas con procesos peligrosos o ≥250 trabajadores según state rules',
    },
    {
      name: 'Welfare Officer (Factories Act §49)',
      minEmployees: 500,
      scope: 'Factories Act §49 — Welfare officer obligatorio en fábricas con ≥500 trabajadores',
    },
  ],
  localizedNumbers: { medical: '102', fire: '101', police: '100' },
};

// ────────────────────────────────────────────────────────────────────────
// Perfiles legacy (compactos) para jurisdicciones pre-Sprint-48
// ────────────────────────────────────────────────────────────────────────

const PROFILE_CL: JurisdictionProfile = {
  code: 'CL',
  name: 'Chile',
  primaryRegulator: 'SUSESO + Dirección del Trabajo + MINSAL',
  regulations: [
    { id: 'Ley-16.744', title: 'Ley 16.744 — Accidentes y enfermedades profesionales', category: 'statute', reference: 'https://www.bcn.cl/leychile/navegar?idNorma=28650' },
    { id: 'DS-54', title: 'DS 54 — Comité Paritario de Higiene y Seguridad', category: 'regulation', mandatoryAtCount: 25, reference: 'https://www.bcn.cl/leychile/navegar?idNorma=10626' },
    { id: 'DS-594', title: 'DS 594 — Condiciones sanitarias y ambientales', category: 'regulation', reference: 'https://www.bcn.cl/leychile/navegar?idNorma=167766' },
  ],
  incidentReporting: { authority: 'SUSESO + Mutualidad', deadlineDays: 1, fatalityImmediate: true, formName: 'DIAT/DIEP', electronicSubmission: true },
  // 🇨🇱 Fix 2026-06: antes apuntaba a 'LGPD' como placeholder ("similar a
  // LGPD/GDPR-lite"). Chile tiene ahora régimen de primera clase:
  // Ley 21.719 (APDP, plena vigencia 01-12-2026). Un cliente chileno
  // procesando bajo "régimen brasileño" era riesgo regulatorio real.
  privacyRegime: 'LEY-21719-CL',
  mandatoryCommittees: [
    { name: 'Comité Paritario de Higiene y Seguridad (CPHS)', minEmployees: 25, scope: 'DS 54 art.21 — paritario, ≥25 trabajadores' },
    { name: 'Departamento de Prevención de Riesgos', minEmployees: 100, scope: 'Ley 16.744 art.66 — obligatorio ≥100 trabajadores' },
  ],
  localizedNumbers: { medical: '131', fire: '132', police: '133' },
};

const PROFILE_EU: JurisdictionProfile = {
  code: 'EU',
  name: 'European Union',
  primaryRegulator: 'EU-OSHA + national labour inspectorates',
  regulations: [
    { id: 'Dir-89-391-EEC', title: 'Framework Directive 89/391/EEC', category: 'statute', reference: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:31989L0391' },
  ],
  incidentReporting: { authority: 'National labour inspectorate', deadlineDays: 3, fatalityImmediate: true, formName: 'Per Member State', electronicSubmission: true },
  privacyRegime: 'GDPR',
  mandatoryCommittees: [{ name: 'Workers H&S Representative', minEmployees: 1, scope: 'Per national transposition (88/391/EEC)' }],
  localizedNumbers: { medical: '112', fire: '112', police: '112' },
};

const PROFILE_BR: JurisdictionProfile = {
  code: 'BR',
  name: 'Brasil',
  primaryRegulator: 'Ministério do Trabalho e Emprego + Fundacentro',
  regulations: [
    { id: 'CLT-Cap-V', title: 'CLT Capítulo V — Segurança e Medicina do Trabalho', category: 'statute', reference: 'https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452.htm' },
    { id: 'NR-05', title: 'NR-05 — CIPA', category: 'regulation', mandatoryAtCount: 20, reference: 'https://www.gov.br/trabalho-e-previdencia/pt-br/composicao/orgaos-especificos/secretaria-de-trabalho/inspecao/seguranca-e-saude-no-trabalho/normas-regulamentadoras' },
  ],
  incidentReporting: { authority: 'INSS', deadlineDays: 1, fatalityImmediate: true, formName: 'CAT — Comunicação de Acidente de Trabalho', electronicSubmission: true },
  privacyRegime: 'LGPD',
  mandatoryCommittees: [{ name: 'CIPA — Comissão Interna de Prevenção de Acidentes', minEmployees: 20, scope: 'NR-05 — composição paritária' }],
  localizedNumbers: { medical: '192', fire: '193', police: '190' },
};

const PROFILE_MX: JurisdictionProfile = {
  code: 'MX',
  name: 'México',
  primaryRegulator: 'STPS — Secretaría del Trabajo y Previsión Social',
  regulations: [
    { id: 'LFT', title: 'Ley Federal del Trabajo Título IX', category: 'statute', reference: 'https://www.diputados.gob.mx/LeyesBiblio/ref/lft.htm' },
    { id: 'NOM-019-STPS', title: 'NOM-019-STPS-2011 — Comisiones de SST', category: 'regulation', mandatoryAtCount: 1, reference: 'https://www.dof.gob.mx' },
  ],
  incidentReporting: { authority: 'IMSS + STPS', deadlineDays: 3, fatalityImmediate: true, formName: 'ST-7', electronicSubmission: true },
  privacyRegime: 'LGPD',
  mandatoryCommittees: [{ name: 'Comisión de Seguridad e Higiene', minEmployees: 1, scope: 'NOM-019-STPS — bipartita' }],
  localizedNumbers: { medical: '911', fire: '911', police: '911' },
};

const PROFILE_US: JurisdictionProfile = {
  code: 'US-OSHA',
  name: 'United States (OSHA)',
  primaryRegulator: 'Occupational Safety and Health Administration (OSHA)',
  regulations: [
    { id: 'OSH-Act-1970', title: 'Occupational Safety and Health Act of 1970', category: 'statute', reference: 'https://www.osha.gov/laws-regs/oshact/completeoshact' },
  ],
  incidentReporting: { authority: 'OSHA', deadlineDays: 1, fatalityImmediate: true, formName: 'OSHA Form 301', electronicSubmission: true },
  privacyRegime: 'PIPEDA', // US fed no tiene un régimen único; mapeo conservador.
  mandatoryCommittees: [],
  localizedNumbers: { medical: '911', fire: '911', police: '911' },
};

const PROFILE_CN: JurisdictionProfile = {
  code: 'CN',
  name: '中华人民共和国 (China)',
  primaryRegulator: 'Ministry of Emergency Management (MEM) + State Administration of Work Safety',
  regulations: [
    { id: 'WSL-2021', title: 'Work Safety Law of the PRC (2021 amendment)', category: 'statute', reference: 'http://www.gov.cn' },
    { id: 'GB/T-33000-2016', title: 'GB/T 33000-2016 — Enterprise Work Safety Standardization', category: 'standard', reference: 'http://www.gov.cn' },
  ],
  incidentReporting: { authority: 'MEM local bureau', deadlineDays: 1, fatalityImmediate: true, formName: 'Production Safety Accident Report', electronicSubmission: true },
  privacyRegime: 'PIPL-CN', // 🔴 Fix 2026-05-15: antes apuntaba a 'PIPA-JP' (incorrecto). PIPL exige data localization + consent base separada.
  mandatoryCommittees: [],
  localizedNumbers: { medical: '120', fire: '119', police: '110' },
};

const PROFILE_TW: JurisdictionProfile = {
  code: 'TW',
  name: '中華民國 (Taiwan)',
  primaryRegulator: 'Occupational Safety and Health Administration (OSHA Taiwan)',
  regulations: [
    { id: 'OSHA-TW', title: 'Occupational Safety and Health Act (職業安全衛生法)', category: 'statute', reference: 'https://www.osha.gov.tw' },
  ],
  incidentReporting: { authority: 'OSHA Taiwan', deadlineDays: 1, fatalityImmediate: true, formName: 'Occupational Accident Report', electronicSubmission: true },
  privacyRegime: 'PIPA-TW', // 🔴 Fix 2026-05-15: antes apuntaba a 'PIPA-JP' (incorrecto). Taiwan PDPA es régimen distinto.
  mandatoryCommittees: [],
  localizedNumbers: { medical: '119', fire: '119', police: '110' },
};

const PROFILE_RU: JurisdictionProfile = {
  code: 'RU',
  name: 'Российская Федерация (Russia)',
  primaryRegulator: 'Rostrud (Federal Service for Labour and Employment)',
  regulations: [
    { id: 'TK-RF-Ch.36', title: 'Trudovoy Kodeks Ch.36 — Labour Protection', category: 'statute', reference: 'https://rostrud.gov.ru' },
    { id: 'FZ-426', title: '426-FZ — Special Assessment of Working Conditions (СОУТ)', category: 'regulation', reference: 'https://rostrud.gov.ru' },
  ],
  incidentReporting: { authority: 'Rostrud', deadlineDays: 1, fatalityImmediate: true, formName: 'N-1 Accident Report', electronicSubmission: false },
  privacyRegime: '152-FZ-RU', // 🔴 Fix 2026-05-15: antes apuntaba a 'PIPA-JP' (incorrecto). 152-FZ exige data localization en servidores rusos (art.18.5).
  mandatoryCommittees: [{ name: 'Labour Protection Committee', minEmployees: 50, scope: 'TK RF art.218 — comité paritario ≥50 trabajadores' }],
  localizedNumbers: { medical: '103', fire: '101', police: '102' },
};

// ────────────────────────────────────────────────────────────────────────
// Tabla maestra
// ────────────────────────────────────────────────────────────────────────

export const JURISDICTION_PROFILES: Partial<
  Record<JurisdictionCode, JurisdictionProfile>
> = {
  CL: PROFILE_CL,
  'US-OSHA': PROFILE_US,
  EU: PROFILE_EU,
  MX: PROFILE_MX,
  BR: PROFILE_BR,
  UK: PROFILE_UK,
  CA: PROFILE_CA,
  AU: PROFILE_AU,
  JP: PROFILE_JP,
  KR: PROFILE_KR,
  IN: PROFILE_IN,
  CN: PROFILE_CN,
  TW: PROFILE_TW,
  RU: PROFILE_RU,
};
