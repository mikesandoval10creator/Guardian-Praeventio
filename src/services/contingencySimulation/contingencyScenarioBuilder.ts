// Praeventio Guard — Sprint 52: Simulador de escenarios de contingencia (§241).
//
// Cierra: Documento usuario 2da tanda "§241 Simulador escenario contingencia".
//
// Complementa:
//   - src/services/continuity/continuityPlanning.ts (simulateOutage de SPOFs)
//   - src/services/drillsManager/drillsManager.ts (calendario + evaluación drills)
//
// Mientras `continuityPlanning.simulateOutage` modela la caída de UN recurso
// SPOF, este módulo arma escenarios COMPLETOS de contingencia (incendio,
// sismo, derrame, etc.) con timeline de eventos, puntos de decisión y
// criterios de éxito — pensado para ejercicios tabletop sin movilizar faena.
//
// Determinístico, sin LLM.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type ScenarioKind =
  | 'fire'
  | 'earthquake'
  | 'flood'
  | 'chemical_spill'
  | 'power_outage'
  | 'cyber_attack'
  | 'mass_casualty'
  | 'evacuation_blocked'
  | 'leader_unavailable'
  | 'supplier_failure';

export type ScenarioSeverity = 'minor' | 'moderate' | 'major' | 'catastrophic';

export interface ScenarioInitialConditions {
  time: 'day' | 'night' | 'shift_change';
  weather?: string;
  /** Trabajadores presentes en faena al inicio del escenario. */
  staffPresent: number;
  /** Sistemas críticos no disponibles desde el inicio. */
  criticalSystemsDown: string[];
}

export interface ScenarioTriggerEvent {
  /** Minuto desde t=0 (inicio del escenario). */
  minute: number;
  event: string;
  expectedResponse?: string;
}

export interface ScenarioDecisionPoint {
  minute: number;
  question: string;
  options: string[];
  /**
   * Opciones consideradas correctas (subset de `options`). Una respuesta
   * cuenta como correcta si está incluida en este array.
   */
  correctResponses: string[];
  rationale: string;
}

export interface ContingencyScenario {
  id: string;
  kind: ScenarioKind;
  severity: ScenarioSeverity;
  title: string;
  initialConditions: ScenarioInitialConditions;
  triggerEvents: ScenarioTriggerEvent[];
  decisionPoints: ScenarioDecisionPoint[];
  /** Criterios cualitativos para considerar el ejercicio "aprobado". */
  successCriteria: string[];
  estimatedDurationMin: number;
}

export interface BuildScenarioOptions {
  /** Override de id (default = `${kind}_${severity}_${epoch}`). */
  id?: string;
  /** Override de condiciones iniciales. */
  initialConditions?: Partial<ScenarioInitialConditions>;
  /** Industria — filtra plantillas inadecuadas si se filtra por listAvailableScenarios. */
  industry?: 'construction' | 'mining' | 'industrial' | 'logistics' | 'office' | 'healthcare';
}

// ────────────────────────────────────────────────────────────────────────
// Plantillas pre-built (mínimo 8 — cubrimos las 10 kinds para cobertura)
// ────────────────────────────────────────────────────────────────────────

interface ScenarioTemplate {
  kind: ScenarioKind;
  severity: ScenarioSeverity;
  title: string;
  defaults: ScenarioInitialConditions;
  triggerEvents: ScenarioTriggerEvent[];
  decisionPoints: ScenarioDecisionPoint[];
  successCriteria: string[];
  estimatedDurationMin: number;
  applicableIndustries: Array<NonNullable<BuildScenarioOptions['industry']>>;
}

const TEMPLATES: ScenarioTemplate[] = [
  {
    kind: 'fire',
    severity: 'moderate',
    title: 'Incendio en bodega de materiales — turno día',
    defaults: {
      time: 'day',
      weather: 'seco',
      staffPresent: 25,
      criticalSystemsDown: [],
    },
    triggerEvents: [
      { minute: 0, event: 'Detector de humo activado en bodega B-2.', expectedResponse: 'Confirmar visualmente' },
      { minute: 2, event: 'Brigada confirma fuego clase A activo.', expectedResponse: 'Activar alarma + 132' },
      { minute: 5, event: 'Humo invade pasillo principal.', expectedResponse: 'Evacuación inmediata' },
      { minute: 12, event: 'Bomberos llegan a faena.', expectedResponse: 'Entregar mando externo' },
      { minute: 25, event: 'Fuego controlado.', expectedResponse: 'Conteo de personas + parte' },
    ],
    decisionPoints: [
      {
        minute: 2,
        question: '¿Activamos brigada interna o llamamos bomberos directamente?',
        options: ['Solo brigada interna', 'Brigada interna + bomberos en paralelo', 'Solo bomberos', 'Esperar 5 min y reevaluar'],
        correctResponses: ['Brigada interna + bomberos en paralelo'],
        rationale: 'Fuego clase A activo sobre material combustible — brigada gana tiempo, bomberos toman mando.',
      },
      {
        minute: 5,
        question: '¿Cómo se ordena la evacuación con humo en pasillo principal?',
        options: ['Por el pasillo principal igual', 'Por salida de emergencia secundaria', 'Refugio en sala segura', 'Esperar instrucciones'],
        correctResponses: ['Por salida de emergencia secundaria'],
        rationale: 'Vías comprometidas → ruta alterna. Refugio sólo si no hay salida.',
      },
      {
        minute: 25,
        question: '¿Quién certifica que la faena puede reanudarse?',
        options: ['El supervisor de turno', 'El experto en prevención + bomberos', 'El mandante', 'Inmediatamente, ya está apagado'],
        correctResponses: ['El experto en prevención + bomberos'],
        rationale: 'Reanudación requiere validación técnica de extinción + integridad estructural.',
      },
    ],
    successCriteria: [
      'Tiempo a alarma <3 min',
      'Evacuación completa <10 min',
      'Conteo nominal de personas tras evacuación',
      'Bomberos toman mando externo correctamente',
    ],
    estimatedDurationMin: 35,
    applicableIndustries: ['construction', 'industrial', 'logistics', 'office', 'mining'],
  },
  {
    kind: 'earthquake',
    severity: 'major',
    title: 'Sismo grado 7.5 — turno noche con menor dotación',
    defaults: {
      time: 'night',
      weather: 'frío',
      staffPresent: 8,
      criticalSystemsDown: ['iluminación parcial'],
    },
    triggerEvents: [
      { minute: 0, event: 'Sismo perceptible — duración 45 segundos.', expectedResponse: 'Triángulo de vida / protocolo sismo' },
      { minute: 1, event: 'Caída de mampostería no estructural.', expectedResponse: 'No salir corriendo' },
      { minute: 3, event: 'Termina movimiento. Réplicas posibles.', expectedResponse: 'Evacuación ordenada' },
      { minute: 8, event: 'Tsunami posible (zona costera). SHOA pendiente.', expectedResponse: 'Punto encuentro alto' },
      { minute: 20, event: 'Comunicaciones celulares saturadas.', expectedResponse: 'Activar radio HF' },
      { minute: 60, event: 'Réplica grado 5.2.', expectedResponse: 'Mantenerse en punto seguro' },
    ],
    decisionPoints: [
      {
        minute: 0,
        question: 'Durante el sismo, ¿qué hace el personal en pisos altos?',
        options: ['Bajar por escaleras corriendo', 'Triángulo de vida + protegerse', 'Subir a azotea', 'Usar ascensor'],
        correctResponses: ['Triángulo de vida + protegerse'],
        rationale: 'NUNCA evacuar durante sismo. Movimiento dentro de edificio mata más que el sismo en sí.',
      },
      {
        minute: 8,
        question: 'Sin info SHOA y zona costera. ¿Evacuar a punto alto?',
        options: ['Esperar confirmación SHOA', 'Evacuar a punto alto preventivamente', 'Quedarse en faena', 'Bajar a la playa a observar'],
        correctResponses: ['Evacuar a punto alto preventivamente'],
        rationale: 'Por protocolo, sismo grande + costa = evacuar antes de SHOA. Si SHOA descarta, se regresa.',
      },
      {
        minute: 20,
        question: 'Sin celular, ¿cómo coordina supervisor con mandante?',
        options: ['Reintentar celular cada 5 min', 'Activar radio HF / canal de emergencia', 'Esperar a que vuelva la red', 'Mensajero a pie'],
        correctResponses: ['Activar radio HF / canal de emergencia'],
        rationale: 'Red celular cae primero en catástrofe. Plan ICE debe incluir radio.',
      },
      {
        minute: 60,
        question: 'Réplica 5.2 mientras evacuábamos. ¿Continuar evacuación?',
        options: ['Sí, seguir caminando', 'Detenerse + protegerse hasta que pase', 'Correr al punto encuentro', 'Volver atrás'],
        correctResponses: ['Detenerse + protegerse hasta que pase'],
        rationale: 'Misma regla que sismo principal: protegerse durante movimiento, evacuar entre.',
      },
    ],
    successCriteria: [
      'Sin personas heridas por evacuación durante movimiento',
      'Activación radio HF dentro de 30 min',
      'Conteo nominal en punto alto si zona costera',
      'Réplica gestionada con mismo protocolo que principal',
    ],
    estimatedDurationMin: 90,
    applicableIndustries: ['construction', 'mining', 'industrial', 'logistics', 'office', 'healthcare'],
  },
  {
    kind: 'chemical_spill',
    severity: 'major',
    title: 'Derrame químico HAZMAT clase 8 — corrosivo, 200 L',
    defaults: {
      time: 'day',
      weather: 'viento moderado SE',
      staffPresent: 18,
      criticalSystemsDown: [],
    },
    triggerEvents: [
      { minute: 0, event: 'Operador reporta fuga de IBC 1000L con HCl.', expectedResponse: 'Aislar zona' },
      { minute: 3, event: 'Vapor visible — viento lleva pluma hacia oficinas.', expectedResponse: 'Evacuación direccional' },
      { minute: 8, event: 'Operador con irritación respiratoria.', expectedResponse: 'Atención + ducha emergencia' },
      { minute: 15, event: 'Brigada HAZMAT con EPP 4 ingresa.', expectedResponse: 'Contención con material absorbente' },
      { minute: 45, event: 'Derrame contenido. Pendiente neutralización.', expectedResponse: 'Disposición autorizada' },
    ],
    decisionPoints: [
      {
        minute: 0,
        question: 'Primer respondedor sin EPP HAZMAT. ¿Qué hace?',
        options: ['Entra a cerrar la válvula', 'Aísla zona + retira personal a barlovento', 'Espera brigada', 'Echa agua al derrame'],
        correctResponses: ['Aísla zona + retira personal a barlovento'],
        rationale: 'Sin EPP nivel adecuado NO se entra. Personal a barlovento (viento a favor).',
      },
      {
        minute: 3,
        question: '¿Dirección de evacuación con pluma a oficinas?',
        options: ['Hacia oficinas', 'Perpendicular al viento', 'A favor del viento', 'Refugiarse adentro'],
        correctResponses: ['Perpendicular al viento'],
        rationale: 'Evacuar perpendicular al viento + cuesta arriba si posible.',
      },
      {
        minute: 8,
        question: 'Operador irritado respiratorio. ¿Tratamiento inicial?',
        options: ['Ducha de emergencia 15 min + oxígeno', 'Beber leche', 'Inducir vómito', 'Solo agua y observar'],
        correctResponses: ['Ducha de emergencia 15 min + oxígeno'],
        rationale: 'HCl corrosivo: descontaminación masiva con agua + soporte respiratorio.',
      },
      {
        minute: 45,
        question: 'Disposición de material contaminado:',
        options: ['Botar a alcantarillado diluido', 'Empresa autorizada SLU', 'Enterrar en faena', 'Esperar lluvia'],
        correctResponses: ['Empresa autorizada SLU'],
        rationale: 'Residuo peligroso → SLU autorizado por SEREMI Salud, declaración SIDREP.',
      },
    ],
    successCriteria: [
      'Sin trabajadores adicionales expuestos tras minuto 3',
      'Atención médica al expuesto <10 min',
      'Pluma controlada antes de alcanzar oficinas',
      'Disposición correcta documentada',
    ],
    estimatedDurationMin: 60,
    applicableIndustries: ['mining', 'industrial', 'logistics'],
  },
  {
    kind: 'evacuation_blocked',
    severity: 'major',
    title: 'Vía de evacuación principal bloqueada durante emergencia',
    defaults: {
      time: 'shift_change',
      staffPresent: 45,
      criticalSystemsDown: ['vía evacuación norte'],
    },
    triggerEvents: [
      { minute: 0, event: 'Alarma de emergencia activa.', expectedResponse: 'Inicio evacuación' },
      { minute: 2, event: 'Vía norte bloqueada por estructura caída.', expectedResponse: 'Redirigir' },
      { minute: 5, event: 'Confusión en personal de cambio de turno (turno saliente + entrante).', expectedResponse: 'Líder unificado' },
      { minute: 10, event: 'Conteo en punto: faltan 3 personas.', expectedResponse: 'Búsqueda controlada' },
      { minute: 18, event: 'Personas localizadas en refugio.', expectedResponse: 'Rescate guiado' },
    ],
    decisionPoints: [
      {
        minute: 2,
        question: 'Vía norte caída. ¿Ruta alterna?',
        options: ['Romper pared para abrir', 'Vía sur (más larga pero clara)', 'Refugio in-situ', 'Esperar despeje'],
        correctResponses: ['Vía sur (más larga pero clara)'],
        rationale: 'Toda faena debe tener mínimo 2 vías. Sur es la documentada.',
      },
      {
        minute: 5,
        question: 'Cambio de turno: dos supervisores. ¿Quién manda?',
        options: ['El saliente (conoce faena)', 'El entrante (fresco)', 'Ambos en paralelo', 'El de mayor jerarquía hasta unificar'],
        correctResponses: ['El saliente (conoce faena)', 'El de mayor jerarquía hasta unificar'],
        rationale: 'Continuidad de mando: saliente termina la emergencia con apoyo del entrante.',
      },
      {
        minute: 10,
        question: 'Faltan 3. ¿Quién va a buscarlas?',
        options: ['Todos los presentes', 'Equipo de búsqueda designado con EPP', 'Esperar bomberos', 'Llamarlas por celular'],
        correctResponses: ['Equipo de búsqueda designado con EPP'],
        rationale: 'Búsqueda solo con equipo entrenado + EPP. Resto en punto encuentro.',
      },
    ],
    successCriteria: [
      'Vía alterna activada <5 min',
      'Continuidad de mando documentada',
      'Búsqueda controlada con equipo designado',
      'Reconteo correcto al finalizar',
    ],
    estimatedDurationMin: 45,
    applicableIndustries: ['construction', 'mining', 'industrial', 'logistics', 'office', 'healthcare'],
  },
  {
    kind: 'power_outage',
    severity: 'moderate',
    title: 'Corte eléctrico prolongado — sin generador de respaldo',
    defaults: {
      time: 'day',
      staffPresent: 30,
      criticalSystemsDown: ['energía principal', 'aire acondicionado', 'cámaras CCTV'],
    },
    triggerEvents: [
      { minute: 0, event: 'Corte total. UPS aguanta 15 min.', expectedResponse: 'Evaluar prioridades' },
      { minute: 5, event: 'Servidor crítico aún arriba (UPS).', expectedResponse: 'Apagado controlado' },
      { minute: 15, event: 'UPS agotada. Sistemas IT caídos.', expectedResponse: 'Modo manual' },
      { minute: 30, event: 'Distribuidora informa ETA 6h.', expectedResponse: 'Plan continuidad' },
      { minute: 60, event: 'Operación parcial con linternas + radios.', expectedResponse: 'Decisión: parar o seguir' },
    ],
    decisionPoints: [
      {
        minute: 5,
        question: 'UPS aguanta 15 min, ¿servidor de control?',
        options: ['Apagado controlado de inmediato', 'Esperar hasta que UPS se acabe', 'Forzar shutdown', 'Desconectar físicamente'],
        correctResponses: ['Apagado controlado de inmediato'],
        rationale: 'Apagado ordenado evita corrupción de datos. UPS es para apagar bonito, no para operar.',
      },
      {
        minute: 30,
        question: 'ETA 6 horas. Faena debe ¿…?',
        options: ['Seguir operando manual', 'Detener faena no esencial', 'Enviar a todos a casa', 'Operar normal'],
        correctResponses: ['Detener faena no esencial'],
        rationale: 'Sin energía, riesgos aumentan (iluminación, ventilación). Operar solo lo crítico.',
      },
      {
        minute: 60,
        question: 'Comunicación con mandante sin red:',
        options: ['Esperar', 'Mensajero físico a oficina mandante', 'Radio + SAT phone si hay', 'Email cuando vuelva'],
        correctResponses: ['Radio + SAT phone si hay', 'Mensajero físico a oficina mandante'],
        rationale: 'Plan ICE debe contemplar canal alterno: radio, satelital o mensajero.',
      },
    ],
    successCriteria: [
      'Apagado controlado de IT crítico',
      'Decisión documentada de parar/operar tareas',
      'Comunicación con mandante mantenida por canal alterno',
      'Reinicio ordenado al volver energía',
    ],
    estimatedDurationMin: 75,
    applicableIndustries: ['industrial', 'logistics', 'office', 'healthcare', 'mining'],
  },
  {
    kind: 'leader_unavailable',
    severity: 'moderate',
    title: 'Supervisor principal incomunicado durante emergencia',
    defaults: {
      time: 'day',
      staffPresent: 20,
      criticalSystemsDown: [],
    },
    triggerEvents: [
      { minute: 0, event: 'Incidente menor: caída de altura, una persona afectada.', expectedResponse: 'Atención + corte' },
      { minute: 2, event: 'Supervisor principal fuera de faena, sin señal.', expectedResponse: 'Activar reemplazo' },
      { minute: 5, event: 'Segundo al mando documentado toma mando.', expectedResponse: 'Continuar protocolo' },
      { minute: 15, event: 'Supervisor recupera señal y se reincorpora.', expectedResponse: 'Briefing y traspaso' },
    ],
    decisionPoints: [
      {
        minute: 2,
        question: 'Supervisor incomunicado. ¿Quién manda?',
        options: ['Esperar a que aparezca', 'Segundo al mando designado en plan', 'El más antiguo', 'Votación'],
        correctResponses: ['Segundo al mando designado en plan'],
        rationale: 'Plan de continuidad operacional debe tener segundo al mando documentado y entrenado.',
      },
      {
        minute: 15,
        question: 'Supervisor reaparece. ¿Toma mando inmediato?',
        options: ['Sí, retoma sin más', 'Briefing del segundo al mando y luego decide', 'Espera al final del evento', 'Lo lleva el segundo al mando hasta cierre'],
        correctResponses: ['Briefing del segundo al mando y luego decide', 'Lo lleva el segundo al mando hasta cierre'],
        rationale: 'Cambio de mando en caliente requiere briefing — no se interrumpe a quien está coordinando.',
      },
    ],
    successCriteria: [
      'Segundo al mando activado <5 min',
      'Atención al accidentado dentro de tiempo objetivo',
      'Traspaso documentado',
    ],
    estimatedDurationMin: 30,
    applicableIndustries: ['construction', 'mining', 'industrial', 'logistics', 'office', 'healthcare'],
  },
  {
    kind: 'mass_casualty',
    severity: 'catastrophic',
    title: 'Evento de víctimas múltiples — colapso parcial de estructura',
    defaults: {
      time: 'day',
      staffPresent: 60,
      criticalSystemsDown: ['estructura zona C'],
    },
    triggerEvents: [
      { minute: 0, event: 'Colapso parcial — 8 personas reportadas en zona.', expectedResponse: 'Triage + 131' },
      { minute: 3, event: 'Primer triage: 2 rojos, 3 amarillos, 2 verdes, 1 negro.', expectedResponse: 'Priorización' },
      { minute: 8, event: 'SAMU en camino, ETA 15 min.', expectedResponse: 'Preparar acceso' },
      { minute: 15, event: 'Múltiples ambulancias llegan.', expectedResponse: 'PMA establecido' },
      { minute: 30, event: 'Hospitales receptores: dispersar carga.', expectedResponse: 'Coordinación con DGRESS' },
      { minute: 120, event: 'Cierre operativo. Familias notificadas.', expectedResponse: 'Plan post-evento' },
    ],
    decisionPoints: [
      {
        minute: 0,
        question: '¿Quién hace el primer triage?',
        options: ['Primer respondedor entrenado en START', 'Esperar SAMU', 'Cualquiera disponible', 'El supervisor'],
        correctResponses: ['Primer respondedor entrenado en START'],
        rationale: 'START triage en <60s por víctima. Brigada de emergencia debe estar entrenada.',
      },
      {
        minute: 3,
        question: '2 rojos compiten por atención inmediata. ¿Cómo se prioriza?',
        options: ['Por edad', 'Por gravedad reversible', 'Primero en ser visto', 'Por jerarquía laboral'],
        correctResponses: ['Por gravedad reversible'],
        rationale: 'En MCI se prioriza vida salvable, no jerarquía. Concepto de utilitarismo médico.',
      },
      {
        minute: 15,
        question: '¿Quién dirige el PMA (Puesto Mando Avanzado)?',
        options: ['Líder brigada interna', 'Jefe SAMU al llegar', 'Bomberos', 'Mandante'],
        correctResponses: ['Jefe SAMU al llegar'],
        rationale: 'Triage médico al SAMU; brigada interna pasa a soporte. Doble mando es peligroso.',
      },
      {
        minute: 30,
        question: 'Dispersar a múltiples hospitales:',
        options: ['Todos al mismo (más cercano)', 'Distribuir según capacidad/especialidad', 'Esperar instrucción de Salud', 'Familia decide'],
        correctResponses: ['Distribuir según capacidad/especialidad'],
        rationale: 'Saturar 1 hospital colapsa atención. Dispersar a centros con capacidad UTI/quirófano.',
      },
      {
        minute: 120,
        question: 'Notificación a familias:',
        options: ['Por WhatsApp grupal', 'Persona designada cara a cara o llamada con protocolo', 'Vía RRHH email', 'Prensa primero'],
        correctResponses: ['Persona designada cara a cara o llamada con protocolo'],
        rationale: 'Notificación de muerte/lesión grave: protocolo formal, NUNCA por mensaje masivo ni prensa antes.',
      },
    ],
    successCriteria: [
      'Triage START realizado <5 min',
      'PMA con SAMU al mando <20 min',
      'Dispersión hospitalaria sin saturar 1 centro',
      'Notificación familias con protocolo correcto',
      'Plan psicológico post-evento activado',
    ],
    estimatedDurationMin: 180,
    applicableIndustries: ['construction', 'mining', 'industrial', 'logistics'],
  },
  {
    kind: 'supplier_failure',
    severity: 'minor',
    title: 'Falla de proveedor único de EPP crítico',
    defaults: {
      time: 'day',
      staffPresent: 40,
      criticalSystemsDown: [],
    },
    triggerEvents: [
      { minute: 0, event: 'Proveedor único informa quiebre stock arnés para 2 semanas.', expectedResponse: 'Activar plan B' },
      { minute: 30, event: 'Stock interno cubre 5 días.', expectedResponse: 'Calificar alterno' },
      { minute: 60, event: 'Mandante exige continuidad de trabajos en altura.', expectedResponse: 'Negociar o priorizar' },
    ],
    decisionPoints: [
      {
        minute: 0,
        question: 'Sin arneses nuevos en 2 semanas, ¿continuamos altura?',
        options: ['Sí, total que hay stock', 'Detener trabajos en altura hasta confirmar continuidad', 'Reutilizar arneses vencidos', 'Comprar a cualquier proveedor sin certificar'],
        correctResponses: ['Detener trabajos en altura hasta confirmar continuidad'],
        rationale: 'EPP crítico vencido = riesgo legal y de vida. Proveedor alternativo debe estar certificado.',
      },
      {
        minute: 30,
        question: 'Calificar proveedor alterno:',
        options: ['Comprar de inmediato sin chequear', 'Verificar certificación INN + normativa + lote', 'Solo basta cotización', 'Pedir referencia de otra empresa'],
        correctResponses: ['Verificar certificación INN + normativa + lote'],
        rationale: 'EPP debe cumplir norma chilena INN. Lote y certificación obligatorios.',
      },
      {
        minute: 60,
        question: 'Mandante presiona. ¿Argumento?',
        options: ['Ceder y seguir', 'Mostrar plan + ETA reposición + riesgo legal', 'Esconder problema', 'Reasignar a otras tareas'],
        correctResponses: ['Mostrar plan + ETA reposición + riesgo legal', 'Reasignar a otras tareas'],
        rationale: 'Transparencia + plan. Mandante prefiere demora a accidente.',
      },
    ],
    successCriteria: [
      'Decisión documentada de detener altura',
      'Proveedor alterno calificado correctamente',
      'Comunicación a mandante con plan concreto',
    ],
    estimatedDurationMin: 90,
    applicableIndustries: ['construction', 'mining', 'industrial', 'logistics', 'healthcare'],
  },
  {
    kind: 'flood',
    severity: 'major',
    title: 'Inundación por lluvia extrema — anega faena',
    defaults: {
      time: 'day',
      weather: 'lluvia extrema',
      staffPresent: 22,
      criticalSystemsDown: ['drenaje sur'],
    },
    triggerEvents: [
      { minute: 0, event: 'Agua sube 30 cm en zona baja.', expectedResponse: 'Evacuación zona baja' },
      { minute: 10, event: 'Tableros eléctricos bajos en riesgo.', expectedResponse: 'Corte energía zona' },
      { minute: 25, event: 'Maquinaria atrapada parcialmente.', expectedResponse: 'NO entrar a rescatar' },
    ],
    decisionPoints: [
      {
        minute: 0,
        question: 'Agua a 30 cm subiendo. ¿Personal?',
        options: ['Sigue trabajando', 'Evacúa zona baja a zona alta', 'Trata de achicar', 'Cierra portones'],
        correctResponses: ['Evacúa zona baja a zona alta'],
        rationale: 'Inundación sube rápido. Evacuar antes de quedar atrapado.',
      },
      {
        minute: 10,
        question: 'Tableros eléctricos van a tocar agua:',
        options: ['Cortar energía de toda la zona', 'Subirlos rápido', 'Cubrirlos con plástico', 'Esperar'],
        correctResponses: ['Cortar energía de toda la zona'],
        rationale: 'Agua + electricidad = electrocución masiva. Corte preventivo obligatorio.',
      },
      {
        minute: 25,
        question: 'Maquinaria atrapada con operador adentro:',
        options: ['Sumergirse a rescatar', 'Activar protocolo rescate con equipo entrenado', 'Esperar que baje agua', 'Tirarle cuerda'],
        correctResponses: ['Activar protocolo rescate con equipo entrenado'],
        rationale: 'Rescate en agua requiere entrenamiento — más de 1 muerte adicional ocurre por rescatistas no entrenados.',
      },
    ],
    successCriteria: [
      'Evacuación zona baja <5 min',
      'Corte eléctrico preventivo antes de contacto',
      'Sin rescatistas improvisados',
    ],
    estimatedDurationMin: 60,
    applicableIndustries: ['construction', 'mining', 'industrial', 'logistics'],
  },
  {
    kind: 'cyber_attack',
    severity: 'major',
    title: 'Ransomware — sistemas IT secuestrados',
    defaults: {
      time: 'day',
      staffPresent: 35,
      criticalSystemsDown: ['ERP', 'control de acceso'],
    },
    triggerEvents: [
      { minute: 0, event: 'Workstations muestran nota de rescate.', expectedResponse: 'Aislar red' },
      { minute: 5, event: 'IT confirma cifrado en servidor principal.', expectedResponse: 'Activar IRP' },
      { minute: 30, event: 'Atacante exige rescate en cripto.', expectedResponse: 'NO pagar' },
      { minute: 90, event: 'Backup offline disponible — 24h atrás.', expectedResponse: 'Restaurar' },
    ],
    decisionPoints: [
      {
        minute: 0,
        question: 'Workstations infectadas. ¿Primera acción?',
        options: ['Apagar todas las máquinas', 'Desconectar de red pero no apagar (forensia)', 'Pagar el rescate', 'Esperar al lunes'],
        correctResponses: ['Desconectar de red pero no apagar (forensia)'],
        rationale: 'Apagar pierde evidencia volátil. Aislar de red detiene propagación sin perder forensia.',
      },
      {
        minute: 30,
        question: 'Atacante exige rescate:',
        options: ['Pagar rápido', 'Negociar para bajar precio', 'No pagar; restaurar de backup + reportar PDI', 'Ignorar'],
        correctResponses: ['No pagar; restaurar de backup + reportar PDI'],
        rationale: 'Pagar no garantiza recuperación + financia crimen. Reportar a Brigada Cibercrimen PDI obligatorio.',
      },
      {
        minute: 90,
        question: 'Backup de 24h atrás. ¿Restauración inmediata?',
        options: ['Sí, restaurar a producción', 'Restaurar a entorno aislado y verificar limpieza primero', 'Esperar a tener backup más reciente', 'No restaurar'],
        correctResponses: ['Restaurar a entorno aislado y verificar limpieza primero'],
        rationale: 'Restaurar a producción sin verificar = re-infección. Sandbox primero.',
      },
    ],
    successCriteria: [
      'Aislamiento de red <10 min',
      'No pago de rescate',
      'Reporte a PDI Cibercrimen y a empresa',
      'Restauración verificada antes de producción',
    ],
    estimatedDurationMin: 240,
    applicableIndustries: ['industrial', 'logistics', 'office', 'healthcare'],
  },
];

// ────────────────────────────────────────────────────────────────────────
// Builders
// ────────────────────────────────────────────────────────────────────────

let _scenarioCounter = 0;

/**
 * Construye un escenario de contingencia a partir de las plantillas
 * pre-built. Si no existe template exacto para (kind, severity), buscamos
 * el de igual kind más cercano en severidad.
 */
export function buildScenario(
  kind: ScenarioKind,
  severity: ScenarioSeverity,
  options: BuildScenarioOptions = {},
): ContingencyScenario {
  const sameKind = TEMPLATES.filter((t) => t.kind === kind);
  if (sameKind.length === 0) {
    throw new Error(`Sin plantilla para kind=${kind}`);
  }
  const exact = sameKind.find((t) => t.severity === severity);
  const template = exact ?? sameKind[0];

  const id =
    options.id ??
    `${kind}_${severity}_${++_scenarioCounter}_${Date.now().toString(36)}`;

  const initialConditions: ScenarioInitialConditions = {
    ...template.defaults,
    ...(options.initialConditions ?? {}),
  };

  return {
    id,
    kind: template.kind,
    severity, // respeta lo pedido, no el del template
    title: template.title,
    initialConditions,
    triggerEvents: [...template.triggerEvents],
    decisionPoints: [...template.decisionPoints],
    successCriteria: [...template.successCriteria],
    estimatedDurationMin: template.estimatedDurationMin,
  };
}

/**
 * Lista todos los escenarios disponibles. Si se pasa industry, filtra a los
 * aplicables.
 */
export function listAvailableScenarios(
  industry?: BuildScenarioOptions['industry'],
): ContingencyScenario[] {
  const filtered = industry
    ? TEMPLATES.filter((t) => t.applicableIndustries.includes(industry))
    : TEMPLATES;

  return filtered.map((t) => ({
    id: `${t.kind}_${t.severity}_template`,
    kind: t.kind,
    severity: t.severity,
    title: t.title,
    initialConditions: { ...t.defaults },
    triggerEvents: [...t.triggerEvents],
    decisionPoints: [...t.decisionPoints],
    successCriteria: [...t.successCriteria],
    estimatedDurationMin: t.estimatedDurationMin,
  }));
}

/** Cantidad total de plantillas instaladas (para auto-test). */
export function countAvailableTemplates(): number {
  return TEMPLATES.length;
}
