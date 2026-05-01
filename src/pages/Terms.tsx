import { useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText } from 'lucide-react';
import { TERMS_CONTENT_ES_CL } from '../services/legal/termsContent';

/**
 * Página de Términos y Condiciones de Servicio.
 *
 * Renderiza el contenido legal mantenido en `src/services/legal/termsContent.ts`.
 * Mantiene paridad de estilo con `PrivacyPolicy.tsx` para consistencia visual
 * dentro del flujo de listado público (Marketplace / Play Store / web).
 */
export function Terms() {
  const navigate = useNavigate();
  const content = TERMS_CONTENT_ES_CL;

  // Formato es-CL para la fecha — coincide con el patrón usado en PrivacyPolicy.
  const lastUpdatedFormatted = new Date(content.lastUpdatedISO).toLocaleDateString('es-CL', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="min-h-screen bg-zinc-950 text-white font-sans">
      <div className="max-w-3xl mx-auto px-5 sm:px-8 py-12">
        {/* Back */}
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-zinc-400 hover:text-white text-sm font-bold mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 mb-10">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <FileText className="w-5 h-5 text-emerald-500" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight">{content.title}</h1>
            <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest">{content.subtitle}</p>
          </div>
        </div>

        <p className="text-zinc-400 text-sm mb-8">
          Última actualización: {lastUpdatedFormatted}
        </p>

        <div className="space-y-8 text-zinc-300 text-sm leading-relaxed">
          {content.sections.map((section, idx) => (
            <section key={section.heading}>
              <h2 className="text-white font-black text-lg mb-3">
                {idx + 1}. {section.heading}
              </h2>
              {section.paragraphs.map((paragraph, pIdx) => {
                // Si la sección de privacidad menciona el link a /privacy, lo
                // reemplazamos por un anchor real para cumplir con el requisito
                // del Marketplace de tener navegación clara entre documentos.
                if (section.heading === 'Privacidad de datos' && paragraph.includes('/privacy')) {
                  const parts = paragraph.split('/privacy');
                  return (
                    <p key={pIdx} className={pIdx > 0 ? 'mt-3' : ''}>
                      {parts[0]}
                      <a
                        href="/privacy"
                        className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2"
                      >
                        /privacy
                      </a>
                      {parts[1]}
                    </p>
                  );
                }
                return (
                  <p key={pIdx} className={pIdx > 0 ? 'mt-3' : ''}>
                    {paragraph}
                  </p>
                );
              })}
            </section>
          ))}

          <section>
            <h2 className="text-white font-black text-lg mb-3">
              {content.sections.length + 1}. Datos del proveedor
            </h2>
            <p>
              {content.legalEntity} · RUT <strong className="text-white">{content.rut}</strong> ·
              Soporte: <strong className="text-emerald-400">{content.contactEmail}</strong> ·
              Privacidad: <strong className="text-emerald-400">{content.privacyEmail}</strong>
            </p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-white/5 text-center text-xs text-zinc-600 font-bold uppercase tracking-widest">
          © {new Date().getFullYear()} Guardian Praeventio · Chile · Todos los derechos reservados
        </div>
      </div>
    </div>
  );
}

export default Terms;
