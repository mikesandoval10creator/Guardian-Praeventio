export const offlineKnowledgeBase = [
  {
    keywords: ['altura', 'caida', 'arnes', 'andamio'],
    title: 'Trabajo en Altura',
    content: `**Protocolo de Trabajo en Altura (Modo Offline)**\n\nSegún la normativa chilena, todo trabajo a más de 1.8 metros de altura requiere:\n\n1. **Uso de SPDC** (Sistema Personal de Detención de Caídas): Arnés de cuerpo entero, estrobo con amortiguador, punto de anclaje certificado.\n2. **Examen de Altura Física**: Vigente y aprobado.\n3. **PTS**: Procedimiento de Trabajo Seguro documentado y firmado.\n4. **Andamios**: Certificados, con rodapiés y barandas.\n\n*Nota: Esta es una respuesta offline. Cuando recuperes la conexión, podré analizar tu caso específico con Gemini.*`
  },
  {
    keywords: ['epp', 'casco', 'guantes', 'zapatos', 'lentes'],
    title: 'Elementos de Protección Personal (EPP)',
    content: `**Uso de EPP (Modo Offline)**\n\nEl Artículo 53 del DS 594 establece que el empleador debe proporcionar libre de costo los EPP adecuados al riesgo:\n\n- **Básico**: Casco, lentes de seguridad, zapatos de seguridad.\n- **Específico**: Protección auditiva (ruido > 85 dB), respiratoria (polvo/gases), guantes según riesgo (corte, químico).\n\n*Nota: Esta es una respuesta offline. Cuando recuperes la conexión, podré verificar el cumplimiento exacto para tu faena.*`
  },
  {
    keywords: ['ley 16744', 'accidente', 'trayecto', 'enfermedad profesional'],
    title: 'Ley 16.744',
    content: `**Ley 16.744 (Modo Offline)**\n\nEsta ley establece el Seguro Social Obligatorio contra Riesgos de Accidentes del Trabajo y Enfermedades Profesionales.\n\nCubre:\n- Accidentes a causa o con ocasión del trabajo.\n- Accidentes de trayecto (ida o regreso directo).\n- Enfermedades profesionales (causadas de manera directa por el ejercicio de la profesión).\n\n*Nota: Esta es una respuesta offline. Conéctate para un análisis legal detallado.*`
  },
  {
    keywords: ['ds 594', 'condiciones sanitarias', 'baños', 'agua', 'comedor'],
    title: 'DS 594',
    content: `**Decreto Supremo 594 (Modo Offline)**\n\nReglamento sobre Condiciones Sanitarias y Ambientales Básicas en los Lugares de Trabajo:\n\n- Provisión de agua potable (100L por trabajador/día).\n- Servicios higiénicos separados y en cantidad suficiente.\n- Comedores aislados de áreas de trabajo.\n- Límites de tolerancia biológica y ambiental.\n\n*Nota: Esta es una respuesta offline. Conéctate para revisar el cumplimiento específico.*`
  },
  {
    keywords: ['espacio confinado', 'gases', 'ventilacion', 'oxigeno'],
    title: 'Espacios Confinados',
    content: `**Espacios Confinados (Modo Offline)**\n\nTrabajar en áreas con ventilación deficiente requiere:\n\n1. Medición de gases previa (O2 entre 19.5% y 23.5%, LEL < 10%).\n2. Ventilación forzada si es necesario.\n3. Vigía permanente en el exterior.\n4. Permiso de Trabajo de Alto Riesgo (PTAR).\n\n*Nota: Esta es una respuesta offline. Conéctate para generar un PTS dinámico.*`
  }
];

export function getOfflineResponse(query: string) {
  const lowerQuery = query.toLowerCase();
  
  for (const item of offlineKnowledgeBase) {
    if (item.keywords.some(kw => lowerQuery.includes(kw))) {
      return item.content;
    }
  }
  
  return "**Modo Offline Activo**\n\nHe registrado tu consulta, pero actualmente no tienes conexión a internet para procesarla con mi motor de IA (Gemini). \n\nHe guardado tu pregunta. En cuanto recuperes la conexión, te notificaré para que podamos profundizar en este tema.";
}
