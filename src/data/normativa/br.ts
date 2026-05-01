/**
 * Brasil — pacote normativo de Segurança e Saúde no Trabalho (SST).
 *
 * Marco principal:
 *  - CLT (Decreto-Lei 5.452/1943) — Capítulo V, arts. 154-201: Da Segurança e da Medicina do Trabalho.
 *  - Portaria MTE 3.214/1978 — aprova as Normas Regulamentadoras (NR-01 a NR-37+).
 *  - NR-01 — Disposições Gerais e Gerenciamento de Riscos Ocupacionais (GRO/PGR).
 *  - NR-04 — SESMT (Serviços Especializados em Engenharia de Segurança e em Medicina do Trabalho).
 *  - NR-05 — CIPA (Comissão Interna de Prevenção de Acidentes e de Assédio).
 *  - NR-06 — EPI.
 *  - NR-07 — PCMSO (Programa de Controle Médico de Saúde Ocupacional).
 *  - NR-09 — Avaliação e Controle das Exposições Ocupacionais a Agentes Físicos, Químicos e Biológicos.
 *  - NR-17 — Ergonomia.
 *  - NR-35 — Trabalho em Altura.
 *
 * AVISO LEGAL: este pacote é referencial e não substitui consulta a um Engenheiro/Técnico de
 * Segurança do Trabalho ou Médico do Trabalho registrado no MTE/CREA/CRM.
 */
import type { CountryPack } from '../../services/normativa/countryPacks';

export const BR_PACK: CountryPack = {
  code: 'BR',
  name: 'Brasil',
  flag: '🇧🇷',
  language: 'pt-BR',
  iso45001Compatibility: 'high',
  notes:
    'AVISO: o conteúdo é referencial. NR-05 (CIPA) e NR-04 (SESMT) escalam por grau de risco e quadro III/II — verifique a tabela específica do CNAE da empresa.',
  thresholds: {
    /**
     * VERIFY: NR-05 (CIPA) — a obrigatoriedade e o dimensionamento dependem do grau de risco
     * (Quadro I) e do número de empregados (Quadro III). Em geral, empresas com 20 ou mais
     * empregados em determinados CNAE devem constituir CIPA; abaixo disso, designar um
     * "Designado da CIPA". Usamos 20 como referência típica para o setor industrial médio.
     */
    comiteRequiredAtWorkers: 20,
    /**
     * VERIFY: NR-04 (SESMT) — dimensionamento por grau de risco (1-4) e número de empregados.
     * Para grau de risco 3-4, o SESMT é exigido a partir de 50 empregados; para grau 1-2,
     * a partir de 100. Usamos 100 como referência conservadora.
     */
    preventionDeptRequiredAtWorkers: 100,
    monthlyMeetingsRequired: true,
  },
  regulations: [
    {
      id: 'br-clt-cap-v',
      title: 'CLT — Capítulo V (Da Segurança e da Medicina do Trabalho)',
      reference: 'Decreto-Lei 5.452/1943, Arts. 154-201',
      scope:
        'Marco geral de SST: deveres do empregador e do empregado, EPI, atividades insalubres e perigosas, medicina do trabalho.',
      url: 'http://www.planalto.gov.br/ccivil_03/decreto-lei/del5452.htm',
    },
    {
      id: 'br-nr-01',
      title: 'NR-01 — Disposições Gerais e GRO/PGR',
      reference: 'NR-01 (Portaria MTP 6.730/2020 e atualizações)',
      scope:
        'Estabelece o Gerenciamento de Riscos Ocupacionais (GRO) e o Programa de Gerenciamento de Riscos (PGR) — substitui o antigo PPRA.',
      url: 'https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/seguranca-e-saude-no-trabalho/normas-regulamentadoras/nr-01.pdf',
    },
    {
      id: 'br-nr-04',
      title: 'NR-04 — SESMT',
      reference: 'NR-04 (Portaria 3.214/78 e atualizações)',
      scope:
        'Serviços Especializados em Engenharia de Segurança e em Medicina do Trabalho. Dimensionamento por grau de risco e nº empregados (Quadro II).',
      url: 'https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/seguranca-e-saude-no-trabalho/normas-regulamentadoras/nr-04-atualizada-2022.pdf',
    },
    {
      id: 'br-nr-05',
      title: 'NR-05 — CIPA (Comissão Interna de Prevenção de Acidentes e de Assédio)',
      reference: 'NR-05 (Portaria MTP 4.219/2022 — inclusão do "A" de Assédio)',
      scope:
        'Constituição, atribuições e funcionamento da CIPA. Dimensionamento por Quadro III (CNAE × nº empregados). Mandato de 1 ano.',
      url: 'https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/seguranca-e-saude-no-trabalho/normas-regulamentadoras/nr-05-atualizada-2022.pdf',
    },
    {
      id: 'br-nr-06',
      title: 'NR-06 — Equipamento de Proteção Individual (EPI)',
      reference: 'NR-06',
      scope:
        'Obriga o empregador a fornecer gratuitamente EPI adequado ao risco, em perfeito estado e com Certificado de Aprovação (CA).',
      url: 'https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/seguranca-e-saude-no-trabalho/normas-regulamentadoras/nr-06-atualizada-2022.pdf',
    },
    {
      id: 'br-nr-07',
      title: 'NR-07 — PCMSO',
      reference: 'NR-07 (Portaria SEPRT 6.734/2020)',
      scope:
        'Programa de Controle Médico de Saúde Ocupacional: exames admissional, periódico, de retorno, mudança de função e demissional.',
      url: 'https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/seguranca-e-saude-no-trabalho/normas-regulamentadoras/nr-07-atualizada-2022-1.pdf',
    },
    {
      id: 'br-nr-09',
      title: 'NR-09 — Agentes Físicos, Químicos e Biológicos',
      reference: 'NR-09 (Portaria SEPRT 6.735/2020)',
      scope:
        'Avaliação e controle das exposições ocupacionais a agentes físicos (ruído, vibração, calor), químicos e biológicos.',
      url: 'https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/seguranca-e-saude-no-trabalho/normas-regulamentadoras/nr-09-atualizada-2022.pdf',
    },
    {
      id: 'br-nr-17',
      title: 'NR-17 — Ergonomia',
      reference: 'NR-17 (Portaria MTP 423/2021)',
      scope:
        'Adapta as condições de trabalho às características psicofisiológicas dos trabalhadores: levantamento de cargas, mobiliário, organização do trabalho.',
      url: 'https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/seguranca-e-saude-no-trabalho/normas-regulamentadoras/nr-17-atualizada-2022.pdf',
    },
    {
      id: 'br-nr-35',
      title: 'NR-35 — Trabalho em Altura',
      reference: 'NR-35',
      scope:
        'Requisitos mínimos para trabalho em altura (acima de 2 m): planejamento, organização, execução, capacitação e treinamento periódico.',
      url: 'https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/seguranca-e-saude-no-trabalho/normas-regulamentadoras/nr-35-atualizada-2022.pdf',
    },
  ],
};
