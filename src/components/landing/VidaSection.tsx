/**
 * LÁM. 01 · VIDA — the heart of the message, set on petroleum ink.
 * The life-safety features are free for the worker, forever (ADR 0021):
 * SOS + man-down, the BLE mesh relay told as three manga panels, and
 * A*-routed evacuation. Copihue red marks life — nothing else.
 */
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { CopihueLine, EvacPlan, MeshPanelOne, MeshPanelTwo, MeshPanelThree, SosCascade } from './BlueprintArt';

export function VidaSection() {
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

  return (
    <section id="vida" className="pv-section pv-on-ink" style={{ paddingTop: 'calc(var(--pv-sp-6) + 2rem)' }}>
      <div className="pv-fold-edge-top" aria-hidden="true" />

      <motion.div {...reveal()} style={{ maxWidth: '58ch', marginBottom: 'var(--pv-sp-5)' }}>
        <span className="pv-kicker" style={{ marginBottom: 'var(--pv-sp-2)', display: 'inline-flex' }}>
          {t('landing.lam.vida')}
        </span>
        <h2 className="pv-h2" style={{ color: 'var(--pv-paper)' }}>
          {t('landing.vida.title_pre')} <span className="pv-ac">{t('landing.vida.title_ac')}</span>
        </h2>
        <p style={{ marginTop: 'var(--pv-sp-2)', color: 'rgba(244,241,233,0.7)', fontSize: 'var(--pv-t-1)', maxWidth: '46ch' }}>
          {t('landing.vida.sub')}
        </p>
        <p className="pv-free-badge" style={{ marginTop: 'var(--pv-sp-3)' }}>
          {t('landing.vida.free_badge')}
        </p>
      </motion.div>

      <div className="grid gap-6 lg:grid-cols-2" style={{ gap: 'var(--pv-sp-3)' }}>
        {/* SOS + hombre-caído */}
        <motion.article {...reveal(0.05)} className="pv-vida-card">
          <h3>{t('landing.vida.sos.title')}</h3>
          <p>{t('landing.vida.sos.desc')}</p>
          <div style={{ margin: 'var(--pv-sp-3) 0 0', maxWidth: 360 }}>
            <SosCascade
              labels={[t('landing.vida.sos.step_push'), t('landing.vida.sos.step_email'), t('landing.vida.sos.step_call')]}
            />
          </div>
          <p className="pv-impact">{t('landing.vida.sos.impact')}</p>
        </motion.article>

        {/* Evacuación A* */}
        <motion.article {...reveal(0.12)} className="pv-vida-card">
          <h3>{t('landing.vida.evac.title')}</h3>
          <p>{t('landing.vida.evac.desc')}</p>
          <div style={{ margin: 'var(--pv-sp-3) 0 0' }}>
            <EvacPlan startLabel={t('landing.vida.evac.start_label')} exitLabel={t('landing.vida.evac.exit_label')} />
          </div>
          <p className="pv-impact">{t('landing.vida.evac.impact')}</p>
        </motion.article>
      </div>

      {/* Red mesh — 3 viñetas manga */}
      <motion.article {...reveal(0.1)} className="pv-vida-card" style={{ marginTop: 'var(--pv-sp-3)' }}>
        <div className="flex flex-wrap items-start justify-between" style={{ gap: 'var(--pv-sp-2)' }}>
          <div style={{ maxWidth: '52ch' }}>
            <h3>{t('landing.vida.mesh.title')}</h3>
            <p>{t('landing.vida.mesh.desc')}</p>
          </div>
          <CopihueLine delay={0.4} />
        </div>
        <div className="pv-manga" style={{ marginTop: 'var(--pv-sp-3)' }}>
          <figure className="pv-panel">
            <MeshPanelOne />
            <figcaption className="pv-panel-caption">01 · {t('landing.vida.mesh.p1')}</figcaption>
          </figure>
          <figure className="pv-panel">
            <MeshPanelTwo />
            <figcaption className="pv-panel-caption">02 · {t('landing.vida.mesh.p2')}</figcaption>
          </figure>
          <figure className="pv-panel">
            <MeshPanelThree />
            <figcaption className="pv-panel-caption">03 · {t('landing.vida.mesh.p3')}</figcaption>
          </figure>
        </div>
        <p className="pv-impact">{t('landing.vida.mesh.impact')}</p>
      </motion.article>

      <div className="pv-fold-edge-bottom" aria-hidden="true" />
    </section>
  );
}
