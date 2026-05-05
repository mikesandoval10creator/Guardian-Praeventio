// Sprint 28 Bucket B1 — Adaptador Brasil (Normas Regulamentadoras).

import type { RegulationRef } from '../types.js';

const GOV_BR = 'https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/seguranca-e-saude-no-trabalho/normas-regulamentadoras';

export const BR_REFERENCES: Record<string, RegulationRef[]> = {
  LEADERSHIP_COMMITMENT: [
    {
      code: 'NR-1',
      title: 'NR-1 — Disposições gerais e gerenciamento de riscos ocupacionais',
      jurisdiction: 'BR',
      url: GOV_BR,
      scope: 'PGR (Programa de Gerenciamento de Riscos), responsabilidades do empregador',
    },
  ],
  WORKER_PARTICIPATION: [
    {
      code: 'NR-5',
      title: 'NR-5 — CIPA (Comissão Interna de Prevenção de Acidentes)',
      jurisdiction: 'BR',
      url: GOV_BR,
      scope: 'Composição, eleição e atribuições da CIPA',
    },
  ],
  HAZARD_IDENTIFICATION: [
    {
      code: 'NR-9',
      title: 'NR-9 — Avaliação e controle das exposições ocupacionais a agentes',
      jurisdiction: 'BR',
      url: GOV_BR,
      scope: 'Riscos físicos, químicos e biológicos; PPRA → integrado ao PGR (NR-1)',
    },
    {
      code: 'NR-15',
      title: 'NR-15 — Atividades e operações insalubres',
      jurisdiction: 'BR',
      url: GOV_BR,
      scope: 'Limites de tolerância, adicional de insalubridade',
    },
  ],
  COMPETENCE_TRAINING: [
    {
      code: 'NR-35',
      title: 'NR-35 — Trabalho em altura',
      jurisdiction: 'BR',
      url: GOV_BR,
      scope: 'Capacitação obrigatória, sistemas de proteção contra quedas',
    },
  ],
  OPERATIONAL_CONTROL: [
    {
      code: 'NR-17',
      title: 'NR-17 — Ergonomia',
      jurisdiction: 'BR',
      url: GOV_BR,
      scope: 'Adaptação das condições de trabalho às características psicofisiológicas',
    },
  ],
  PERFORMANCE_MONITORING: [
    {
      code: 'NR-7',
      title: 'NR-7 — PCMSO (Programa de Controle Médico de Saúde Ocupacional)',
      jurisdiction: 'BR',
      url: GOV_BR,
      scope: 'Exames médicos ocupacionais, ASO, vigilância da saúde do trabalhador',
    },
  ],
};
