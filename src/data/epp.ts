import { EPPItem } from '../types';

export const eppCatalog: EPPItem[] = [
  {
    id: 'epp-01',
    name: 'Casco de Seguridad',
    category: 'Protección de Cabeza',
    description: 'Protección contra impactos y caídas de objetos.',
    imageUrl: 'https://picsum.photos/seed/helmet/200/200',
    required: true,
  },
  {
    id: 'epp-02',
    name: 'Gafas de Seguridad',
    category: 'Protección Ocular',
    description: 'Protección contra partículas y salpicaduras.',
    imageUrl: 'https://picsum.photos/seed/glasses/200/200',
    required: true,
  },
  {
    id: 'epp-03',
    name: 'Protectores Auditivos',
    category: 'Protección Auditiva',
    description: 'Reducción de niveles de ruido nocivos.',
    imageUrl: 'https://picsum.photos/seed/earmuffs/200/200',
    required: false,
  },
  {
    id: 'epp-04',
    name: 'Mascarilla Respiratoria',
    category: 'Protección Respiratoria',
    description: 'Filtrado de partículas y gases.',
    imageUrl: 'https://picsum.photos/seed/mask/200/200',
    required: false,
  },
  {
    id: 'epp-05',
    name: 'Guantes de Protección',
    category: 'Protección de Manos',
    description: 'Protección contra cortes y abrasiones.',
    imageUrl: 'https://picsum.photos/seed/gloves/200/200',
    required: true,
  },
  {
    id: 'epp-06',
    name: 'Calzado de Seguridad',
    category: 'Protección de Pies',
    description: 'Protección contra impactos y perforaciones.',
    imageUrl: 'https://picsum.photos/seed/boots/200/200',
    required: true,
  },
];
