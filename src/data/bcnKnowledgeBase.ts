export interface BCNLaw {
  id: string;
  title: string;
  description: string;
  content: string;
  tags: string[];
}

export const bcnKnowledgeBase: BCNLaw[] = [
  {
    id: "ley-16744",
    title: "Ley 16.744",
    description: "Establece normas sobre accidentes del trabajo y enfermedades profesionales.",
    content: `La Ley 16.744 declara obligatorio el Seguro Social contra Riesgos de Accidentes del Trabajo y Enfermedades Profesionales.
    - Accidente del trabajo: Toda lesión que una persona sufra a causa o con ocasión del trabajo, y que le produzca incapacidad o muerte.
    - Accidente de trayecto: Los ocurridos en el trayecto directo, de ida o regreso, entre la habitación y el lugar de trabajo.
    - Enfermedad profesional: La causada de una manera directa por el ejercicio de la profesión o el trabajo que realice una persona y que le produzca incapacidad o muerte.
    - Obligaciones del empleador: Implantar las medidas de prevención de riesgos que indique el organismo administrador; proporcionar a sus trabajadores los equipos e implementos de protección necesarios, no pudiendo en caso alguno cobrarles su valor.`,
    tags: ["Accidentes", "Enfermedades Profesionales", "Seguro Social", "Obligaciones"]
  },
  {
    id: "ds-594",
    title: "Decreto Supremo 594",
    description: "Reglamento sobre condiciones sanitarias y ambientales básicas en los lugares de trabajo.",
    content: `El DS 594 establece las condiciones sanitarias y ambientales básicas que deberá cumplir todo lugar de trabajo.
    - Provisión de agua potable: Todo lugar de trabajo deberá contar con agua potable destinada al consumo humano y necesidades básicas de higiene y aseo personal.
    - Servicios higiénicos: Los lugares de trabajo deben contar con servicios higiénicos de uso individual o colectivo, separados por sexo y en cantidad suficiente según el número de trabajadores.
    - Ventilación: Todo lugar de trabajo deberá mantener por medios naturales o artificiales una ventilación que contribuya a proporcionar condiciones ambientales confortables y que no causen molestias o perjudiquen la salud del trabajador.
    - Elementos de Protección Personal (EPP): El empleador deberá proporcionar a sus trabajadores, libres de costo, los elementos de protección personal adecuados al riesgo a cubrir y el adiestramiento necesario para su correcto empleo.
    - Ruido: Se establecen límites máximos permisibles para la exposición ocupacional a ruido.
    - Carga Térmica: Se establecen límites para la exposición a calor y frío extremo.`,
    tags: ["Condiciones Sanitarias", "EPP", "Agua Potable", "Ruido", "Temperatura"]
  },
  {
    id: "ds-40",
    title: "Decreto Supremo 40",
    description: "Reglamento sobre prevención de riesgos profesionales.",
    content: `El DS 40 aprueba el reglamento sobre prevención de riesgos profesionales.
    - Departamento de Prevención de Riesgos: Toda empresa que ocupe a más de 100 trabajadores deberá contar con un Departamento de Prevención de Riesgos Profesionales.
    - Obligación de Informar (ODI): Los empleadores tienen la obligación de informar oportuna y convenientemente a todos sus trabajadores acerca de los riesgos que entrañan sus labores, de las medidas preventivas y de los métodos de trabajo correctos.
    - Reglamento Interno: Las empresas deben mantener al día un Reglamento Interno de Seguridad e Higiene en el Trabajo.`,
    tags: ["Prevención", "ODI", "Departamento de Prevención", "Reglamento Interno"]
  },
  {
    id: "ds-54",
    title: "Decreto Supremo 54",
    description: "Reglamento para la constitución y funcionamiento de los Comités Paritarios de Higiene y Seguridad.",
    content: `El DS 54 regula los Comités Paritarios.
    - Constitución: En toda empresa, faena, sucursal o agencia en que trabajen más de 25 personas se organizarán Comités Paritarios de Higiene y Seguridad.
    - Composición: Estarán compuestos por tres representantes patronales y tres representantes de los trabajadores.
    - Funciones: Asesorar e instruir a los trabajadores para la correcta utilización de los instrumentos de protección; vigilar el cumplimiento, tanto por parte de las empresas como de los trabajadores, de las medidas de prevención, higiene y seguridad; investigar las causas de los accidentes del trabajo y enfermedades profesionales.`,
    tags: ["Comité Paritario", "Participación", "Investigación de Accidentes"]
  },
  {
    id: "ley-20123",
    title: "Ley 20.123",
    description: "Regula el trabajo en régimen de subcontratación, el funcionamiento de las empresas de servicios transitorios y el contrato de trabajo de servicios transitorios.",
    content: `La Ley 20.123 regula la subcontratación.
    - Responsabilidad Solidaria y Subsidiaria: La empresa principal será solidariamente responsable de las obligaciones laborales y previsionales de dar que afecten a los contratistas en favor de los trabajadores de éstos.
    - Protección de la vida y salud: La empresa principal deberá adoptar las medidas necesarias para proteger eficazmente la vida y salud de todos los trabajadores que laboran en su obra, empresa o faena, cualquiera sea su dependencia.
    - Sistema de Gestión de SST: Las empresas principales que contraten o subcontraten obras o servicios, cuando en su conjunto agrupen a más de 50 trabajadores, deberán implementar un Sistema de Gestión de la Seguridad y Salud en el Trabajo.`,
    tags: ["Subcontratación", "Empresa Principal", "Responsabilidad", "SGSST"]
  }
];

export const searchBCN = (query: string): BCNLaw[] => {
  const lowerQuery = query.toLowerCase();
  
  // Simple keyword matching for the prototype
  // In a real app, this would use vector search (RAG) against a vector database
  return bcnKnowledgeBase.filter(law => 
    law.title.toLowerCase().includes(lowerQuery) ||
    law.description.toLowerCase().includes(lowerQuery) ||
    law.content.toLowerCase().includes(lowerQuery) ||
    law.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
  );
};
