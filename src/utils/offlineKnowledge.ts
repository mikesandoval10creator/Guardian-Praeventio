export interface OfflineTopic {
  id: string;
  keywords: string[];
  title: string;
  content: string;
}

export const OFFLINE_KNOWLEDGE_BASE: OfflineTopic[] = [
  {
    id: 'trabajo-altura',
    keywords: ['altura', 'caida', 'arnes', 'andamio', 'techo'],
    title: 'Trabajo en Altura (DS 594 / Ley 16.744)',
    content: 'El trabajo en altura (sobre 1.8 metros) requiere estrictas medidas de seguridad según la normativa chilena.\n\n**Medidas Críticas Inmediatas:**\n1. Uso obligatorio de arnés de cuerpo entero con doble cabo de vida.\n2. Verificación de puntos de anclaje (resistencia mínima 2268 kg).\n3. Inspección visual del equipo antes de usarlo.\n4. Charla de seguridad específica y Permiso de Trabajo Seguro (PTS) firmado.\n\n*Nota: Esta es una respuesta offline de emergencia. Cuando recuperes la conexión, podré detallarte la normativa exacta o generar un PTS automático.*'
  },
  {
    id: 'espacios-confinados',
    keywords: ['confinado', 'espacio', 'gases', 'ventilacion', 'tanque', 'pozo'],
    title: 'Espacios Confinados',
    content: 'El ingreso a espacios confinados es de riesgo crítico y requiere autorización expresa.\n\n**Protocolo Básico:**\n1. Medición de gases (O2, LEL, CO, H2S) antes y durante el ingreso.\n2. Ventilación forzada continua.\n3. Uso de vigía permanente en el exterior en todo momento.\n4. Plan de rescate y equipos de comunicación probados.\n\n*Nota: Respuesta offline. Conéctate para generar un plan de rescate detallado.*'
  },
  {
    id: 'epp',
    keywords: ['epp', 'casco', 'guantes', 'zapatos', 'lentes', 'proteccion'],
    title: 'Equipos de Protección Personal (EPP)',
    content: 'El uso de EPP es obligatorio y debe estar certificado.\n\n**Requisitos:**\n1. El empleador debe proporcionar el EPP libre de costo.\n2. El trabajador está obligado a usarlo y cuidarlo.\n3. Todo EPP dañado debe ser reportado y cambiado inmediatamente.\n\n*Nota: Respuesta offline. Al conectarte, podré verificar el stock o registrar una entrega formal.*'
  },
  {
    id: 'emergencia-fuego',
    keywords: ['fuego', 'incendio', 'extintor', 'quemadura', 'humo'],
    title: 'Protocolo de Incendio',
    content: 'En caso de amago de incendio:\n\n1. Dé la alarma inmediatamente.\n2. Si es seguro, use el extintor adecuado (PQS para fuegos ABC).\n3. Evacúe hacia la Zona de Seguridad si el fuego no se controla en 5 segundos.\n4. No use ascensores.\n\n*Nota: Respuesta offline. Mantenga la calma.*'
  },
  {
    id: 'emergencia-sismo',
    keywords: ['sismo', 'temblor', 'terremoto', 'evacuacion'],
    title: 'Protocolo de Sismo',
    content: 'Durante un movimiento sísmico:\n\n1. Mantenga la calma y aléjese de ventanas o elementos que puedan caer.\n2. Ubíquese en las Zonas de Seguridad Internas.\n3. Una vez finalizado el sismo, evacúe hacia la Zona de Seguridad Externa.\n4. Siga las instrucciones del líder de evacuación.\n\n*Nota: Respuesta offline. Al recuperar conexión, el sistema triangulará las zonas seguras.*'
  }
];

export const getOfflineResponse = (query: string, nodes?: any[]): string => {
  const lowerQuery = query.toLowerCase();
  
  // First, try to find matching nodes from Risk Network
  if (nodes && nodes.length > 0) {
    const matchingNodes = nodes.filter(node => 
      node.title.toLowerCase().includes(lowerQuery) || 
      node.description.toLowerCase().includes(lowerQuery) ||
      node.tags.some((t: string) => t.toLowerCase().includes(lowerQuery))
    );

    if (matchingNodes.length > 0) {
      // Sort by relevance (basic: title match first)
      matchingNodes.sort((a, b) => {
        const aTitleMatch = a.title.toLowerCase().includes(lowerQuery) ? 1 : 0;
        const bTitleMatch = b.title.toLowerCase().includes(lowerQuery) ? 1 : 0;
        return bTitleMatch - aTitleMatch;
      });

      const topNode = matchingNodes[0];
      return `(Respuesta desde Base de Conocimiento Offline)\n\n**${topNode.title}**\n${topNode.description}\n\n*Nota: Esta información fue recuperada de tu red neuronal local. Al conectarte, la IA podrá analizarla más a fondo.*`;
    }
  }

  // Fallback to hardcoded topics
  for (const topic of OFFLINE_KNOWLEDGE_BASE) {
    if (topic.keywords.some(kw => lowerQuery.includes(kw))) {
      return topic.content;
    }
  }
  
  return 'Actualmente te encuentras sin conexión a internet. He guardado tu consulta y te avisaré apenas recuperemos la señal para darte una respuesta detallada con todo el poder de la IA.';
};

export const savePendingOfflineQuery = (query: string) => {
  try {
    const queries = JSON.parse(localStorage.getItem('pendingOfflineQueries') || '[]');
    // Avoid duplicates
    if (!queries.includes(query)) {
      queries.push(query);
      localStorage.setItem('pendingOfflineQueries', JSON.stringify(queries));
    }
  } catch (e) {
    console.error('Error saving pending query', e);
  }
};

export const getPendingOfflineQueries = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem('pendingOfflineQueries') || '[]');
  } catch (e) {
    return [];
  }
};

export const clearPendingOfflineQueries = () => {
  localStorage.removeItem('pendingOfflineQueries');
};
