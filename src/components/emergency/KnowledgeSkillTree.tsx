import { useEffect, useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { where } from "firebase/firestore";
import { useFirebase } from "../../contexts/FirebaseContext";
import { useProject } from "../../contexts/ProjectContext";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { apiAuthHeaders } from "../../lib/apiAuth";
import {
  buildKnowledgeSkillTree,
  type KnowledgeSkill,
  type KnowledgeSkillNodeInput,
  type KnowledgeSkillTypedEdge,
} from "../../services/zettelkasten/skillTreeProjection";
import type { LearningCard } from "../../services/spacedRepetition/spacedRepetitionScheduler";

const LEARNING_LABEL: Record<KnowledgeSkill["learningState"], string> = {
  not_started: "Por explorar",
  learning: "En aprendizaje",
  review_due: "Repaso pendiente",
};

/**
 * Read-only project knowledge route. This is guidance only: it never grants,
 * denies, unlocks or blocks emergency, reporting or any safety capability.
 */
export function KnowledgeSkillTree() {
  const { user } = useFirebase();
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id ?? null;
  // This owner-scoped query is the same safe shape used by Training.tsx.
  const { data: learningCards } = useFirestoreCollection<LearningCard>(
    "learning_cards",
    [
      where("workerUid", "==", user?.uid ?? "__none__"),
      where("projectId", "==", projectId ?? "__none__"),
    ],
  );
  const [nodes, setNodes] = useState<KnowledgeSkillNodeInput[]>([]);
  const [edges, setEdges] = useState<KnowledgeSkillTypedEdge[]>([]);

  useEffect(() => {
    if (!projectId) {
      setNodes([]);
      setEdges([]);
      return undefined;
    }
    let cancelled = false;
    setNodes([]);
    setEdges([]);
    void (async () => {
      try {
        const response = await fetch("/api/zettelkasten/edges", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(await apiAuthHeaders()),
          },
          body: JSON.stringify({ projectId }),
        });
        if (!response.ok) return;
        const payload = (await response.json()) as {
          nodes?: KnowledgeSkillNodeInput[];
          edges?: KnowledgeSkillTypedEdge[];
        };
        if (!cancelled) {
          setNodes(Array.isArray(payload.nodes) ? payload.nodes : []);
          setEdges(Array.isArray(payload.edges) ? payload.edges : []);
        }
      } catch {
        // No local fallback: node metadata may include protected worker PII.
        // A failed authorized projection must stay empty rather than query it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const skills = useMemo(
    () =>
      buildKnowledgeSkillTree({
        nodes: (nodes ?? [])
          .filter(
            (node) =>
              typeof node.id === "string" &&
              typeof node.title === "string" &&
              typeof node.description === "string" &&
              Array.isArray(node.connections),
          )
          .map((node) => ({
            id: node.id,
            title: node.title,
            description: node.description,
            connections: node.connections,
          })),
        edges,
        learningCards: (learningCards ?? []).filter(
          (card) =>
            typeof card.id === "string" &&
            typeof card.topic === "string" &&
            typeof card.reviewCount === "number" &&
            typeof card.intervalDays === "number" &&
            typeof card.nextReviewAt === "string",
        ),
        nowIso: new Date().toISOString(),
      }).skills,
    [nodes, edges, learningCards],
  );

  if (skills.length === 0) return null;

  return (
    <section
      className="space-y-3"
      aria-label="Ruta de aprendizaje del proyecto"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">
            Ruta de aprendizaje del proyecto
          </h4>
          <p className="mt-1 text-[10px] text-zinc-500">
            Orientación desde el conocimiento del proyecto. No bloquea ninguna
            acción de seguridad.
          </p>
        </div>
        <span className="shrink-0 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-emerald-400">
          Disponible
        </span>
      </div>
      <div className="space-y-2">
        {skills.map((skill) => (
          <article
            key={skill.nodeId}
            className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3"
          >
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <h5 className="text-xs font-bold text-white">
                    {skill.title}
                  </h5>
                  {skill.isHub && (
                    <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-amber-400">
                      Nodo clave
                    </span>
                  )}
                  {skill.recommended && (
                    <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-blue-300">
                      Conecta un repaso
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[10px] text-zinc-400">
                  {skill.description}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[9px] font-bold text-zinc-500">
                  <span>{LEARNING_LABEL[skill.learningState]}</span>
                  <span>
                    · {skill.connectionCount} conexión
                    {skill.connectionCount === 1 ? "" : "es"}
                  </span>
                  {skill.relationTypes.map((type) => (
                    <span key={type}>· {type}</span>
                  ))}
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
