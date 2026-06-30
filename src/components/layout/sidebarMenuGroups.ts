// SPDX-License-Identifier: MIT
// Praeventio Guard — F1 Navegación (2026-06-22).
//
// El catálogo de navegación se unificó en `src/navigation/navCatalog.ts`
// (10 bloques, fuente única compartida con el carrusel y el buscador).
// Este módulo ahora es un adaptador delgado: re-expone el catálogo con el
// shape `MenuGroup[]` que `Sidebar.tsx` ya consume, preservando la firma
// pública `buildSidebarMenuGroups(t, features, isAdmin)`.

import type { LucideIcon } from 'lucide-react';
import { buildNavCatalog, type TFn, type SubscriptionFeatureGates } from '../../navigation/navCatalog';

export type { TFn, SubscriptionFeatureGates };

export type MenuItem = {
  title: string;
  icon: LucideIcon;
  path: string;
  color: string;
  isBeta?: boolean;
};

export type MenuGroup = {
  title: string;
  icon: LucideIcon;
  items: MenuItem[];
};

/**
 * Construye los grupos del Sidebar derivándolos del catálogo único.
 * Función pura. El render del Sidebar (acordeón un-bloque-abierto) no cambia.
 */
export function buildSidebarMenuGroups(
  t: TFn,
  features: SubscriptionFeatureGates,
  isAdmin: boolean,
): MenuGroup[] {
  return buildNavCatalog(t, features, isAdmin).map((block) => ({
    title: block.title,
    icon: block.icon,
    items: block.items,
  }));
}
