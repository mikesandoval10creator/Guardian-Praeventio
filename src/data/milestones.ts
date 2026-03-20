export interface Milestone {
  year: string;
  title: string;
  description: string;
  region: 'Global' | 'Chile';
  icon?: string;
}

export const milestones: Milestone[] = [
  {
    year: '1900',
    title: 'Primeras leyes de accidentes',
    description: 'Se establecen las bases de la protección laboral en Europa.',
    region: 'Global',
  },
  {
    year: '1916',
    title: 'Ley 3.170 en Chile',
    description: 'Primera ley chilena sobre accidentes del trabajo.',
    region: 'Chile',
  },
  {
    year: '1968',
    title: 'Ley 16.744',
    description: 'Establece el seguro social obligatorio contra riesgos de accidentes del trabajo y enfermedades profesionales en Chile.',
    region: 'Chile',
  },
  {
    year: '1970',
    title: 'Creación de la OSHA',
    description: 'Se funda la Occupational Safety and Health Administration en EE.UU.',
    region: 'Global',
  },
  {
    year: '2020',
    title: 'Protocolos COVID-19',
    description: 'Adaptación masiva de la seguridad laboral ante la pandemia global.',
    region: 'Global',
  },
];
