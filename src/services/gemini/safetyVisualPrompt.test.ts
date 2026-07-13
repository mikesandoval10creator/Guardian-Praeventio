import { describe, it, expect } from 'vitest';
import { buildSafetyVisualPrompt } from './safetyVisualPrompt';

// The prompt IS the accuracy control (B4). These tests pin that the facts a
// safety image must get right are hard-encoded into the prompt, and that a spec
// with no real action produces no prompt (caller returns a typed error instead
// of asking the model to invent a scene).
describe('buildSafetyVisualPrompt — the "pretext" accuracy control', () => {
  it('returns null when there is no real action to depict', () => {
    expect(buildSafetyVisualPrompt({ action: '' })).toBeNull();
    expect(buildSafetyVisualPrompt({ action: '  ' })).toBeNull();
    expect(buildSafetyVisualPrompt({ action: 'x' })).toBeNull(); // too short
  });

  it('pins the required PPE verbatim and forbids omitting or adding PPE', () => {
    const p = buildSafetyVisualPrompt({
      action: 'ponerse el arnés y anclar la línea de vida',
      epp: ['casco', 'arnés', 'guantes'],
    });
    expect(p).toContain('casco, arnés, guantes');
    expect(p).toMatch(/MUST be shown wearing/i);
    expect(p).toMatch(/do NOT add PPE that is not in this list/i);
  });

  it('constrains to ONE action and forbids text / photorealistic faces / graphic injury', () => {
    const p = buildSafetyVisualPrompt({ action: 'inspeccionar el andamio antes de subir' })!;
    expect(p).toMatch(/exactly ONE clear action: inspeccionar el andamio/i);
    expect(p).toMatch(/Do NOT put any text/i);
    expect(p).toMatch(/Do NOT render identifiable real faces/i);
    expect(p).toMatch(/No blood, no graphic injury/i);
  });

  it('injects hazard/industry/title context when provided', () => {
    const p = buildSafetyVisualPrompt({
      action: 'bloquear y etiquetar la fuente de energía',
      title: 'LOTO',
      hazard: 'energía eléctrica residual',
      industry: 'minería',
      kind: 'step',
      stepNumber: 3,
    })!;
    expect(p).toMatch(/PROCEDURE STEP/i);
    expect(p).toContain('step 3');
    expect(p).toContain('LOTO');
    expect(p).toContain('energía eléctrica residual');
    expect(p).toMatch(/minería worksite/i);
    // Hazard is shown controlled, never as an accident.
    expect(p).toMatch(/managed SAFELY, never an accident/i);
  });

  it('drops empty/whitespace PPE entries instead of listing blanks', () => {
    const p = buildSafetyVisualPrompt({ action: 'usar respirador', epp: ['respirador', '', '   '] })!;
    expect(p).toContain('respirador');
    expect(p).not.toContain(', ,');
  });
});
