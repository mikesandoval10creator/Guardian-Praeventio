// Praeventio Guard — Round 21 B1 Phase 5 split.
//
// Real-time Firestore background triggers, simulated via Firebase Admin
// `onSnapshot` listeners (we don't run in a Cloud Functions environment).
// Two listeners:
//
//   1. New critical incidents (`nodes` where type ∈ {Hallazgo, Incidente,
//      Riesgo} AND severity ∈ {Crítica, Alta}) → FCM multicast to project
//      supervisors/gerentes/prevencionistas + CPHS alert email via Resend.
//   2. RAG ingestion pipeline (`nodes` where type ∈ {normative, pts,
//      protocol, document}) → embed via geminiBackend, store back on the
//      doc, mark `_ragProcessingStatus`.
//
// Pre-extraction lived inside `setupBackgroundTriggers` in server.ts. DI
// shape introduced here so tests can drive the listeners with a fake
// firestore + messaging without booting Firebase Admin or Vite. The
// returned `unsubscribe()` releases both `onSnapshot` subscriptions —
// useful for graceful shutdown (SIGTERM) and for test seam isolation.
//
// IMPORTANT: this module MUST NOT do work at import time. The only
// top-level exports are types and the `setupBackgroundTriggers` function.

import type admin from 'firebase-admin';
import type { Resend } from 'resend';

export interface BackgroundTriggersDeps {
  db: admin.firestore.Firestore;
  messaging: admin.messaging.Messaging;
  resend: Resend;
  /** Firestore admin namespace — needed for FieldValue.serverTimestamp(). */
  firestoreNamespace: typeof admin.firestore;
  /** Optional override for `process.env.RESEND_API_KEY` lookup at trigger time. */
  resendApiKey?: string;
  /** Optional override for `process.env.GEMINI_API_KEY` lookup at trigger time. */
  geminiApiKey?: string;
  /**
   * Optional override of the embedding generator — defaults to dynamic
   * import of `src/services/geminiBackend.js`. Tests inject a stub.
   */
  generateEmbeddingsBatch?: (texts: string[]) => Promise<number[][]>;
}

export interface BackgroundTriggersHandle {
  unsubscribe: () => void;
}

/**
 * Wire up the two real-time listeners and return a handle whose
 * `unsubscribe()` cancels both subscriptions. Safe to call multiple times
 * — each call returns an independent handle.
 */
export function setupBackgroundTriggers(
  deps: BackgroundTriggersDeps,
): BackgroundTriggersHandle {
  const noop = () => {};
  let unsubIncidents: () => void = noop;
  let unsubRag: () => void = noop;

  try {
    const { db, messaging, resend, firestoreNamespace } = deps;
    let isInitialLoadIncidents = true;
    let isInitialLoadRAG = true;

    // Trigger 1: critical incidents → FCM + CPHS email
    unsubIncidents = db
      .collection('nodes')
      .where('type', 'in', ['Hallazgo', 'Incidente', 'Riesgo'])
      .onSnapshot(
        (snapshot) => {
          if (isInitialLoadIncidents) {
            isInitialLoadIncidents = false;
            return;
          }

          snapshot.docChanges().forEach(async (change) => {
            if (change.type !== 'added') return;
            const data = change.doc.data();
            const isCritical =
              data.metadata?.severity === 'Crítica' ||
              data.metadata?.severity === 'Alta';
            if (!isCritical || !data.projectId) return;

            try {
              const membersSnap = await db
                .collection(`projects/${data.projectId}/members`)
                .get();
              const supervisorUids: string[] = [];
              membersSnap.forEach((d) => {
                const role = d.data().role;
                if (
                  role === 'supervisor' ||
                  role === 'gerente' ||
                  role === 'prevencionista'
                ) {
                  supervisorUids.push(d.id);
                }
              });

              if (supervisorUids.length === 0) return;

              const tokenDocs = await Promise.all(
                supervisorUids.map((uid) =>
                  db.collection('users').doc(uid).get(),
                ),
              );
              const tokens = tokenDocs
                .map((d) => d.data()?.fcmToken as string | undefined)
                .filter((t): t is string => !!t);

              if (tokens.length === 0) return;

              await messaging.sendEachForMulticast({
                tokens,
                notification: {
                  title: `⚠️ Incidente ${data.metadata?.severity || 'Crítico'}`,
                  body: `${data.title || 'Nuevo incidente'} — ${data.metadata?.location || 'Ver detalles en la app'}`,
                },
                data: { projectId: data.projectId, nodeId: change.doc.id },
                android: { priority: 'high' },
              });

              const emailRecipients = tokenDocs
                .map((d) => d.data()?.email as string | undefined)
                .filter((e): e is string => !!e && e.includes('@'));
              const resendKey = deps.resendApiKey ?? process.env.RESEND_API_KEY;
              if (emailRecipients.length > 0 && resendKey) {
                const projectSnap = await db
                  .collection('projects')
                  .doc(data.projectId)
                  .get();
                const projectName = projectSnap.data()?.name || 'Proyecto';
                const severity =
                  data.metadata?.severity ||
                  data.metadata?.criticidad ||
                  'Alta';
                const severityColor: Record<string, string> = {
                  Crítica: '#ef4444',
                  Alta: '#f97316',
                  Media: '#eab308',
                  Baja: '#22c55e',
                };
                const color = severityColor[severity] || '#6b7280';
                const date = new Date().toLocaleString('es-CL', {
                  timeZone: 'America/Santiago',
                });
                const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;font-family:sans-serif;background:#f4f4f5"><div style="max-width:600px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)"><div style="background:#09090b;padding:24px 32px"><span style="font-size:20px;font-weight:900;color:#10b981">GUARDIAN</span><span style="font-size:20px;font-weight:900;color:#fff"> PRAEVENTIO</span></div><div style="padding:32px"><div style="display:inline-block;padding:4px 12px;background:${color}20;border:1px solid ${color}40;border-radius:8px;margin-bottom:16px"><span style="font-size:11px;font-weight:700;color:${color};text-transform:uppercase">⚠ Alerta CPHS — ${severity}</span></div><h2 style="margin:0 0 8px;font-size:20px;font-weight:900;color:#09090b">${data.title || 'Nuevo incidente crítico'}</h2><p style="margin:0 0 24px;font-size:14px;color:#71717a;line-height:1.6">${data.description || ''}</p><table style="width:100%;border-collapse:collapse"><tr><td style="padding:10px 0;border-bottom:1px solid #f4f4f5;font-size:12px;color:#a1a1aa;font-weight:700;text-transform:uppercase">Proyecto</td><td style="padding:10px 0;border-bottom:1px solid #f4f4f5;font-size:13px;font-weight:600">${projectName}</td></tr><tr><td style="padding:10px 0;font-size:12px;color:#a1a1aa;font-weight:700;text-transform:uppercase">Detectado</td><td style="padding:10px 0;font-size:13px;font-weight:600">${date}</td></tr></table><p style="margin:24px 0 0;font-size:11px;color:#a1a1aa;text-align:center">Aviso automático generado por Guardian Praeventio para el Comité Paritario.</p></div></div></body></html>`;
                await resend.emails
                  .send({
                    from: 'Praeventio Guard <noreply@praeventio.net>',
                    to: emailRecipients,
                    subject: `[CPHS ${projectName}] Incidente ${severity}: ${data.title || 'Nuevo incidente'}`,
                    html,
                  })
                  .catch((e: unknown) =>
                    console.warn('[TRIGGER: CPHS Email] delivery failed:', e),
                  );
              }
            } catch (err) {
              console.error('[TRIGGER: FCM Push] Error:', err);
            }
          });
        },
        (error) => {
          console.error(
            'Error in incidents background trigger listener:',
            error,
          );
        },
      );

    // Trigger 2: RAG ingestion pipeline
    unsubRag = db
      .collection('nodes')
      .where('type', 'in', ['normative', 'pts', 'protocol', 'document'])
      .onSnapshot(
        async (snapshot) => {
          if (isInitialLoadRAG) {
            isInitialLoadRAG = false;
            return;
          }

          for (const change of snapshot.docChanges()) {
            if (change.type !== 'added' && change.type !== 'modified') continue;
            const data = change.doc.data();

            if (
              data._ragProcessingStatus === 'completed' ||
              data._ragProcessingStatus === 'processing'
            ) {
              continue;
            }

            console.log(
              `[TRIGGER: RAG Pipeline] => Generating embeddings for: ${change.doc.id} (${data.type})`,
            );

            try {
              await change.doc.ref.update({
                _ragProcessingStatus: 'processing',
              });

              const textToEmbed = `Título: ${data.title || ''}\nDescripción: ${data.description || ''}\nContenido: ${data.content || ''}`;

              if (textToEmbed.trim().length < 10) {
                await change.doc.ref.update({
                  _ragProcessingStatus: 'skipped_too_short',
                });
                continue;
              }

              const embedFn =
                deps.generateEmbeddingsBatch ??
                (await loadDefaultEmbedder());
              const [embedding] = await embedFn([textToEmbed]);

              if (embedding && embedding.length > 0) {
                await change.doc.ref.update({
                  embedding,
                  _ragProcessingStatus: 'completed',
                  _ragProcessedAt:
                    firestoreNamespace.FieldValue.serverTimestamp(),
                });
                console.log(
                  `[TRIGGER: RAG Pipeline] ✅ Embeddings successfully saved for ${change.doc.id}`,
                );
              } else {
                throw new Error('Empty embedding returned');
              }
            } catch (error) {
              console.error(
                `[TRIGGER: RAG Pipeline] ❌ Error processing ${change.doc.id}:`,
                error,
              );
              await change.doc.ref.update({
                _ragProcessingStatus: 'failed',
                _ragError:
                  error instanceof Error ? error.message : 'Unknown error',
              });
            }
          }
        },
        (error) => {
          console.error('Error in RAG background trigger listener:', error);
        },
      );
  } catch (err) {
    console.error('Failed to setup background triggers:', err);
  }

  return {
    unsubscribe: () => {
      try {
        unsubIncidents();
      } catch (e) {
        console.warn('[triggers] failed to unsubscribe incidents listener:', e);
      }
      try {
        unsubRag();
      } catch (e) {
        console.warn('[triggers] failed to unsubscribe RAG listener:', e);
      }
    },
  };

  // ── helpers ─────────────────────────────────────────────────────────
  // The default embedder dynamically imports `geminiBackend.js`. Kept as
  // a function so tests can inject `generateEmbeddingsBatch` directly
  // instead of mocking the module loader.
  async function loadDefaultEmbedder(): Promise<
    (texts: string[]) => Promise<number[][]>
  > {
    const mod = await import('../../services/geminiBackend.js');
    return mod.generateEmbeddingsBatch;
  }
}
