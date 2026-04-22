/**
 * Service to interact with the Biblioteca del Congreso Nacional (BCN) API.
 * API Documentation: https://www.leychile.cl/Consulta/api
 */

import { XMLParser } from 'fast-xml-parser';

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
    const response = await fetch(`https://www.leychile.cl/Consulta/obtxml?opt=7&idNorma=${idNorma}`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch law ${idNorma} from BCN`);
    }

    const xmlText = await response.text();
    
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_"
    });
    const xmlDoc = parser.parse(xmlText);
    
    const norma = xmlDoc?.Norma || {};
    const titulo = norma.TituloNorma || "Título Desconocido";
    const fechaPublicacion = norma.FechaPublicacion || "";
    const organismo = norma.Organismo || "";
    
    let textoCompleto = "";
    
    // Recursive function to extract text from Estructura nodes
    const extractText = (node: any) => {
      if (!node) return;
      if (Array.isArray(node)) {
        node.forEach(extractText);
      } else if (typeof node === 'object') {
        if (node.Texto) {
          textoCompleto += node.Texto + "\n\n";
        }
        if (node.Estructura) {
          extractText(node.Estructura);
        }
      }
    };

    if (norma.Estructuras && norma.Estructuras.Estructura) {
      extractText(norma.Estructuras.Estructura);
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
  { id: "28650",   name: "Ley 16.744 (Accidentes del Trabajo y Enfermedades Profesionales)" },
  { id: "14305",   name: "DS 594 (Condiciones Sanitarias y Ambientales Básicas en los Lugares de Trabajo)" },
  { id: "25510",   name: "DS 40 (Prevención de Riesgos Profesionales)" },
  { id: "221064",  name: "DS 132 (Reglamento de Seguridad Minera)" },
  { id: "257601",  name: "DS 76 (Gestión de Seguridad y Salud en el Trabajo para Empresas Contratistas y Subcontratistas)" },
  { id: "254080",  name: "Ley 20.123 (Régimen de Subcontratación Laboral y Empresas de Servicios Transitorios)" },
  { id: "1088802", name: "DS 43 (Almacenamiento de Sustancias Peligrosas)" },
  { id: "1131706", name: "Ley 21.156 (Obligación de Disponer Desfibriladores DEA en Establecimientos)" }
];
