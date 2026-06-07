/**
 * `<ReconciliationDrainSlot />` — wires the SLM offline-session reconciliation
 * into the authenticated app shell.
 *
 * Until this mount, `installReconciliationAutoTrigger` / `runReconciliation`
 * had ZERO callers outside tests: offline AI (SLM) answers captured in
 * IndexedDB (`praeventio-slm/offline_sessions`) never drained into the
 * Zettelkasten, so they were silently lost when the device came back online.
 *
 * Mirrors the `PredictiveSchedulerSlot` pattern in RootLayout: a tiny slot that
 * reads the active project from context and owns a window-scoped background
 * effect. Mounting `<ReconciliationStatusToast />` here surfaces each completed
 * pass to the user (it listens for the trigger's stats event on its own).
 *
 * Audit note: the reconciliation's actual state changes — the ZK node writes —
 * are persisted by the browser `writeNodes` → `POST /api/zettelkasten/nodes`,
 * which stamps the canonical server-side `audit_logs` rows per node. A separate
 * client-written run-summary audit is deliberately NOT added: `audit_logs` is
 * server-only by Firestore rules (a client `create` is a self-fabrication
 * vector — see firestore.rules), and a dedicated `reconciliation_runs`
 * collection would need its own rules + rules-tests. `writeAuditFn` is left
 * unset; the per-node server audit already covers the trail.
 */

import { useEffect } from 'react';
import { useProject } from '../../contexts/ProjectContext';
import { useFirebase } from '../../contexts/FirebaseContext';
import { runReconciliation } from '../../services/slm';
import { installReconciliationAutoTrigger } from '../../services/slm/reconciliationAutoTrigger';
import { ReconciliationStatusToast } from './ReconciliationStatusToast';

export function ReconciliationDrainSlot() {
  const { selectedProject } = useProject();
  const { user } = useFirebase();
  const projectId = selectedProject?.id;
  const uid = user?.uid;

  useEffect(() => {
    // The runner writes nodes under the active project, so both an active
    // project and an authenticated user are required. Re-install only when
    // either identity changes; dispose tears down the window listeners.
    if (!projectId || !uid) return undefined;
    const handle = installReconciliationAutoTrigger({
      projectId,
      runner: runReconciliation,
    });
    return () => handle.dispose();
  }, [projectId, uid]);

  // No active project → no trigger installed and nothing to reconcile, so the
  // toast would never fire. Render nothing.
  if (!projectId) return null;
  return <ReconciliationStatusToast />;
}

export default ReconciliationDrainSlot;
