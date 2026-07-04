// Praeventio Guard — safety-visual PROMPT builder (B4 "pretext").
//
// The control layer for AI-generated safety imagery. Principle assimilated
// (clean-room) from ArtCraft's thesis — "artists need control; know what the
// image will look like before you generate it" — applied to safety: a poster or
// procedure-step illustration must be ACCURATE (correct PPE, the right single
// action, the real hazard), not a pretty hallucination. So we never prompt the
// image model blind: this pure function PINS the facts (EPP that must be shown,
// the one action, hazard, industry) as hard constraints, and forbids the failure
// modes (wrong/extra PPE, photorealistic faces, embedded text, graphic injury).
// The full "structure-first" scaffold (a posable 3D mannequin as a control
// signal) is a later phase; this prompt-level control is the foundation.
//
// Pure + deterministic (no I/O) so it is unit-tested without a network call.

export type SafetyVisualKind = 'poster' | 'step';

export interface SafetyVisualSpec {
  /** 'poster' (a standalone afiche) or 'step' (one frame of a procedure). */
  kind?: SafetyVisualKind;
  /** The procedure / hazard name for context (e.g. "Trabajo en altura"). */
  title?: string;
  /** The ONE action the image must depict (a PTS step, or the poster's message). */
  action: string;
  /** PPE that MUST be shown, correctly worn (e.g. ["casco","arnés","guantes"]). */
  epp?: string[];
  /** The hazard being controlled (shown managed safely, never as an accident). */
  hazard?: string;
  /** Worksite context (mining / construction / …) for setting fidelity. */
  industry?: string;
  /** Step index, for 'step' kind. */
  stepNumber?: number;
}

const BRAND_TEAL = '#0f7c6e';
const BRAND_GOLD = '#b08733';

/**
 * Build the image-generation prompt. Returns `null` when the spec is too thin
 * to depict a real action (the caller returns a typed error instead of asking
 * the model to invent a scene).
 */
export function buildSafetyVisualPrompt(spec: SafetyVisualSpec): string | null {
  const action = (spec.action ?? '').trim();
  if (action.length < 3) return null;

  const epp = (spec.epp ?? [])
    .filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
    .map((e) => e.trim());
  const kind: SafetyVisualKind = spec.kind === 'step' ? 'step' : 'poster';

  const lines: string[] = [];
  lines.push(
    kind === 'step'
      ? `Occupational-safety PROCEDURE STEP illustration${spec.stepNumber ? ` (step ${spec.stepNumber})` : ''}, flat vector poster style, clean solid background, single clear focal point.`
      : `Occupational-safety POSTER, flat vector style, clean solid background, strong focal hierarchy.`,
  );

  // ── The control: pin the facts so the model cannot invent the wrong setup ──
  lines.push(`Depict exactly ONE clear action: ${action}.`);
  if (spec.title && spec.title.trim()) lines.push(`Context / procedure: ${spec.title.trim()}.`);
  if (spec.hazard && spec.hazard.trim()) {
    lines.push(
      `Hazard being controlled: ${spec.hazard.trim()} — show it being managed SAFELY, never an accident in progress.`,
    );
  }
  if (spec.industry && spec.industry.trim()) {
    lines.push(`Setting: ${spec.industry.trim()} worksite (Chile / LATAM).`);
  }
  if (epp.length > 0) {
    lines.push(
      `The worker MUST be shown wearing this PPE, correctly and visibly: ${epp.join(', ')}. ` +
        `Do NOT omit any of it and do NOT add PPE that is not in this list.`,
    );
  } else {
    lines.push(`Show the worker in appropriate, correctly-worn PPE for the task.`);
  }

  // ── Brand + safety-communication constraints (accuracy over aesthetics) ────
  lines.push(
    `Style: Guardian Praeventio brand — teal/petroleum (${BRAND_TEAL}) with gold (${BRAND_GOLD}) accents ` +
      `on a light background; bold, legible, high-contrast, ISO-7010-inspired safety iconography.`,
  );
  lines.push(
    `Non-photorealistic illustration. Do NOT render identifiable real faces (use generic/abstract features). ` +
      `No blood, no graphic injury. Do NOT put any text, letters or numbers in the image — captions are added ` +
      `by the app, not the model. The accuracy of the depicted action and PPE matters MORE than visual flourish.`,
  );

  return lines.join('\n');
}
