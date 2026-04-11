/**
 * Service to interact with the Biblioteca del Congreso Nacional (BCN) API.
 * API Documentation: https://www.leychile.cl/Consulta/api
 */

export interface BCNLaw {
  idNorma: string;
  titulo: string;
  fechaPublicacion: string;
  organismo: string;
  texto: string; // The parsed text of the law
}

/**
 * Fetches a law from the BCN API by its ID (idNorma).
 * Example: Ley 16744 is idNorma 28650. DS 594 is idNorma 14305.
 */
export const fetchLawFromBCN = async (idNorma: string): Promise<BCNLaw | null> => {
  try {
    // Note: In a real production app, you might need a proxy to bypass CORS issues
    // if calling directly from the browser, or call this from a backend Cloud Function.
    const response = await fetch(`https://www.leychile.cl/Consulta/obtxml?opt=7&idNorma=${idNorma}`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch law ${idNorma} from BCN`);
    }

    const xmlText = await response.text();
    
    // Basic XML parsing (in a real app, use a robust XML parser like fast-xml-parser)
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, "text/xml");
    
    const titulo = xmlDoc.getElementsByTagName("TituloNorma")[0]?.textContent || "Título Desconocido";
    const fechaPublicacion = xmlDoc.getElementsByTagName("FechaPublicacion")[0]?.textContent || "";
    const organismo = xmlDoc.getElementsByTagName("Organismo")[0]?.textContent || "";
    
    // Extracting the main text (this is a simplified extraction)
    const estructuras = xmlDoc.getElementsByTagName("Estructura");
    let textoCompleto = "";
    for (let i = 0; i < estructuras.length; i++) {
      const textoNode = estructuras[i].getElementsByTagName("Texto")[0];
      if (textoNode && textoNode.textContent) {
        textoCompleto += textoNode.textContent + "\\n\\n";
      }
    }

    return {
      idNorma,
      titulo,
      fechaPublicacion,
      organismo,
      texto: textoCompleto.trim() || "Texto no disponible en este formato."
    };
  } catch (error) {
    console.error("Error fetching from BCN:", error);
    return null;
  }
};

/**
 * Pre-defined list of critical safety laws for Praeventio Guard.
 */
export const CRITICAL_LAWS = [
  { id: "28650", name: "Ley 16.744 (Accidentes del Trabajo)" },
  { id: "14305", name: "DS 594 (Condiciones Sanitarias y Ambientales)" },
  { id: "25510", name: "DS 40 (Prevención de Riesgos Profesionales)" }
];
