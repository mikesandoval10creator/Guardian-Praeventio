import { useCallback } from 'react';
import { useZettelkasten } from './useZettelkasten';
import { NodeType } from '../types';

// Diccionarios de Conocimiento Base (Zettelkasten Estático)
const INDUSTRY_NORMATIVES: Record<string, string[]> = {
  'Minería': ['D.S. 132/2004 (Reglamento de Seguridad Minera)', 'D.S. 594/1999 (Condiciones Sanitarias)', 'Ley 16.744 (Accidentes del Trabajo)', 'D.S. 72/1985'],
  'Construcción': ['D.S. 594/1999 (Condiciones Sanitarias)', 'Ley 16.744 (Accidentes del Trabajo)', 'NCh 1508 (Estudio de Mecánica de Suelos)', 'NCh 349 (Disposiciones de Seguridad en Excavación)'],
  'Agricultura': ['D.S. 594/1999 (Condiciones Sanitarias)', 'Ley 16.744 (Accidentes del Trabajo)', 'D.S. 157/2005 (Reglamento de Pesticidas)'],
  'Transporte': ['Ley 16.744 (Accidentes del Trabajo)', 'D.S. 594/1999 (Condiciones Sanitarias)', 'D.S. 170/1985 (Licencias de Conducir)', 'Ley 18.290 (Ley de Tránsito)'],
  'Manufactura': ['D.S. 594/1999 (Condiciones Sanitarias)', 'Ley 16.744 (Accidentes del Trabajo)', 'D.S. 40/1969 (Reglamento sobre Prevención de Riesgos)'],
};

const ROLE_EPP: Record<string, string[]> = {
  'Soldador': ['Careta de soldar fotosensible', 'Guantes de cuero mosquetero', 'Coleto de cuero', 'Polainas de cuero', 'Zapatos de seguridad dieléctricos', 'Respirador para humos metálicos (P100)'],
  'Operador de Grúa': ['Casco de seguridad', 'Zapatos de seguridad', 'Chaleco reflectante de alta visibilidad', 'Lentes de seguridad oscuros/claros', 'Protección auditiva'],
  'Electricista': ['Casco dieléctrico (Clase E)', 'Guantes dieléctricos', 'Zapatos dieléctricos sin partes metálicas', 'Ropa ignífuga', 'Lentes de seguridad', 'Protector facial contra arco eléctrico'],
  'Jornalero': ['Casco de seguridad', 'Zapatos de seguridad con puntera', 'Guantes de cabritilla/multiflex', 'Lentes de seguridad', 'Chaleco reflectante'],
  'Trabajador en Altura': ['Arnés de cuerpo completo (mínimo 3 argollas)', 'Doble cabo de vida con amortiguador de impacto', 'Casco con barbiquejo', 'Zapatos de seguridad', 'Guantes de cabritilla'],
  'Mecánico': ['Zapatos de seguridad', 'Guantes de nitrilo/mecánico', 'Lentes de seguridad', 'Overol resistente a grasas', 'Protección auditiva'],
};

const INDUSTRY_TRAINING: Record<string, string[]> = {
  'Minería': ['Inducción ODI Minería (D.S. 132)', 'Aislamiento y Bloqueo de Energías', 'Manejo de Sustancias Peligrosas', 'Trabajo en Altura Física', 'Uso de Extintores'],
  'Construcción': ['Inducción ODI Construcción', 'Trabajo en Altura Física', 'Armado y Uso de Andamios', 'Manejo Manual de Cargas (Ley 20.949)', 'Uso de Herramientas Eléctricas'],
  'Transporte': ['Conducción a la Defensiva', 'Manejo de Fatiga y Somnolencia', 'Manejo de Cargas Peligrosas', 'Primeros Auxilios en Ruta'],
  'Manufactura': ['Inducción ODI General', 'Manejo Manual de Cargas', 'Uso de Extintores', 'Riesgos Específicos de Maquinaria', 'Plan de Emergencia y Evacuación'],
};

export function useIndustryIntegration() {
  const { addNode } = useZettelkasten();

  // Funciones de consulta estática
  const getNormatives = useCallback((industry: string) => {
    const normalizedIndustry = industry.toUpperCase();
    if (normalizedIndustry.includes('GP-MIN')) return INDUSTRY_NORMATIVES['Minería'];
    if (normalizedIndustry.includes('GP-CONS')) return INDUSTRY_NORMATIVES['Construcción'];
    if (normalizedIndustry.includes('GP-AGR')) return INDUSTRY_NORMATIVES['Agricultura'];
    if (normalizedIndustry.includes('GP-TRANS')) return INDUSTRY_NORMATIVES['Transporte'];
    if (normalizedIndustry.includes('GP-MANU')) return INDUSTRY_NORMATIVES['Manufactura'];
    return INDUSTRY_NORMATIVES['Manufactura']; // Default
  }, []);

  const getEPP = useCallback((role: string) => {
    // Búsqueda flexible (case-insensitive y parcial)
    const normalizedRole = role.toLowerCase();
    const matchedKey = Object.keys(ROLE_EPP).find(k => normalizedRole.includes(k.toLowerCase()));
    
    return matchedKey ? ROLE_EPP[matchedKey] : ['Casco de seguridad', 'Zapatos de seguridad', 'Chaleco reflectante', 'Lentes de seguridad'];
  }, []);

  const getTraining = useCallback((industry: string) => {
    const normalizedIndustry = industry.toUpperCase();
    if (normalizedIndustry.includes('GP-MIN')) return INDUSTRY_TRAINING['Minería'];
    if (normalizedIndustry.includes('GP-CONS')) return INDUSTRY_TRAINING['Construcción'];
    if (normalizedIndustry.includes('GP-TRANS')) return INDUSTRY_TRAINING['Transporte'];
    if (normalizedIndustry.includes('GP-MANU')) return INDUSTRY_TRAINING['Manufactura'];
    return ['Inducción ODI General', 'Uso de Extintores', 'Manejo Manual de Cargas']; // Default
  }, []);

  // Función para inyectar conocimiento al Zettelkasten (Nodos)
  const bootstrapProjectKnowledge = useCallback(async (projectId: string, industry: string) => {
    try {
      const normatives = getNormatives(industry);
      const training = getTraining(industry);
      
      // Crear nodos de normativas
      for (const norm of normatives) {
        await addNode({
          type: NodeType.NORMATIVE,
          title: norm,
          description: `Normativa legal aplicable al sector: ${industry}`,
          tags: ['legal', industry.toLowerCase(), 'obligatorio'],
          metadata: { industry, isAutoGenerated: true },
          connections: [],
          projectId
        });
      }

      // Crear nodos de capacitación
      for (const course of training) {
        await addNode({
          type: NodeType.TRAINING,
          title: course,
          description: `Capacitación obligatoria sugerida para el sector: ${industry}`,
          tags: ['capacitación', industry.toLowerCase(), 'obligatorio'],
          metadata: { industry, isAutoGenerated: true },
          connections: [],
          projectId
        });
      }
      
      return { 
        success: true, 
        message: `Conocimiento base inyectado para el sector: ${industry}`,
        data: { normatives, training } 
      };
    } catch (error) {
      console.error("Error bootstrapping project knowledge:", error);
      return { success: false, error };
    }
  }, [getNormatives, getTraining, addNode]);

  return {
    getNormatives,
    getEPP,
    getTraining,
    bootstrapProjectKnowledge,
    availableIndustries: Object.keys(INDUSTRY_NORMATIVES),
    availableRoles: Object.keys(ROLE_EPP)
  };
}
