/**
 * Política de Privacidad — Praeventio Guard
 *
 * BORRADOR — pendiente de revisión y certificación por un abogado chileno
 * especialista en protección de datos. Este texto redacta COMPROMISOS y
 * MECANISMOS de tratamiento; NO declara que la aplicación esté "certificada"
 * ni que "cumple" formalmente con la Ley 21.719 / GDPR. Es responsabilidad del
 * responsable del dato (la empresa-cliente) y de la revisión legal final
 * confirmar la conformidad.
 *
 * Contenido legal en es-CL, mantenido como string-table para que pueda ser
 * revisado por abogados de forma independiente del componente que lo renderiza
 * (`src/pages/PrivacyPolicy.tsx`). Mismo patrón que
 * `src/services/legal/termsContent.ts`.
 *
 * Si necesitas modificar el texto, edítalo aquí y actualiza
 * `PRIVACY_LAST_UPDATED_ISO` con la fecha de la versión revisada. La fecha es
 * FIJA y versionada — NUNCA usar `new Date()` para la fecha de actualización de
 * un documento legal (genera una fecha distinta en cada render, lo que es una
 * mala práctica legal: el usuario debe ver la fecha en que el texto fue
 * efectivamente revisado, no la de hoy).
 *
 * Marco normativo referenciado (verificado, NO inventar artículos/plazos):
 *   - Ley 19.628 (Protección de la Vida Privada, Chile) — marco vigente actual.
 *   - Ley 21.719 (Protección de Datos Personales, Chile) — publicada 13-12-2024,
 *     entrada en vigencia general 01-12-2026. Crea la Agencia de Protección de
 *     Datos Personales (APDP) como autoridad de control. Eleva el estándar a un
 *     nivel comparable al GDPR (datos sensibles, EIPD, transferencias
 *     internacionales, derechos del titular).
 *   - Reglamento (UE) 2016/679 (GDPR) — aplicable a titulares en la Unión
 *     Europea.
 *   - Ley 16.744 / DS 44/2024 / DS 594 — marco de prevención de riesgos
 *     laborales que obliga a la empresa a mantener registros de salud
 *     ocupacional (base legal del tratamiento del dato del trabajador).
 *
 * Rol de Praeventio en la cadena de tratamiento (ADR 0012):
 *   Praeventio actúa como ENCARGADO de tratamiento ("procesador") por cuenta de
 *   la empresa-cliente, que es el RESPONSABLE ("controlador"). Gestionamos
 *   información para facilitar la decisión del responsable; NO decidimos,
 *   diagnosticamos ni calificamos.
 */

export interface PrivacySection {
  /** Encabezado visible (h2 en el renderer). Numerado por el orden del array. */
  heading: string;
  /**
   * Párrafo introductorio opcional de la sección (se renderiza como <p> antes
   * de la lista, si existe).
   */
  intro?: string;
  /** Lista de párrafos. Cada string se renderiza como un <p> independiente. */
  paragraphs?: string[];
  /** Lista de viñetas (<li>). Cada entrada puede tener un término en negrita. */
  bullets?: Array<{ term?: string; text: string }>;
  /** Párrafo de cierre opcional (se renderiza tras la lista). */
  outro?: string;
}

export interface PrivacyContent {
  title: string;
  /** Subtítulo bajo el título principal. */
  subtitle: string;
  /**
   * Fecha de última revisión LEGAL del contenido, en formato ISO 8601
   * (YYYY-MM-DD). FIJA y versionada — ver nota en el encabezado del archivo.
   */
  lastUpdatedISO: string;
  sections: PrivacySection[];
  /** Email de contacto / soporte general. */
  contactEmail: string;
  /**
   * Canal de privacidad (Encargado de Protección de Datos / DPO). Segregado por
   * ASUNTO, no por dirección: la directiva del fundador exige una única
   * dirección canónica (`contacto@praeventio.net`); el discriminador de canal
   * es la línea de asunto, no un buzón distinto.
   */
  privacyChannelSubject: string;
  /** Razón social / marca operativa. */
  legalEntity: string;
  /** Dominio operativo. */
  domain: string;
}

/**
 * Última fecha de REVISIÓN LEGAL del contenido. FIJA — cambiar SOLO cuando un
 * abogado revise una nueva versión del texto. NO derivar de `new Date()`.
 */
export const PRIVACY_LAST_UPDATED_ISO = '2026-06-21';

export const PRIVACY_CONTENT_ES_CL: PrivacyContent = {
  title: 'Política de Privacidad',
  subtitle: 'Guardian Praeventio · praeventio.net',
  lastUpdatedISO: PRIVACY_LAST_UPDATED_ISO,
  contactEmail: 'contacto@praeventio.net',
  privacyChannelSubject: 'Privacidad — Encargado de Protección de Datos',
  legalEntity: 'Guardian Praeventio',
  domain: 'praeventio.net',
  sections: [
    {
      heading: 'Responsable y Encargado del Tratamiento',
      paragraphs: [
        'Guardian Praeventio ("nosotros", "la aplicación") es una plataforma de prevención de riesgos laborales operada a través del dominio praeventio.net.',
        'En la mayoría de los tratamientos relativos a datos de trabajadores, Praeventio actúa como ENCARGADO de tratamiento (procesador) por cuenta de la empresa-cliente, que es el RESPONSABLE (controlador) de los datos. Praeventio gestiona la información para facilitar la decisión del responsable y de los expertos en prevención; no decide, no diagnostica ni califica situaciones laborales o de salud.',
      ],
    },
    {
      heading: 'Datos que Recopilamos',
      bullets: [
        { term: 'Datos de cuenta', text: 'nombre, correo electrónico y foto de perfil obtenidos mediante Google Sign-In.' },
        { term: 'Datos del proyecto', text: 'información sobre su empresa, trabajadores, incidentes, auditorías y capacitaciones que se registran en la plataforma.' },
        { term: 'Datos de salud ocupacional (categoría sensible)', text: 'exámenes ocupacionales, aptitudes, restricciones, vencimientos y registros asociados a la vigilancia de salud que la normativa laboral exige a la empresa. Reciben tratamiento reforzado (ver "Datos Sensibles").' },
        { term: 'Ubicación', text: 'coordenadas GPS en situaciones de emergencia activadas por el usuario o para geovallas configuradas por el administrador del proyecto.' },
        { term: 'Sensores del dispositivo', text: 'acelerómetro (solo para detección de caídas, activado explícitamente). El procesamiento biométrico ocurre 100% en el dispositivo.' },
        { term: 'Notificaciones push', text: 'token del dispositivo para envío de alertas de emergencia y capacitaciones.' },
        { term: 'Datos de suscripción', text: 'plan activo y token de compra. No almacenamos datos completos de tarjetas de crédito.' },
        { term: 'Datos de uso', text: 'eventos de telemetría anónimos para mejorar la aplicación (funciones utilizadas, errores).' },
      ],
    },
    {
      heading: 'Finalidad del Tratamiento',
      bullets: [
        { text: 'Proveer las funcionalidades de prevención de riesgos, emergencias y cumplimiento normativo.' },
        { text: 'Gestionar la identidad y autenticación del usuario.' },
        { text: 'Enviar alertas de emergencia y notificaciones de capacitación.' },
        { text: 'Verificar y gestionar suscripciones.' },
        { text: 'Apoyar a la empresa en el cumplimiento de la normativa chilena de seguridad y salud en el trabajo (Ley 16.744, DS 44/2024, DS 594, ISO 45001).' },
        { text: 'Mejorar la plataforma mediante análisis de uso agregado y anónimo.' },
      ],
    },
    {
      heading: 'Base Legal del Tratamiento',
      paragraphs: [
        'El tratamiento de datos se realiza conforme a la Ley N° 19.628 sobre Protección de la Vida Privada de Chile, y se ajusta progresivamente al estándar reforzado de la Ley N° 21.719 sobre Protección de Datos Personales, cuya entrada en vigencia general está prevista para el 01-12-2026 y que crea la Agencia de Protección de Datos Personales (APDP) como autoridad de control. Para titulares ubicados en la Unión Europea, aplicamos además los principios del Reglamento (UE) 2016/679 (GDPR).',
        'La base legal del tratamiento de datos de trabajadores NO descansa únicamente en el consentimiento del trabajador: por la asimetría de poder propia de la relación laboral, el consentimiento es una base débil para el núcleo del servicio. Las bases legales principales son la ejecución del contrato entre la empresa-cliente y Praeventio, el cumplimiento de una obligación legal del empleador (la normativa de prevención de riesgos y vigilancia de salud ocupacional obliga a la empresa a mantener estos registros) y el interés legítimo en la seguridad y la vida de las personas. El consentimiento se reserva para tratamientos accesorios y opcionales (por ejemplo, sensores activados voluntariamente por el propio usuario).',
      ],
    },
    {
      heading: 'Datos Sensibles (Salud Ocupacional)',
      paragraphs: [
        'Los datos de salud son una categoría especial de datos personales sensibles bajo la Ley 19.628, la Ley 21.719 y el GDPR. Praeventio trata datos de salud ocupacional (exámenes, aptitudes, restricciones) por cuenta de la empresa, con una base legal reforzada anclada en la obligación legal del empleador de mantener la vigilancia de salud que exige la normativa de seguridad y salud en el trabajo, y no en el mero consentimiento.',
        'Estos datos reciben medidas de protección reforzadas: acceso restringido por rol (RBAC), cifrado en tránsito y en reposo, y registro de auditoría de los accesos. Para el tratamiento de esta categoría de datos a escala se contempla la realización de una Evaluación de Impacto en Protección de Datos (EIPD) por parte del responsable, conforme al estándar de la Ley 21.719 y el GDPR. Praeventio aplica el principio ADR 0012: la plataforma presenta información para la decisión del experto, pero NO emite diagnósticos ni calificaciones de origen laboral.',
      ],
    },
    {
      heading: 'Compartición y Encargados Ulteriores',
      intro: 'No vendemos ni comercializamos datos personales. Los datos pueden ser compartidos exclusivamente con los siguientes encargados o sub-encargados de tratamiento:',
      bullets: [
        { term: 'Google Firebase', text: 'almacenamiento, autenticación y notificaciones push.' },
        { term: 'Google Gemini', text: 'procesamiento de consultas de IA. Se envían los textos de las consultas; no se envían datos personales identificables sin base legal.' },
        { term: 'Procesador de pagos', text: 'verificación de compras y emisión de documentos tributarios.' },
        { term: 'Resend', text: 'envío de correos electrónicos de invitación a proyectos.' },
        { term: 'Miembros de su proyecto', text: 'supervisores y administradores pueden ver datos del equipo conforme a los roles RBAC asignados por la empresa.' },
      ],
    },
    {
      heading: 'Transferencia Internacional de Datos',
      paragraphs: [
        'Algunos de nuestros encargados de tratamiento (en particular la infraestructura de Google Firebase y el procesamiento de IA de Google Gemini) operan servidores ubicados fuera de Chile. En consecuencia, sus datos pueden ser tratados o almacenados en jurisdicciones distintas a la chilena.',
        'Estas transferencias internacionales se realizan procurando garantías adecuadas conforme al estándar de la Ley 21.719 y del GDPR (por ejemplo, cláusulas contractuales y compromisos de seguridad de los proveedores). Es responsabilidad del responsable del dato y de la revisión legal final verificar que las garantías de cada transferencia internacional sean suficientes para la categoría de datos involucrada.',
      ],
    },
    {
      heading: 'Retención de Datos',
      paragraphs: [
        'Los datos del proyecto se conservan mientras la cuenta esté activa. Los registros de prevención y salud ocupacional pueden estar sujetos a plazos legales de conservación que la empresa-cliente debe cumplir como responsable, por lo que su supresión se rige por dicha obligación. Los registros de auditoría son inmutables por requisito de la normativa laboral chilena. Cuando proceda la supresión del titular, se prioriza la anonimización que conserva los registros legalmente exigibles sin identificar a la persona.',
      ],
    },
    {
      heading: 'Sus Derechos',
      intro: 'Conforme a la Ley 19.628, la Ley 21.719 y, para titulares en la UE, el GDPR, usted tiene derecho a:',
      bullets: [
        { text: 'Acceder a sus datos personales.' },
        { text: 'Rectificar datos inexactos.' },
        { text: 'Solicitar la supresión de su cuenta y datos asociados, dentro de los límites de las obligaciones legales de conservación.' },
        { text: 'Oponerse al tratamiento de sus datos.' },
        { text: 'Portar sus datos en formato estructurado.' },
      ],
      outro: 'Como Praeventio actúa habitualmente como encargado, las solicitudes pueden requerir la coordinación con la empresa-cliente responsable del dato. Puede ejercer estos derechos a través del canal de privacidad indicado en la sección "Canal de Privacidad y Autoridad de Control".',
    },
    {
      heading: 'Seguridad',
      paragraphs: [
        'Todos los datos se transmiten mediante HTTPS/TLS. El almacenamiento utiliza cifrado en reposo. Las reglas de seguridad aplican el principio de mínimo privilegio: cada usuario solo accede a los datos de sus propios proyectos y según su rol. El procesamiento biométrico es 100% en el dispositivo.',
      ],
    },
    {
      heading: 'Canal de Privacidad y Autoridad de Control',
      paragraphs: [
        'Para ejercer sus derechos o realizar consultas de privacidad, contáctenos a contacto@praeventio.net, indicando en el asunto "Privacidad — Encargado de Protección de Datos" para que su solicitud sea derivada al canal de privacidad y no al de soporte general. Responderemos en los plazos que fije la normativa vigente.',
        'La autoridad de control en Chile será la Agencia de Protección de Datos Personales (APDP), creada por la Ley 21.719. Los titulares en la Unión Europea pueden además dirigirse a la autoridad de control de su Estado miembro conforme al GDPR.',
      ],
    },
    {
      heading: 'Cambios a esta Política',
      paragraphs: [
        'Notificaremos cambios significativos mediante un aviso en la aplicación con anticipación razonable. La fecha de la versión vigente se indica al inicio de este documento y corresponde a la última revisión del texto, no a la fecha en que usted lo consulta.',
      ],
    },
  ],
};
