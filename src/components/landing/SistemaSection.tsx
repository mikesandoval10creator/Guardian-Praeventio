/**
 * LÁM. 02 · SISTEMA — management on paper. Opens with the pain point
 * (facts dying in spreadsheets/filing cabinets — before/after panel) and
 * unfolds the management features as origami folds under the Sun Tzu
 * epigraph: the victory is won before the battle.
 */
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { FileSpreadsheet, FileText, Mail, Activity, CheckCircle2 } from 'lucide-react';

const FOLDS = [
  { id: 'ai', i18nBase: 'landing.features.ai' },
  { id: 'evidence', i18nBase: 'landing.sistema.evidence' },
  { id: 'iper', i18nBase: 'landing.sistema.iper' },
  { id: 'training', i18nBase: 'landing.features.training' },
  { id: 'iso', i18nBase: 'landing.features.iso' },
  { id: 'teams', i18nBase: 'landing.features.teams' },
  { id: 'dashboard', i18nBase: 'landing.features.dashboard' },
] as const;

const BEFORE_ITEMS = [
  { icon: FileSpreadsheet, id: 'excel' },
  { icon: FileText, id: 'paperwork' },
  { icon: Mail, id: 'email' },
] as const;

export function SistemaSection() {
  const { t } = useTranslation();
  const reduced = useReducedMotion();

  const reveal = (delay = 0) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 28 },
          whileInView: { opacity: 1, y: 0 },
          viewport: { once: true, margin: '-60px' },
          transition: { duration: 0.7, delay, ease: 'easeOut' as const },
        };

  const fold = (i: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, rotateX: -18, y: 24 },
          whileInView: { opacity: 1, rotateX: 0, y: 0 },
          viewport: { once: true, margin: '-40px' },
          transition: { duration: 0.65, delay: i * 0.08, ease: [0.2, 0.7, 0.2, 1] as [number, number, number, number] },
        };

  return (
    <section id="sistema" className="pv-section">
      {/* pain point — hechos que mueren en un archivador */}
      <div className="grid items-center lg:grid-cols-2" style={{ gap: 'var(--pv-sp-4)', marginBottom: 'var(--pv-sp-6)' }}>
        <motion.div {...reveal()}>
          <span className="pv-kicker" style={{ marginBottom: 'var(--pv-sp-2)', display: 'inline-flex' }}>
            {t('landing.lam.sistema')}
          </span>
          <h2 className="pv-h2">
            {t('landing.problem.title')}
          </h2>
          <p style={{ marginTop: 'var(--pv-sp-2)', color: 'var(--pv-ink-soft)', maxWidth: '52ch' }}>{t('landing.problem.body')}</p>
          <p className="pv-mono" style={{ marginTop: 'var(--pv-sp-3)', fontSize: 'var(--pv-t--1)', color: 'var(--pv-teal)', letterSpacing: '0.06em' }}>
            {t('landing.sistema.epigraph')}
          </p>
        </motion.div>

        <motion.div {...reveal(0.1)} className="grid grid-cols-2" style={{ gap: 'var(--pv-sp-2)' }}>
          {/* BEFORE */}
          <div className="pv-notarial" style={{ opacity: 0.72 }}>
            <p className="pv-mono" style={{ fontSize: 'var(--pv-t--1)', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--pv-ink-soft)', marginBottom: 'var(--pv-sp-2)' }}>
              {t('landing.problem.before_label')}
            </p>
            <ul className="list-none p-0 m-0" style={{ display: 'grid', gap: '0.7rem' }}>
              {BEFORE_ITEMS.map((item) => (
                <li key={item.id} className="flex items-center" style={{ gap: '0.6rem', color: 'var(--pv-ink-soft)' }}>
                  <item.icon size={15} aria-hidden="true" />
                  <span className="line-through" style={{ fontSize: 'var(--pv-t--1)', textDecorationColor: 'var(--pv-line)' }}>
                    {t(`landing.problem.before_${item.id}`)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {/* AFTER */}
          <div className="pv-notarial" style={{ borderColor: 'var(--pv-teal)' }}>
            <p className="pv-mono" style={{ fontSize: 'var(--pv-t--1)', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--pv-teal)', marginBottom: 'var(--pv-sp-2)' }}>
              {t('landing.problem.after_label')}
            </p>
            <p className="flex items-center" style={{ gap: '0.5rem', fontWeight: 600, fontSize: 'var(--pv-t--1)' }}>
              <CheckCircle2 size={15} style={{ color: 'var(--pv-teal)' }} aria-hidden="true" />
              {t('landing.problem.realtime')}
            </p>
            <div className="flex items-end" style={{ gap: 3, height: 52, margin: '0.8rem 0' }} aria-hidden="true">
              {[40, 65, 50, 80, 60, 90, 75].map((h, i) => (
                <div key={i} style={{ flex: 1, height: `${h}%`, background: 'var(--pv-teal)', opacity: 0.28 + (i / 7) * 0.7, borderRadius: '1px 1px 0 0' }} />
              ))}
            </div>
            <p className="flex items-center" style={{ gap: '0.5rem', fontSize: 'var(--pv-t--1)', color: 'var(--pv-ink-soft)' }}>
              <Activity size={14} style={{ color: 'var(--pv-teal)' }} aria-hidden="true" />
              {t('landing.problem.ai_patterns')}
            </p>
          </div>
        </motion.div>
      </div>

      {/* section head for the folds */}
      <motion.div {...reveal()} style={{ maxWidth: '58ch', marginBottom: 'var(--pv-sp-4)' }}>
        <h2 className="pv-h2" style={{ fontSize: 'clamp(1.7rem, 3.4vw, var(--pv-t-2))' }}>
          {t('landing.sistema.title_pre')} <span className="pv-ac">{t('landing.sistema.title_ac')}</span>
        </h2>
        <p style={{ marginTop: 'var(--pv-sp-2)', color: 'var(--pv-ink-soft)', maxWidth: '56ch' }}>{t('landing.sistema.sub')}</p>
      </motion.div>

      {/* origami folds */}
      <div className="pv-folds">
        {FOLDS.map((f, i) => (
          <motion.article key={f.id} {...fold(i)} className="pv-fold">
            <div className="pv-fold-n">{String(i + 1).padStart(2, '0')}</div>
            <div>
              <h3>{t(`${f.i18nBase}.title`)}</h3>
              <p>{t(`${f.i18nBase}.desc`)}</p>
            </div>
            <span className="pv-fold-tag">{t(`landing.sistema.tag_${f.id}`)}</span>
          </motion.article>
        ))}
      </div>
    </section>
  );
}
