import { EPPItem } from '../types';

export const eppCatalog: EPPItem[] = [
  {
    id: 'epp-01',
    projectId: 'default',
    name: 'Casco de Seguridad',
    category: 'Protección de Cabeza',
    description: 'Protección contra impactos y caídas de objetos.',
    imageUrl: 'https://picsum.photos/seed/helmet/200/200',
    required: true,
    stock: 100,
    createdAt: new Date().toISOString(),
    ispCertification: 'ISP-12345',
    expirationDate: '2028-12-31T00:00:00Z'
  },
  {
    id: 'epp-02',
    projectId: 'default',
    name: 'Gafas de Seguridad',
    category: 'Protección Ocular',
    description: 'Protección contra partículas y salpicaduras.',
    imageUrl: 'https://picsum.photos/seed/glasses/200/200',
    required: true,
    stock: 150,
    createdAt: new Date().toISOString(),
    ispCertification: 'ISP-67890',
    expirationDate: '2027-06-30T00:00:00Z'
  },
  {
    id: 'epp-03',
    projectId: 'default',
    name: 'Protectores Auditivos',
    category: 'Protección Auditiva',
    description: 'Reducción de niveles de ruido nocivos.',
    imageUrl: 'https://picsum.photos/seed/earmuffs/200/200',
    required: false,
    stock: 200,
    createdAt: new Date().toISOString(),
    ispCertification: 'ISP-11223',
    expirationDate: '2029-01-15T00:00:00Z'
  },
  {
    id: 'epp-04',
    projectId: 'default',
    name: 'Mascarilla Respiratoria',
    category: 'Protección Respiratoria',
    description: 'Filtrado de partículas y gases.',
    imageUrl: 'https://picsum.photos/seed/mask/200/200',
    required: false,
    stock: 500,
    createdAt: new Date().toISOString(),
    ispCertification: 'ISP-44556',
    expirationDate: '2026-10-31T00:00:00Z'
  },
  {
    id: 'epp-05',
    projectId: 'default',
    name: 'Guantes de Protección',
    category: 'Protección de Manos',
    description: 'Protección contra cortes y abrasiones.',
    imageUrl: 'https://picsum.photos/seed/gloves/200/200',
    required: true,
    stock: 80,
    createdAt: new Date().toISOString(),
    ispCertification: 'ISP-77889',
    expirationDate: '2027-03-15T00:00:00Z'
  },
  {
    id: 'epp-06',
    projectId: 'default',
    name: 'Calzado de Seguridad',
    category: 'Protección de Pies',
    description: 'Protección contra impactos y perforaciones.',
    imageUrl: 'https://picsum.photos/seed/boots/200/200',
    required: true,
    stock: 120,
    createdAt: new Date().toISOString(),
    ispCertification: 'ISP-99000',
    expirationDate: '2028-08-20T00:00:00Z'
  },
];
