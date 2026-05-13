// Praeventio Guard — Sprint 41 F.6: UI mínima para inspección offline-first.
//
// Componente puro y autocontenido: recibe un InspectionTemplate + session
// inicial controlada por el caller (que persiste en IndexedDB) y emite
// cambios vía callbacks. No depende de hooks de contexto pesados.

import React from 'react';
import type {
  InspectionItem,
  InspectionSession,
  InspectionTemplate,
} from '../../services/inspections/offlineInspectionService';

export interface OfflineInspectionFormProps {
  template: InspectionTemplate;
  session: InspectionSession;
  isOnline: boolean;
  onRecord: (
    itemId: string,
    response: boolean | string | number | undefined,
    extras?: { notes?: string },
  ) => void;
  onSubmit: () => void;
  disabled?: boolean;
}

function answeredCount(session: InspectionSession, template: InspectionTemplate): number {
  const byId = new Map(session.observations.map((o) => [o.itemId, o]));
  let n = 0;
  for (const item of template.items) {
    const obs = byId.get(item.id);
    if (!obs) continue;
    if (item.kind === 'photo') {
      if (obs.photoBlob || obs.photoStoragePath) n += 1;
      continue;
    }
    if (obs.response !== undefined && obs.response !== '') n += 1;
  }
  return n;
}

function ItemInput({
  item,
  value,
  onChange,
}: {
  item: InspectionItem;
  value: boolean | string | number | undefined;
  onChange: (v: boolean | string | number | undefined) => void;
}) {
  switch (item.kind) {
    case 'yes_no':
      return (
        <div role="group" aria-label={item.label} className="flex gap-2">
          <button
            type="button"
            aria-pressed={value === true}
            onClick={() => onChange(true)}
            className="px-3 py-1 rounded border"
          >
            Sí
          </button>
          <button
            type="button"
            aria-pressed={value === false}
            onClick={() => onChange(false)}
            className="px-3 py-1 rounded border"
          >
            No
          </button>
        </div>
      );
    case 'rating':
      return (
        <input
          type="number"
          min={1}
          max={5}
          aria-label={item.label}
          value={typeof value === 'number' ? value : ''}
          onChange={(e) => {
            const n = Number(e.target.value);
            onChange(Number.isFinite(n) && n > 0 ? n : undefined);
          }}
          className="w-16 px-2 py-1 rounded border"
        />
      );
    case 'text':
      return (
        <input
          type="text"
          aria-label={item.label}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-2 py-1 rounded border"
        />
      );
    case 'photo':
      return (
        <span className="text-sm opacity-70" aria-label={`${item.label} (foto)`}>
          Captura foto (gestionado por caller)
        </span>
      );
    default:
      return null;
  }
}

export function OfflineInspectionForm({
  template,
  session,
  isOnline,
  onRecord,
  onSubmit,
  disabled,
}: OfflineInspectionFormProps) {
  const total = template.items.filter((i) => i.required !== false).length;
  const answered = answeredCount(session, template);
  const obsById = new Map(session.observations.map((o) => [o.itemId, o]));

  return (
    <section
      data-testid="offline-inspection-form"
      aria-label={`Inspección: ${template.title}`}
      className="flex flex-col gap-3"
    >
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{template.title}</h2>
        <div
          data-testid="online-status"
          className={`text-xs px-2 py-1 rounded ${
            isOnline ? 'bg-emerald-700/30 text-emerald-100' : 'bg-amber-700/30 text-amber-100'
          }`}
        >
          {isOnline ? 'En línea' : 'Sin señal — modo offline'}
        </div>
      </header>

      <div data-testid="answered-counter" className="text-sm opacity-80">
        Respondidas: {answered} / {total}
      </div>

      <ul className="flex flex-col gap-3">
        {template.items.map((item) => {
          const obs = obsById.get(item.id);
          return (
            <li key={item.id} className="flex flex-col gap-1">
              <label className="text-sm font-medium">
                {item.label}
                {item.required === false ? (
                  <span className="ml-1 text-xs opacity-60">(opcional)</span>
                ) : null}
              </label>
              <ItemInput
                item={item}
                value={obs?.response}
                onChange={(v) => onRecord(item.id, v)}
              />
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={onSubmit}
        disabled={disabled || answered < total}
        data-testid="submit-inspection"
        className="self-start px-4 py-2 rounded bg-teal-600 text-white disabled:opacity-50"
      >
        {isOnline ? 'Enviar inspección' : 'Guardar localmente'}
      </button>
    </section>
  );
}

export default OfflineInspectionForm;
