// Praeventio Guard — Sprint 41 F.22: <LightningTrainingPlayer />
//
// Renderiza un micro-módulo paso a paso con timer, quizzes embebidos y
// pantalla final con score + estado de certificación.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, Award, CheckCircle2, XCircle } from 'lucide-react';
import {
  scoreSession,
  shouldCertify,
  isPassing,
  type MicroTrainingModule,
  type MicroTrainingAnswer,
  type MicroTrainingSession,
} from '../../services/microtraining/lightningTrainingService.js';

interface LightningTrainingPlayerProps {
  module: MicroTrainingModule;
  workerUid: string;
  onComplete?: (session: MicroTrainingSession) => void;
}

export function LightningTrainingPlayer({
  module,
  workerUid,
  onComplete,
}: LightningTrainingPlayerProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<MicroTrainingAnswer[]>([]);
  const [done, setDone] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useMemo(() => Date.now(), []);

  useEffect(() => {
    if (done) return undefined;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [done]);

  const total = module.content.length;
  const block = module.content[step];

  const session: MicroTrainingSession = useMemo(
    () => ({
      workerUid,
      moduleId: module.id,
      startedAt,
      completedAt: done ? Date.now() : undefined,
      answers,
    }),
    [workerUid, module.id, startedAt, done, answers],
  );

  const score = useMemo(
    () => (done ? scoreSession(session, module) : 0),
    [done, session, module],
  );

  const passed = isPassing(score);
  const certified = done && shouldCertify({ ...session, score }, module);

  const handleAnswer = (selectedIndex: number) => {
    const next = answers.filter((a) => a.blockIndex !== step);
    next.push({ blockIndex: step, selectedIndex });
    setAnswers(next);
  };

  const handleNext = () => {
    if (step + 1 < total) {
      setStep(step + 1);
    } else {
      setDone(true);
      const finalSession: MicroTrainingSession = {
        ...session,
        completedAt: Date.now(),
        score: scoreSession(session, module),
      };
      onComplete?.(finalSession);
    }
  };

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  if (done) {
    return (
      <section
        className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
        data-testid="lightning-result"
        aria-label={t('microtraining.resultAria', 'Resultado capacitación') as string}
      >
        <header className="flex items-center gap-2">
          {passed ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-500" aria-hidden="true" />
          ) : (
            <XCircle className="w-5 h-5 text-rose-500" aria-hidden="true" />
          )}
          <h2 className="text-sm font-black uppercase tracking-wide">
            {t('microtraining.resultTitle', 'Resultado')}
          </h2>
        </header>

        <div className="bg-surface-elevated rounded p-3 space-y-2">
          <p className="text-xs">
            {t('microtraining.score', 'Puntaje')}:{' '}
            <span data-testid="lightning-score" className="font-black text-lg">
              {score}
            </span>
            /100
          </p>
          <p className="text-xs" data-testid="lightning-pass-state">
            {passed
              ? t('microtraining.passed', 'Aprobado')
              : t('microtraining.failed', 'No aprobado')}
          </p>
          {certified && (
            <p
              className="text-xs flex items-center gap-1 text-amber-500"
              data-testid="lightning-certified"
            >
              <Award className="w-4 h-4" aria-hidden="true" />
              {t('microtraining.certified', 'Certificación emitida')}
            </p>
          )}
        </div>
      </section>
    );
  }

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="lightning-player"
      aria-label={t('microtraining.playerAria', 'Capacitación relámpago') as string}
    >
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-500" aria-hidden="true" />
          <h2 className="text-sm font-black uppercase tracking-wide">
            {module.title}
          </h2>
        </div>
        <div
          className="text-[10px] font-mono text-secondary-token"
          data-testid="lightning-timer"
          aria-live="polite"
        >
          {mm}:{ss} / ~{module.durationMinutes}:00
        </div>
      </header>

      <div className="text-[10px] uppercase font-bold text-secondary-token">
        {t('microtraining.step', 'Paso')} {step + 1}/{total}
      </div>

      <div
        className="bg-surface-elevated rounded p-3 space-y-2"
        data-testid={`lightning-block-${step}`}
      >
        {block.kind === 'text' && (
          <p className="text-xs" data-testid={`lightning-text-${step}`}>
            {block.payload.body}
          </p>
        )}
        {block.kind === 'image' && (
          <img
            src={block.payload.src}
            alt={block.payload.alt}
            className="rounded max-w-full"
            data-testid={`lightning-image-${step}`}
          />
        )}
        {block.kind === 'quiz' && (
          <div data-testid={`lightning-quiz-${step}`}>
            <p className="text-xs font-bold mb-2">{block.payload.question}</p>
            <ul className="space-y-1">
              {block.payload.options.map((opt, i) => {
                const selected = answers.find(
                  (a) => a.blockIndex === step,
                )?.selectedIndex === i;
                return (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => handleAnswer(i)}
                      data-testid={`lightning-option-${step}-${i}`}
                      className={`w-full text-left px-2 py-1.5 rounded text-xs ${
                        selected
                          ? 'bg-teal-500/20 border border-teal-500'
                          : 'bg-surface hover:bg-surface-elevated border border-default-token'
                      }`}
                    >
                      {opt}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleNext}
          data-testid="lightning-next"
          disabled={
            block.kind === 'quiz' &&
            !answers.find((a) => a.blockIndex === step)
          }
          className="px-3 py-1.5 rounded text-xs font-bold bg-teal-500 text-white disabled:opacity-40"
        >
          {step + 1 < total
            ? t('microtraining.next', 'Siguiente')
            : t('microtraining.finish', 'Finalizar')}
        </button>
      </div>
    </section>
  );
}
