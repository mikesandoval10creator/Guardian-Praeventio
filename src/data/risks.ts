import { RiskCategory } from '../types';

export interface RiskItem {
  id: string;
  category: RiskCategory;
  title: string;
  description: string;
  icon: string;
  color: string;
}

export const risks: RiskItem[] = [
  {
    id: 'f-01',
    category: RiskCategory.FISICO,
    title: 'Ruido',
    description: 'Exposición a niveles de ruido superiores a 85 dB.',
    icon: 'Volume2',
    color: 'bg-blue-500',
  },
  {
    id: 'f-02',
    category: RiskCategory.FISICO,
    title: 'Vibraciones',
    description: 'Exposición a vibraciones de cuerpo entero o mano-brazo.',
    icon: 'Activity',
    color: 'bg-blue-400',
  },
  {
    id: 'q-01',
    category: RiskCategory.QUIMICO,
    title: 'Polvos',
    description: 'Inhalación de partículas de polvo en suspensión.',
    icon: 'Wind',
    color: 'bg-red-500',
  },
  {
    id: 'q-02',
    category: RiskCategory.QUIMICO,
    title: 'Gases y Vapores',
    description: 'Exposición a sustancias gaseosas tóxicas.',
    icon: 'Cloud',
    color: 'bg-red-400',
  },
  {
    id: 'b-01',
    category: RiskCategory.BIOLOGICO,
    title: 'Virus',
    description: 'Exposición a agentes virales en el entorno laboral.',
    icon: 'Virus',
    color: 'bg-green-500',
  },
  {
    id: 'e-01',
    category: RiskCategory.ERGONOMICO,
    title: 'Postura Forzada',
    description: 'Mantenimiento de posturas inadecuadas por tiempo prolongado.',
    icon: 'Accessibility',
    color: 'bg-yellow-500',
  },
  {
    id: 'p-01',
    category: RiskCategory.PSICOSOCIAL,
    title: 'Estrés Laboral',
    description: 'Carga mental excesiva y presión en el trabajo.',
    icon: 'Brain',
    color: 'bg-purple-500',
  },
  {
    id: 's-01',
    category: RiskCategory.SEGURIDAD,
    title: 'Caídas a distinto nivel',
    description: 'Riesgo de caída desde alturas superiores a 1.8 metros.',
    icon: 'ArrowDownCircle',
    color: 'bg-orange-500',
  },
];
