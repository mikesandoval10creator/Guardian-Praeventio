/**
 * Footer — blueprint title block. Same links as before (historia, equipo,
 * contacto, privacidad), set in mono like the label strip of a plano.
 */
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Globe, Mail, Lock } from 'lucide-react';
import { ShieldMark } from './BlueprintArt';

export function LandingFooter() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const label = { fontSize: '0.62rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--pv-ink-soft)', marginBottom: '0.8rem' } as const;
  const link = { fontSize: 'var(--pv-t--1)', color: 'var(--pv-ink-soft)' } as const;

  return (
    <footer style={{ borderTop: '1px solid var(--pv-line)', padding: 'var(--pv-sp-5) var(--pv-edge) var(--pv-sp-4)' }}>
      <div className="grid md:grid-cols-4" style={{ gap: 'var(--pv-sp-4)', maxWidth: 1200, margin: '0 auto' }}>
        <div>
          <div className="flex items-center" style={{ gap: '0.6rem', marginBottom: '0.8rem' }}>
            <ShieldMark size={20} />
            <span className="pv-mono" style={{ fontSize: 'var(--pv-t--1)', letterSpacing: '0.12em' }}>
              GUARDIAN PRAEVENTIO
            </span>
          </div>
          <p style={{ fontSize: 'var(--pv-t--1)', lineHeight: 1.6, color: 'var(--pv-ink-soft)' }}>{t('landing.footer.tagline')}</p>
        </div>

        <div>
          <p className="pv-mono" style={label}>
            Praeventio
          </p>
          <ul className="list-none p-0 m-0" style={{ display: 'grid', gap: '0.55rem' }}>
            <li>
              <a href="https://www.praeventio.net/historia" target="_blank" rel="noopener noreferrer" className="pv-btn-ghost" style={link}>
                {t('landing.footer.link_history')}
              </a>
            </li>
            <li>
              <a href="https://www.praeventio.net/equipo" target="_blank" rel="noopener noreferrer" className="pv-btn-ghost" style={link}>
                {t('landing.footer.link_team')}
              </a>
            </li>
            <li>
              <a
                href="https://www.praeventio.net"
                target="_blank"
                rel="noopener noreferrer"
                className="pv-btn-ghost inline-flex items-center"
                style={{ ...link, gap: '0.35rem' }}
              >
                <Globe size={12} aria-hidden="true" />
                praeventio.net
              </a>
            </li>
          </ul>
        </div>

        <div>
          <p className="pv-mono" style={label}>
            {t('landing.footer.col_contact')}
          </p>
          <ul className="list-none p-0 m-0" style={{ display: 'grid', gap: '0.55rem' }}>
            <li>
              <a href="mailto:contacto@praeventio.net" className="pv-btn-ghost inline-flex items-center" style={{ ...link, gap: '0.35rem' }}>
                <Mail size={12} aria-hidden="true" />
                contacto@praeventio.net
              </a>
            </li>
            <li style={{ ...link, opacity: 0.8 }}>{t('landing.footer.location')}</li>
          </ul>
        </div>

        <div>
          <p className="pv-mono" style={label}>
            {t('landing.footer.col_legal')}
          </p>
          <ul className="list-none p-0 m-0" style={{ display: 'grid', gap: '0.55rem' }}>
            <li>
              <button type="button" onClick={() => navigate('/privacidad')} className="pv-btn-ghost" style={link}>
                {t('landing.footer.link_privacy')}
              </button>
            </li>
            <li className="inline-flex items-center" style={{ ...link, gap: '0.35rem', opacity: 0.8 }}>
              <Lock size={12} aria-hidden="true" />
              {t('landing.footer.data_secure')}
            </li>
          </ul>
        </div>
      </div>

      <div
        className="flex flex-col sm:flex-row items-center justify-between pv-mono"
        style={{ maxWidth: 1200, margin: 'var(--pv-sp-4) auto 0', paddingTop: 'var(--pv-sp-3)', borderTop: '1px solid var(--pv-line)', gap: '0.6rem', fontSize: '0.62rem', letterSpacing: '0.1em', color: 'var(--pv-ink-soft)' }}
      >
        <span>{t('landing.footer.copyright')}</span>
        <span>{t('landing.footer.made_in')}</span>
      </div>
    </footer>
  );
}
