import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { PRIVACY_CONTENT_ES_CL } from '../services/legal/privacyContent';

/**
 * Página de Política de Privacidad.
 *
 * Renderiza el contenido legal versionado en
 * `src/services/legal/privacyContent.ts` (mismo patrón que `Terms.tsx` con
 * `termsContent.ts`). La fecha de actualización es FIJA y proviene del
 * string-table (`lastUpdatedISO`) — NO se deriva de `new Date()`, que generaría
 * una fecha distinta en cada render (mala práctica legal).
 *
 * NOTA LEGAL: el texto es un BORRADOR pendiente de revisión y certificación por
 * un abogado chileno de protección de datos. No declara conformidad/certificación
 * formal con la Ley 21.719 / GDPR; redacta compromisos y mecanismos.
 */
export function PrivacyPolicy() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const content = PRIVACY_CONTENT_ES_CL;

  // Formato es-CL para la fecha — coincide con el patrón usado en Terms.tsx.
  // Fecha FIJA desde el string-table versionado, no `new Date()`.
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
          {t('common.back', 'Volver')}
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 mb-10">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-emerald-500" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight">{content.title}</h1>
            <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest">{content.subtitle}</p>
          </div>
        </div>

        <p className="text-zinc-400 text-sm mb-8">
          {t('privacy.lastUpdated', 'Última actualización')}: {lastUpdatedFormatted}
        </p>

        <div className="space-y-8 text-zinc-300 text-sm leading-relaxed">
          {content.sections.map((section, idx) => (
            <section key={section.heading}>
              <h2 className="text-white font-black text-lg mb-3">
                {idx + 1}. {section.heading}
              </h2>

              {section.intro && <p className="mb-3">{section.intro}</p>}

              {section.paragraphs?.map((paragraph, pIdx) => (
                <p key={pIdx} className={pIdx > 0 ? 'mt-3' : ''}>
                  {paragraph}
                </p>
              ))}

              {section.bullets && (
                <ul className="space-y-2 list-disc list-inside">
                  {section.bullets.map((bullet, bIdx) => (
                    <li key={bIdx}>
                      {bullet.term && <strong className="text-white">{bullet.term}:</strong>}{' '}
                      {bullet.text}
                    </li>
                  ))}
                </ul>
              )}

              {section.outro && <p className="mt-3">{section.outro}</p>}
            </section>
          ))}

          <section>
            <h2 className="text-white font-black text-lg mb-3">
              {content.sections.length + 1}. {t('privacy.providerData', 'Datos del proveedor')}
            </h2>
            <p>
              {content.legalEntity} · {content.domain} ·
              Contacto: <strong className="text-emerald-400">{content.contactEmail}</strong> ·
              Privacidad (asunto): <strong className="text-white">{content.privacyChannelSubject}</strong>
            </p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-white/5 text-center text-xs text-zinc-600 font-bold uppercase tracking-widest">
          © {new Date().getFullYear()} Guardian Praeventio · Chile · {t('common.allRightsReserved', 'Todos los derechos reservados')}
        </div>

      </div>
    </div>
  );
}

export default PrivacyPolicy;
