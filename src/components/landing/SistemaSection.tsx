/**
 * LÁM. 02 · EL SISTEMA — the six vida-crítica features on petroleum ink,
 * unfolding under the Sun Tzu epigraph (victory is won before the battle).
 * Life-safety is free for the worker, forever (ADR 0021); copihue marks life.
 * Consolidates the former Vida + Cómo-funciona sections (2026-07 design):
 * SOS, BLE mesh relay, A*-routed evacuation, RAG on Chilean law, on-device
 * biometrics, and the immutable audit chain — each with its own blueprint.
 */
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  SosCascade,
  MeshPanelOne,
  MeshPanelTwo,
  MeshPanelThree,
  EvacPlan,
  RagPanel,
  BiometricPanel,
  AuditChainPanel,
} from './BlueprintArt';

export function SistemaSection() {
  const { t } = useTranslation();
  const reduced = useReducedMotion();

  const reveal = (delay = 0) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 26 },
          whileInView: { opacity: 1, y: 0 },
          viewport: { once: true, margin: '-60px' },
          transition: { duration: 0.7, delay, ease: 'easeOut' as const },
        };

  const foldAnim = (i: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, rotateX: -14, y: 26 },
          whileInView: { opacity: 1, rotateX: 0, y: 0 },
          viewport: { once: true, margin: '-40px' },
          transition: { duration: 0.7, delay: i * 0.08, ease: [0.2, 0.7, 0.2, 1] as [number, number, number, number] },
        };

  const cards = [
    {
      n: '01',
      svg: <SosCascade labels={[t('landing.vida.sos.step_push'), t('landing.vida.sos.step_email'), t('landing.vida.sos.step_call')]} />,
      title: t('landing.vida.sos.title'),
      desc: t('landing.vida.sos.desc'),
      tag: 'Gratis · siempre',
      life: true,
    },
    {
      n: '02',
      svg: (
        <div className="pv-sys-mesh">
          <MeshPanelOne />
          <MeshPanelTwo />
          <MeshPanelThree />
        </div>
      ),
      title: t('landing.vida.mesh.title'),
      desc: t('landing.vida.mesh.desc'),
      tag: 'Gratis · siempre',
      life: true,
    },
    {
      n: '03',
      svg: <EvacPlan startLabel={t('landing.vida.evac.start_label')} exitLabel={t('landing.vida.evac.exit_label')} />,
      title: t('landing.vida.evac.title'),
      desc: t('landing.vida.evac.desc'),
      tag: 'Gratis · siempre',
      life: true,
    },
    {
      n: '04',
      svg: <RagPanel />,
      title: t('landing.features.ai.title'),
      desc: t('landing.features.ai.desc'),
      tag: 'RAG · ley vigente',
    },
    {
      n: '05',
      svg: <BiometricPanel />,
      title: t('landing.sistema.bio.title'),
      desc: t('landing.sistema.bio.desc'),
      tag: 'Privado por diseño',
    },
    {
      n: '06',
      svg: <AuditChainPanel />,
      title: t('landing.sistema.evidence.title'),
      desc: t('landing.sistema.evidence.desc'),
      tag: 'Auditable · DS 44',
    },
  ];

  return (
    <section id="sistema" className="pv-section pv-on-ink" style={{ paddingTop: 'calc(var(--pv-sp-6) + 2rem)' }}>
      <div className="pv-fold-edge-top" aria-hidden="true" />

      <motion.div {...reveal()} style={{ maxWidth: '60ch', marginBottom: 'var(--pv-sp-5)' }}>
        <span className="pv-kicker" style={{ marginBottom: 'var(--pv-sp-2)', display: 'inline-flex' }}>
          {t('landing.lam.sistema')}
        </span>
        <h2 className="pv-h2" style={{ color: 'var(--pv-paper)' }}>
          {t('landing.sistema.epigraph')}
        </h2>
        <p style={{ marginTop: 'var(--pv-sp-2)', color: 'rgba(244,241,233,0.7)', maxWidth: '58ch' }}>
          {t('landing.sistema.sub')}
        </p>
        <p className="pv-free-badge" style={{ marginTop: 'var(--pv-sp-3)' }}>
          {t('landing.vida.free_badge')}
        </p>
      </motion.div>

      <div className="pv-sys-grid">
        {cards.map((c, i) => (
          <motion.article key={c.n} {...foldAnim(i)} className="pv-sys-card">
            <div className="pv-sys-n">{c.n}</div>
            <div className="pv-sys-svg">{c.svg}</div>
            <h3>{c.title}</h3>
            <p>{c.desc}</p>
            <span className={c.life ? 'pv-sys-tag pv-sys-tag-life' : 'pv-sys-tag'}>{c.tag}</span>
          </motion.article>
        ))}
      </div>

      <div className="pv-fold-edge-bottom" aria-hidden="true" />
    </section>
  );
}
