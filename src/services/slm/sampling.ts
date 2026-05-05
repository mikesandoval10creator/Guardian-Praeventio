/**
 * Sampling primitives for the on-device SLM generation loop
 * (Brecha B — Sprint 23 Bucket DD).
 *
 * Pure-math module: no ONNX, no fetch, no DOM. Everything here operates
 * on `Float32Array` logits and primitive arrays so the unit tests can
 * exercise every branch without the 600 MB TinyLlama weights.
 *
 * Why a separate module:
 *   - `onnxAdapter.generate()` mixes IO (session.run, tokenizer
 *     decode) with sampling math. Splitting them out means we can
 *     verify the numerically-touchy parts (top-p cumulative cutoff,
 *     repetition penalty sign-flip on negative logits) under a fast,
 *     deterministic harness.
 *   - The same primitives will be re-used by the WebGPU sampler we
 *     plan to ship once `onnxruntime-web@1.26` exposes a tensor view
 *     into GPU buffers. Keeping them runtime-agnostic now avoids
 *     refactor pressure later.
 *
 * Numerical conventions:
 *   - Logits are unnormalized scores; we apply softmax internally
 *     after temperature scaling and top-k/top-p masking.
 *   - "-Infinity" is the canonical mask value — it survives the
 *     `Math.exp` step in softmax as 0 probability.
 *   - Sampling is deterministic when `temperature === 0` (greedy);
 *     stochastic otherwise. Tests cover both paths.
 */

/**
 * Caller-facing sampling configuration.
 *
 * Defaults are tuned for TinyLlama 1.1B Chat — temperature=0.7 is the
 * upstream's recommended setting; topP/topK/repetitionPenalty match the
 * `transformers.js` defaults so we behave like a reasonable HF sampler
 * out of the box.
 */
export interface SamplingConfig {
  /**
   * Softmax temperature. 0 → deterministic argmax; >0 → stochastic.
   * Range clamped to [0, 2] in practice; values >2 produce near-uniform
   * distributions and rarely improve quality.
   */
  temperature?: number;

  /**
   * Nucleus (top-p) cutoff. Keeps the smallest set of tokens whose
   * cumulative probability mass ≥ topP. 1.0 disables. Default 0.9.
   */
  topP?: number;

  /**
   * Top-K cutoff. Keeps the K most-likely tokens before top-p applies.
   * 0 disables. Default 50.
   */
  topK?: number;

  /**
   * Repetition penalty per the CTRL paper (Keskar et al., 2019).
   * 1.0 = no penalty; 1.1 = mild discouragement of repetition; 2.0 =
   * aggressive. Applied to logits before softmax so it interacts cleanly
   * with temperature.
   */
  repetitionPenalty?: number;

  /** Hard token cap for the generation loop. */
  maxTokens: number;

  /**
   * Token IDs that terminate generation when sampled (EOS, BOS, etc.).
   * Empty/undefined → no early stop.
   */
  stopTokens?: number[];

  /**
   * Optional injection of a uniform [0, 1) RNG. Defaults to
   * `Math.random`. Tests pass a seedable RNG to make stochastic
   * sampling reproducible.
   */
  rng?: () => number;
}

/**
 * Greedy decoding: argmax of the logits.
 *
 * Throws on an empty array — there is no "default token" we could pick
 * that wouldn't mask a real bug upstream (e.g. an empty model output).
 */
export function sampleGreedy(logits: Float32Array): number {
  if (logits.length === 0) {
    throw new Error('sampleGreedy: empty logits array.');
  }
  let bestIdx = 0;
  let bestVal = logits[0];
  for (let i = 1; i < logits.length; i++) {
    if (logits[i] > bestVal) {
      bestVal = logits[i];
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Combined temperature → top-K → top-P → multinomial sampler.
 *
 * Order of operations (matches `transformers.js`):
 *   1. Divide logits by temperature.
 *   2. Sort indices by logit DESC.
 *   3. Drop everything past index `topK`.
 *   4. Softmax the survivors.
 *   5. Walk the sorted distribution; cut as soon as the running sum
 *      crosses `topP`.
 *   6. Re-normalize and draw with the configured RNG.
 *
 * Edge cases:
 *   - `temperature === 0` falls through to `sampleGreedy` (so callers
 *     don't need to special-case it themselves).
 *   - `topK === 0` or `topK >= vocab` disables top-K entirely.
 *   - `topP >= 1.0` disables top-P entirely; we still keep the
 *     temperature + top-K masking.
 *   - All-(-Infinity) inputs throw, since softmax would yield NaN.
 */
export function sampleNucleus(logits: Float32Array, config: SamplingConfig): number {
  if (logits.length === 0) {
    throw new Error('sampleNucleus: empty logits array.');
  }

  const temperature = config.temperature ?? 0.7;
  if (temperature <= 0) {
    return sampleGreedy(logits);
  }

  const topK = config.topK && config.topK > 0 ? config.topK : logits.length;
  const topP = config.topP ?? 1.0;
  const rng = config.rng ?? Math.random;

  // 1. Build (idx, scaledLogit) pairs. We allocate fresh so we never
  //    mutate the caller's logits buffer (the generation loop reuses it
  //    across iterations when it slices the last position out of a
  //    multi-position output tensor).
  const indexed = new Array<{ idx: number; logit: number }>(logits.length);
  for (let i = 0; i < logits.length; i++) {
    indexed[i] = { idx: i, logit: logits[i] / temperature };
  }

  // 2. Sort DESC by scaled logit. JS sort is O(n log n); for vocab
  //    ~32k this is ~500k comparisons per token — well under our
  //    per-token budget (~33 ms on the 30 tok/s WebGPU target).
  indexed.sort((a, b) => b.logit - a.logit);

  // 3. Top-K truncate.
  const kept = indexed.slice(0, Math.min(topK, indexed.length));

  // 4. Softmax with the standard max-subtraction stability trick.
  const maxLogit = kept[0].logit;
  if (!Number.isFinite(maxLogit)) {
    throw new Error('sampleNucleus: all logits are -Infinity (no valid token).');
  }
  let denom = 0;
  const probs = new Array<number>(kept.length);
  for (let i = 0; i < kept.length; i++) {
    const p = Math.exp(kept[i].logit - maxLogit);
    probs[i] = p;
    denom += p;
  }
  if (denom === 0) {
    // Defensive — shouldn't happen after the -Infinity guard but a
    // numerical underflow on a long-tail distribution could.
    return kept[0].idx;
  }
  for (let i = 0; i < probs.length; i++) probs[i] /= denom;

  // 5. Top-P cumulative cutoff. We always keep at least one token so a
  //    pathological top-P=0 doesn't deadlock the loop.
  let cumulative = 0;
  let cutoff = probs.length;
  for (let i = 0; i < probs.length; i++) {
    cumulative += probs[i];
    if (cumulative >= topP) {
      cutoff = i + 1;
      break;
    }
  }
  cutoff = Math.max(1, cutoff);

  // 6. Re-normalize the survivors and draw.
  let sum = 0;
  for (let i = 0; i < cutoff; i++) sum += probs[i];
  const r = rng() * sum;
  let acc = 0;
  for (let i = 0; i < cutoff; i++) {
    acc += probs[i];
    if (r < acc) return kept[i].idx;
  }
  // Floating-point fall-through (rng() === 1.0 - epsilon) — return the
  // last survivor rather than NaN.
  return kept[cutoff - 1].idx;
}

/**
 * Apply repetition penalty per Keskar et al. 2019 (CTRL paper),
 * matching the HuggingFace `transformers` implementation:
 *
 *   - For each previously-generated token id, divide its logit by
 *     `penalty` if positive, multiply by `penalty` if negative. The
 *     sign-flip is what makes the penalty work for both positive and
 *     negative logits — naive division would *boost* negative scores.
 *
 * Mutates `logits` in place. Caller controls how many recent tokens to
 * include via `recentTokenIds` — the conventional window is the last
 * ~50 generated tokens (longer windows over-penalize natural language
 * repetition like determiners).
 *
 * No-op when `penalty <= 1` or `recentTokenIds` is empty.
 */
export function applyRepetitionPenalty(
  logits: Float32Array,
  recentTokenIds: number[],
  penalty: number,
): void {
  if (penalty <= 1 || recentTokenIds.length === 0) return;
  // Dedup so we don't penalize the same token id twice in one call —
  // the reference implementation iterates over a Python `set`.
  const seen = new Set<number>();
  for (const id of recentTokenIds) {
    if (id < 0 || id >= logits.length || seen.has(id)) continue;
    seen.add(id);
    const v = logits[id];
    logits[id] = v >= 0 ? v / penalty : v * penalty;
  }
}

/**
 * Mulberry32 — small, fast, deterministic 32-bit RNG. Useful in tests
 * to assert that `sampleNucleus` is reproducible given a fixed seed.
 *
 * Not exposed via `SamplingConfig.rng` directly; tests construct their
 * own RNG and pass it in. Production samples use `Math.random`.
 */
export function makeMulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
