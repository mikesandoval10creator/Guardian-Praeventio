/**
 * Términos y Condiciones de Servicio — Praeventio Guard
 *
 * Contenido legal en es-CL, mantenido como string-table para que pueda ser
 * revisado por abogados de forma independiente del componente que lo renderiza
 * (`src/pages/Terms.tsx`).
 *
 * Si necesitas modificar el texto, edítalo aquí y actualiza `LAST_UPDATED_ISO`.
 * El renderer no aplica formato Markdown completo: cada sección es un objeto
 * con `heading` y `paragraphs[]` ya en HTML-friendly text plano.
 *
 * Cumplimiento referenciado:
 *   - Ley 19.496 (Protección al Consumidor, Chile)
 *   - Ley 19.628 (Protección de Datos Personales, Chile) — vigente
 *   - Ley 21.719 (Protección de Datos Personales; crea la Agencia de
 *     Protección de Datos Personales, APDP) — entrada en vigencia 2026-12-01,
 *     deroga/reemplaza la Ley 19.628
 *   - Reglamento (UE) 2016/679 (RGPD/GDPR) — para tratamiento de datos de
 *     titulares en la Unión Europea
 *   - Ley 16.744, DS 54, DS 44/2024 (reemplaza DS 40/1969 derogado 2025-02-01) — prevención de riesgos laborales
 *   - SUSESO (rol del prevencionista certificado)
 *
 * ⚠️ Borrador — pendiente revisión legal. Todo el texto de cláusulas de este
 * archivo es un BORRADOR redactado para ser CERTIFICADO por un abogado chileno
 * especialista en protección de datos antes de su publicación definitiva.
 * NO afirma que la Plataforma "cumple" o "está certificada" bajo la Ley 21.719
 * ni el RGPD/GDPR: describe compromisos y mecanismos, no certificaciones.
 * NO inventar artículos/plazos legales nuevos sin cita verificada (marcar TODO).
 */

export interface TermsSection {
  /** Encabezado visible (h2 en el renderer). Numerado por el orden del array. */
  heading: string;
  /** Lista de párrafos. Cada string se renderiza como un <p> independiente. */
  paragraphs: string[];
}

export interface TermsContent {
  title: string;
  /** Subtítulo bajo el título principal. */
  subtitle: string;
  /** Fecha de última actualización del contenido en formato ISO 8601 (YYYY-MM-DD). */
  lastUpdatedISO: string;
  sections: TermsSection[];
  /** Email de contacto comercial / soporte general. */
  contactEmail: string;
  /** Email para temas de privacidad de datos (Ley 19.628; Ley 21.719 desde 2026-12-01). */
  privacyEmail: string;
  /** RUT de la entidad responsable del servicio en Chile. */
  rut: string;
  /** Razón social / marca operativa. */
  legalEntity: string;
}

/**
 * Última fecha de actualización del contenido. Cambiar al editar cualquier
 * sección material. El renderer la muestra formateada en es-CL.
 */
export const LAST_UPDATED_ISO = '2026-06-21';

export const TERMS_CONTENT_ES_CL: TermsContent = {
  title: 'Términos y Condiciones de Servicio — Praeventio Guard',
  subtitle: 'Guardian Praeventio · praeventio.net',
  lastUpdatedISO: LAST_UPDATED_ISO,
  contactEmail: 'contacto@praeventio.net',
  privacyEmail: 'contacto@praeventio.net',
  rut: '78.231.119-0',
  legalEntity: 'Guardian Praeventio',
  sections: [
    {
      heading: 'Aceptación',
      paragraphs: [
        'Al acceder, registrarse o utilizar la plataforma Praeventio Guard ("la Plataforma", "el Servicio"), usted ("el Usuario") declara haber leído, entendido y aceptado en su totalidad los presentes Términos y Condiciones, así como la Política de Privacidad asociada. Si actúa en representación de una empresa u organización, declara contar con las facultades suficientes para obligar a dicha entidad.',
        'Si no está de acuerdo con alguno de los puntos aquí descritos, debe abstenerse de crear una cuenta y de utilizar el Servicio. La aceptación de estos términos se manifiesta de forma inequívoca al marcar la casilla correspondiente durante el registro, al iniciar sesión con un proveedor federado (Google), o por el simple hecho de utilizar las funcionalidades de la Plataforma.',
        'Estos Términos constituyen un contrato vinculante entre el Usuario y Guardian Praeventio (RUT 78.231.119-0), entidad operadora del dominio praeventio.net.',
      ],
    },
    {
      heading: 'Descripción del servicio',
      paragraphs: [
        'Praeventio Guard es una plataforma digital de gestión y prevención de riesgos laborales orientada a industrias críticas (minería, construcción, faenas remotas, manufactura, salud) en Chile y Latinoamérica. El Servicio combina herramientas de cumplimiento normativo, asistente de inteligencia artificial ("El Guardián"), análisis predictivo, gestión documental, capacitación, comunicación de emergencias y reportería ejecutiva.',
        'La Plataforma está diseñada como una herramienta complementaria al trabajo del experto en prevención de riesgos. Facilita la trazabilidad de incidentes, la administración de matrices de riesgo, la difusión de protocolos y la coordinación de comités paritarios, entre otras funciones documentadas en la sección de ayuda dentro del producto.',
        'Las funcionalidades disponibles dependen del plan contratado (gratuito, básico, profesional o enterprise) y pueden evolucionar en el tiempo. Praeventio Guard se reserva el derecho de añadir, modificar o discontinuar características específicas, notificando con al menos 15 días de anticipación cuando un cambio afecte materialmente el plan vigente del Usuario.',
      ],
    },
    {
      heading: 'Cuenta de usuario y responsabilidades',
      paragraphs: [
        'Para utilizar la mayoría de las funciones de Praeventio Guard, el Usuario debe crear una cuenta entregando información verídica, completa y actualizada. La autenticación se realiza preferentemente mediante Google Sign-In; el Usuario es el único responsable de la seguridad de las credenciales asociadas a esa cuenta y de cualquier actividad realizada bajo ella.',
        'El Usuario se compromete a: (i) no suplantar la identidad de terceros; (ii) no cargar datos personales de trabajadores sin contar con el consentimiento o base legal correspondiente conforme a la Ley 19.628; (iii) no utilizar la Plataforma para fines ilícitos, fraudulentos o contrarios al orden público; (iv) no intentar vulnerar la seguridad del Servicio, realizar ingeniería inversa, ni extraer datos masivamente mediante scraping; (v) mantener confidencial la información sensible de su organización a la que tenga acceso por su rol.',
        'Los administradores de proyecto son responsables de gestionar correctamente los roles RBAC (gerente, supervisor, trabajador, etc.) que asignen a otros miembros, y de revocar accesos cuando una persona deje la organización. Praeventio Guard provee las herramientas técnicas, pero la asignación operativa de permisos es responsabilidad del cliente.',
      ],
    },
    {
      heading: 'Pagos, suscripciones y devoluciones',
      paragraphs: [
        'Los planes de pago se contratan en modalidad de suscripción mensual o anual, con renovación automática salvo cancelación expresa antes del próximo ciclo. Los precios publicados en praeventio.net y en la sección de Pricing del producto incluyen IVA (19%) cuando aplique para clientes en Chile. La razón social facturadora es Guardian Praeventio, RUT 78.231.119-0.',
        'Los métodos de pago disponibles incluyen tarjetas de crédito y débito a través de procesadores certificados (Webpay/Transbank, Google Play Billing y otros gateways). Praeventio Guard no almacena datos completos de tarjetas en sus servidores; solo conserva un identificador opaco devuelto por el procesador y los metadatos necesarios para emitir documentos tributarios.',
        'Conforme a la Ley 19.496 sobre Protección de los Derechos de los Consumidores, el Usuario puede ejercer el derecho de retracto dentro de los 10 días corridos contados desde la contratación inicial, siempre que no haya consumido la totalidad de los servicios incluidos en el ciclo. Las solicitudes de devolución deben canalizarse a contacto@praeventio.net y serán respondidas en un plazo máximo de 10 días hábiles. No se efectúan devoluciones proporcionales por cancelaciones realizadas en mitad de un ciclo de facturación ya iniciado, sin perjuicio de los derechos irrenunciables del consumidor.',
      ],
    },
    {
      heading: 'Privacidad de datos',
      paragraphs: [
        'El tratamiento de datos personales realizado por Praeventio Guard se rige por la Política de Privacidad disponible en /privacy, la cual forma parte integrante de estos Términos. La Política detalla qué datos se recopilan, con qué finalidad, los terceros con quienes se comparten (Google Firebase, Google Gemini, Resend, procesadores de pago), los plazos de retención y los mecanismos para ejercer los derechos del titular bajo la legislación chilena de protección de datos personales (Ley 19.628 y, a partir de su entrada en vigencia el 01-12-2026, la Ley 21.719).',
        'En su relación con la empresa-cliente, Praeventio Guard actúa como ENCARGADO de tratamiento por cuenta de dicha empresa, que es el RESPONSABLE del tratamiento de los datos de sus trabajadores. Praeventio Guard trata esos datos únicamente conforme a las instrucciones del responsable y a las finalidades pactadas, aplicando medidas de seguridad técnicas y organizativas y no destinándolos a fines propios incompatibles.',
        'Para titulares de datos en la Unión Europea, el tratamiento se ajusta además a los principios del Reglamento (UE) 2016/679 (RGPD/GDPR), incluyendo licitud, minimización, limitación de la finalidad y los derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad reconocidos en dicho Reglamento.',
        'Para consultas, solicitudes de acceso, rectificación, supresión, oposición, portabilidad u otros derechos del titular, el Usuario puede escribir a contacto@praeventio.net. Praeventio Guard responderá dentro de los plazos establecidos por la normativa de protección de datos aplicable.',
      ],
    },
    {
      heading: 'Naturaleza del servicio y rol del Usuario en la decisión preventiva',
      paragraphs: [
        'Praeventio Guard GESTIONA, ORGANIZA Y PRESENTA INFORMACIÓN de prevención de riesgos para FACILITAR LA DECISIÓN del responsable de la prevención (la empresa empleadora, su experto en prevención de riesgos, el prevencionista certificado o el profesional habilitado que corresponda). LA PLATAFORMA NO ES EL TOMADOR DE LA DECISIÓN PREVENTIVA, NO DIAGNOSTICA, NO CALIFICA ENFERMEDADES NI ACCIDENTES COMO LABORALES, Y NO REEMPLAZA EL JUICIO PROFESIONAL HABILITADO. La decisión sobre qué medidas adoptar, cuándo detener o continuar una operación, y cómo gestionar un riesgo es y seguirá siendo responsabilidad exclusiva del Usuario y de la empresa-cliente.',
        'La Plataforma NUNCA bloquea ni detiene maquinaria, faenas ni operaciones por sí misma: entrega recomendaciones de base científica y normativa para que la persona responsable decida. La obligación legal de proveer condiciones de trabajo seguras y de gestionar los riesgos laborales recae en el empleador conforme a la Ley 16.744 y su normativa complementaria (DS 44/2024 [reemplaza DS 40/1969 derogado 2025-02-01], DS 54, DS 594, entre otras); el uso de Praeventio Guard NO traslada, sustituye ni disminuye dicha obligación.',
        'Praeventio Guard actúa como ENCARGADO de tratamiento de los datos de los trabajadores por cuenta de la empresa-cliente, que es el RESPONSABLE del tratamiento. Las decisiones sobre finalidades y medios del tratamiento, así como la decisión preventiva final, corresponden al responsable.',
      ],
    },
    {
      heading: 'Limitación de responsabilidad',
      paragraphs: [
        'Praeventio Guard es una herramienta complementaria de gestión de información de prevención de riesgos. EL SERVICIO NO REEMPLAZA AL EXPERTO EN PREVENCIÓN DE RIESGOS CERTIFICADO POR SUSESO ni a los profesionales habilitados legalmente para emitir matrices IPER, programas de seguridad, peritajes, certificaciones de equipos críticos, exámenes ocupacionales, ni cualquier otro acto que la legislación chilena (Ley 16.744, DS 44/2024 [reemplaza DS 40/1969 derogado 2025-02-01], DS 54, DS 594, entre otras) reserva exclusivamente a profesionales colegiados o a organismos administradores de la Ley 16.744.',
        'Las recomendaciones, análisis predictivos y respuestas generadas por los componentes de inteligencia artificial de la Plataforma (incluyendo "El Guardián", basado en Google Gemini) son de carácter orientativo y deben ser validadas por el prevencionista responsable antes de su aplicación operativa. El Usuario asume la responsabilidad final por las decisiones que adopte a partir de la información provista por el Servicio.',
        'En la máxima medida permitida por la ley, Praeventio Guard no será responsable por daños indirectos, incidentales, especiales o consecuenciales, lucro cesante, pérdida de oportunidad, pérdida de datos, interrupción del negocio, ni por incidentes laborales que pudieran ocurrir, sin perjuicio de las garantías irrenunciables que correspondan al consumidor conforme a la Ley 19.496.',
        'Sin perjuicio de lo anterior y en la máxima medida permitida por la ley, la responsabilidad total y agregada de Praeventio Guard frente al Usuario por cualquier reclamo derivado de o relacionado con el Servicio o con estos Términos —ya sea por contrato, hecho ilícito (incluida la negligencia) u otra causa— no excederá el monto total efectivamente pagado por el Usuario a Praeventio Guard por el Servicio durante los doce (12) meses inmediatamente anteriores al hecho que origina el reclamo. Este límite agregado no aplica a la responsabilidad que la ley declare irrenunciable o no susceptible de limitación (por ejemplo, dolo, culpa grave, o los derechos irrenunciables del consumidor conforme a la Ley 19.496).',
      ],
    },
    {
      heading: 'Disponibilidad del servicio',
      paragraphs: [
        'Praeventio Guard se entrega "tal cual" y "según disponibilidad" (best effort). Los planes gratuitos y básicos no incluyen un acuerdo de nivel de servicio (SLA) con compromisos de uptime numérico ni de tiempos de respuesta. Praeventio Guard hace esfuerzos razonables para mantener la Plataforma operativa 24/7, pero no garantiza una disponibilidad ininterrumpida ni libre de errores en estos tiers.',
        'Los planes Profesional y Enterprise pueden incluir un SLA específico, formalizado mediante un anexo contractual independiente. En ausencia de dicho anexo, regirán las condiciones generales de este apartado.',
        'Praeventio Guard puede realizar mantenimientos programados o de emergencia que impliquen interrupciones temporales. Cuando sea posible, estos mantenimientos se anunciarán con anticipación a través de la Plataforma o por correo electrónico.',
      ],
    },
    {
      heading: 'Modificaciones de los términos',
      paragraphs: [
        'Praeventio Guard puede modificar los presentes Términos en cualquier momento para reflejar cambios legales, regulatorios, comerciales o técnicos. Los cambios materiales serán notificados al Usuario con al menos 15 días corridos de anticipación, mediante un aviso destacado dentro de la Plataforma y/o un correo electrónico al e-mail registrado.',
        'El uso continuado del Servicio una vez transcurrido el plazo de notificación implicará la aceptación de los Términos modificados. Si el Usuario no está de acuerdo con los nuevos Términos, podrá dar por terminada su suscripción antes de la fecha de entrada en vigor, conservando los derechos de devolución pertinentes.',
      ],
    },
    {
      heading: 'Ley aplicable',
      paragraphs: [
        'Estos Términos se rigen por las leyes de la República de Chile, incluyendo la normativa de protección de datos personales (Ley 19.628 y, desde su entrada en vigencia el 01-12-2026, la Ley 21.719, que crea la Agencia de Protección de Datos Personales). Cualquier controversia derivada o relacionada con la interpretación, ejecución o terminación del presente acuerdo será sometida a la jurisdicción de los tribunales ordinarios de justicia con asiento en la ciudad de Santiago, sin perjuicio de los derechos del consumidor establecidos en la Ley 19.496 y de los mecanismos de protección al consumidor del SERNAC.',
        'Cuando Praeventio Guard trate datos personales de titulares ubicados en la Unión Europea, ello se entenderá sin perjuicio de los derechos y de la protección que el Reglamento (UE) 2016/679 (RGPD/GDPR) reconozca a dichos titulares conforme a la legislación que les resulte aplicable.',
      ],
    },
    {
      heading: 'Contacto',
      paragraphs: [
        'Para consultas comerciales, soporte técnico o reclamos relativos a estos Términos, el Usuario puede contactar a Guardian Praeventio en contacto@praeventio.net. Para temas relacionados con datos personales y privacidad, el canal específico es contacto@praeventio.net. El plazo objetivo de respuesta es de 5 días hábiles para soporte y 15 días hábiles para solicitudes de privacidad.',
      ],
    },
  ],
};
