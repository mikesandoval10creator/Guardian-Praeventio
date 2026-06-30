import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  Shield,
  Search,
  Plus,
  Filter,
  Loader2,
  Package,
  CheckCircle2,
  AlertCircle,
  Clock,
  ArrowRight,
  X,
  UserPlus,
  ClipboardCheck
} from 'lucide-react';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { useProject } from '../contexts/ProjectContext';
import { useFirebase } from '../contexts/FirebaseContext';
import { useTenantId } from '../hooks/useTenantId';
import { EPPItem, EPPAssignment, Worker } from '../types';
import { db, serverTimestamp } from '../services/firebase';
import { collection, addDoc, where } from 'firebase/firestore';
import { AssignEPPModal } from '../components/epp/AssignEPPModal';
import { EPPVerificationModal } from '../components/epp/EPPVerificationModal';
import { EppInspectionForm } from '../components/eppFlow/EppInspectionForm';
import { PendingPurchaseOrdersPanel } from '../components/eppFlow/PendingPurchaseOrdersPanel';
import { PurchaseOrderSignModal } from '../components/eppFlow/PurchaseOrderSignModal';
import type { PendingOrder } from '../hooks/useEppFlow';
import type { InventoryItem } from '../services/financialAnalytics/purchaseOrderSuggester';
import { Sparkles } from 'lucide-react';
import { logger } from '../utils/logger';

/** Elevated roles allowed to review + sign suggested purchase orders.
 *  Mirrors the server gate `EPP_SIGN_ROLES` in src/server/routes/eppFlow.ts. */
const EPP_SIGN_ROLES = new Set(['admin', 'prevencionista', 'supervisor']);

/** Page-existing replenish heuristic (mirrors the "to_replenish" stat: stock < 10). */
const REORDER_THRESHOLD = 10;

export function EPP() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const { user, userRole, isAdmin } = useFirebase();
  const { tenantId } = useTenantId();
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('__all__');
  const [isAdding, setIsAdding] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isInspecting, setIsInspecting] = useState(false);
  const [inspectionMsg, setInspectionMsg] = useState<string | null>(null);
  const [orderToSign, setOrderToSign] = useState<PendingOrder | null>(null);
  const [ordersRefreshKey, setOrdersRefreshKey] = useState(0);
  
  const [newItem, setNewItem] = useState({
    name: '',
    category: '',
    description: '',
    imageUrl: '',
    required: false,
    stock: 0
  });

  const { data: eppItems, loading } = useFirestoreCollection<EPPItem>(
    selectedProject ? `projects/${selectedProject.id}/epp_items` : null
  );

  const isWorker = userRole === 'worker' && !isAdmin;

  const { data: eppAssignments } = useFirestoreCollection<EPPAssignment>(
    selectedProject ? `projects/${selectedProject.id}/epp_assignments` : null,
    isWorker && user ? [where('workerId', '==', user.uid)] : []
  );

  const { data: workers } = useFirestoreCollection<Worker>(
    selectedProject ? `projects/${selectedProject.id}/workers` : null
  );

  const categories = ['__all__', ...new Set((eppItems || []).map(item => item.category))];

  const filteredEPP = (eppItems || []).filter(item => {
    const matchesSearch = (item.name || '').toLowerCase().includes(String(searchTerm || '').toLowerCase()) ||
                         (item.description || '').toLowerCase().includes(String(searchTerm || '').toLowerCase());
    const matchesCategory = activeCategory === '__all__' || item.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  // ── EPP inspection wiring (Bloque 4.2) ──────────────────────────────────
  // Derive the inspection inputs from the REAL Firestore EPP catalog. Each
  // catalog row maps id→itemId, category→kind, name→label. Inventory is
  // grouped by category using the real `stock` field; the replenish threshold
  // reuses the page's existing `< 10` heuristic (no fabricated value).
  const inspectionCatalog = useMemo(
    () =>
      (eppItems || []).map((item) => ({
        itemId: item.id,
        kind: item.category || 'general',
        label: item.name,
      })),
    [eppItems],
  );

  const inventoryByKind = useMemo<Record<string, InventoryItem>>(() => {
    const acc: Record<string, InventoryItem> = {};
    for (const item of eppItems || []) {
      const kind = item.category || 'general';
      const prev = acc[kind];
      const stock = item.stock || 0;
      if (prev) {
        prev.currentStock += stock;
      } else {
        acc[kind] = {
          kind,
          currentStock: stock,
          reorderThreshold: REORDER_THRESHOLD,
          // No real consumption-history source → 0 (honest). Only affects the
          // optional purchase-order coverage sizing, not the inspection record.
          expectedConsumptionPerMonth: 0,
        };
      }
    }
    return acc;
  }, [eppItems]);

  // The worker being inspected is the logged-in user (worker self-report) or,
  // for an admin without a worker identity, still recorded against their uid.
  const workerUid = user?.uid ?? '';
  const canInspect =
    Boolean(selectedProject) &&
    Boolean(tenantId) &&
    Boolean(workerUid) &&
    inspectionCatalog.length > 0;

  // Only elevated roles see the suggested purchase-order signing surface. The
  // server enforces this too (403 forbidden_role), so this is UX-only gating
  // that mirrors EPP_SIGN_ROLES.
  const canSignOrders =
    Boolean(selectedProject) &&
    Boolean(tenantId) &&
    (isAdmin || EPP_SIGN_ROLES.has(userRole));

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject) return;

    try {
      await addDoc(collection(db, `projects/${selectedProject.id}/epp_items`), {
        ...newItem,
        projectId: selectedProject.id,
        createdAt: serverTimestamp()
      });
      setIsAdding(false);
      setNewItem({ name: '', category: '', description: '', imageUrl: '', required: false, stock: 0 });
    } catch (error) {
      logger.error('Error adding EPP item:', error);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8 w-full overflow-hidden box-border">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-primary-token uppercase tracking-tighter leading-tight">{t('epp.title')}</h1>
          <p className="text-[10px] sm:text-xs font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            {t('epp.subtitle')}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2 sm:gap-3">
          <div className="bg-elevated border border-zinc-200 dark:border-white/10 rounded-xl sm:rounded-2xl px-3 sm:px-4 py-2 flex items-center justify-between sm:justify-start gap-3 w-full sm:w-auto shadow-sm">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-md sm:rounded-lg bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center border border-emerald-100 dark:border-emerald-500/20 shrink-0">
                <Package className="w-3 h-3 sm:w-4 sm:h-4 text-emerald-600 dark:text-emerald-500" />
              </div>
              <div>
                <p className="text-[9px] sm:text-[10px] font-black text-zinc-500 uppercase tracking-widest leading-tight">{t('epp.total_items')}</p>
                <p className="text-xs sm:text-sm font-bold text-primary-token mt-0.5">{eppItems?.length || 0}</p>
              </div>
            </div>
          </div>
          <button
            onClick={() => setIsInspecting((v) => !v)}
            disabled={!canInspect}
            data-testid="epp-inspect-toggle"
            aria-expanded={isInspecting}
            className="bg-teal-600 text-white px-4 py-3 sm:py-3 rounded-xl sm:rounded-2xl text-[10px] sm:text-xs font-black uppercase tracking-widest hover:bg-teal-700 transition-all shadow-xl shadow-teal-500/20 flex items-center justify-center gap-2 border border-teal-400/20 w-full sm:w-auto disabled:opacity-50"
          >
            <ClipboardCheck className="w-4 h-4" />
            <span>{t('epp.inspect')}</span>
          </button>
          <button
            onClick={() => setIsVerifying(true)}
            className="bg-gradient-to-r from-emerald-500 to-teal-500 dark:from-emerald-600 dark:to-teal-600 text-white px-4 py-3 sm:py-3 rounded-xl sm:rounded-2xl text-[10px] sm:text-xs font-black uppercase tracking-widest hover:from-emerald-600 hover:to-teal-600 dark:hover:from-emerald-500 dark:hover:to-teal-500 transition-all shadow-xl shadow-emerald-500/20 flex items-center justify-center gap-2 border border-emerald-400/20 w-full sm:w-auto"
          >
            <Sparkles className="w-4 h-4" />
            <span>{t('epp.verify_ai')}</span>
          </button>
          <div className="flex gap-2 w-full sm:w-auto">
            <button 
              onClick={() => setIsAssigning(true)}
              className="bg-zinc-100 dark:bg-zinc-800 text-primary-token px-4 py-3 sm:py-3 rounded-xl sm:rounded-2xl text-[10px] sm:text-xs font-black uppercase tracking-widest hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all shadow-sm flex items-center justify-center gap-2 border border-zinc-200 dark:border-white/10 flex-1 sm:flex-none"
            >
              <UserPlus className="w-4 h-4" />
              <span>{t('epp.assign_epp')}</span>
            </button>
            <button 
              onClick={() => setIsAdding(true)}
              className="bg-zinc-900 dark:bg-white text-white dark:text-black px-4 py-3 sm:py-3 rounded-xl sm:rounded-2xl text-[10px] sm:text-xs font-black uppercase tracking-widest hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all shadow-xl shadow-zinc-900/20 dark:shadow-white/5 flex items-center justify-center gap-2 flex-1 sm:flex-none"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">{t('epp.add_to_catalog')}</span>
              <span className="sm:hidden">{t('epp.add')}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        {[
          { label: t('epp.in_stock'), value: (eppItems || []).reduce((acc, item) => acc + (item.stock || 0), 0).toString(), icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
          { label: t('epp.to_replenish'), value: (eppItems || []).filter(item => (item.stock || 0) < 10).length.toString(), icon: AlertCircle, color: 'text-amber-500', bg: 'bg-amber-500/10' },
          { label: t('epp.expirations'), value: (eppAssignments || []).filter(a => a.status === 'active' && a.expiresAt && new Date(a.expiresAt) < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)).length.toString(), icon: Clock, color: 'text-red-500', bg: 'bg-red-500/10' },
          { label: t('epp.assigned'), value: (eppAssignments || []).filter(a => a.status === 'active').length.toString(), icon: Shield, color: 'text-blue-500', bg: 'bg-blue-500/10' },
        ].map((stat, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-elevated border border-zinc-200 dark:border-white/5 rounded-2xl sm:rounded-3xl p-4 sm:p-6 flex items-center gap-3 sm:gap-4 group hover:border-zinc-300 dark:hover:border-white/10 transition-all shadow-sm"
          >
            <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl ${stat.bg} flex items-center justify-center border border-white/5 shrink-0`}>
              <stat.icon className={`w-5 h-5 sm:w-6 sm:h-6 ${stat.color}`} />
            </div>
            <div>
              <p className="text-[9px] sm:text-[10px] font-black text-zinc-500 uppercase tracking-widest leading-tight">{stat.label}</p>
              <p className="text-lg sm:text-xl font-black text-primary-token tracking-tight mt-0.5">{stat.value}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* EPP Inspection (Bloque 4.2) — worker reports OK/warning/failed per item;
          persists a real ZK inspection record + inventory adjustment via the
          eppFlow router. No supplier-cost catalog exists as real data, so the
          optional purchase-order suggestion is intentionally absent (not faked). */}
      {inspectionMsg && (
        <div
          role="status"
          data-testid="epp-inspection-result"
          className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-xs font-bold text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-100"
        >
          {inspectionMsg}
        </div>
      )}
      <AnimatePresence>
        {isInspecting && canInspect && selectedProject && tenantId && (
          <motion.section
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            data-testid="epp-inspection-section"
            className="overflow-hidden"
          >
            <EppInspectionForm
              projectId={selectedProject.id}
              tenantId={tenantId}
              workerUid={workerUid}
              reportedByUid={workerUid}
              catalog={inspectionCatalog}
              inventoryByKind={inventoryByKind}
              supplierCatalog={[]}
              leadTimeDaysBySupplier={{}}
              onSubmitted={(result) => {
                setInspectionMsg(
                  result.suggestedOrder
                    ? t('epp.inspect_submitted_with_order', 'Inspección registrada. Se sugirió una orden de compra para revisión.')
                    : t('epp.inspect_submitted', 'Inspección registrada correctamente.'),
                );
                setIsInspecting(false);
              }}
              onError={(msg) => setInspectionMsg(msg)}
            />
          </motion.section>
        )}
      </AnimatePresence>

      {/* Pending purchase orders (Bloque 4.2) — admins/prevencionistas review +
          sign suggested OC. Real data: the server reads the persisted ZK
          `purchase-order-suggested` nodes (cross-process), honest empty-state
          when there are none. NOT tier-gated (procurement is management, but
          the panel is read+sign for elevated roles only). */}
      {canSignOrders && selectedProject && tenantId && (
        <PendingPurchaseOrdersPanel
          key={`${selectedProject.id}:${ordersRefreshKey}`}
          projectId={selectedProject.id}
          onReviewOrder={(order) => setOrderToSign(order)}
        />
      )}

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-3 sm:gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            placeholder={t('epp.search_placeholder')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-elevated border border-zinc-200 dark:border-white/10 rounded-xl sm:rounded-2xl py-3 sm:py-4 pl-10 sm:pl-12 pr-4 text-xs sm:text-sm text-primary-token focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all shadow-sm"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2 md:pb-0">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-4 sm:px-6 py-3 sm:py-4 rounded-xl sm:rounded-2xl text-[10px] sm:text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap border ${
                activeCategory === cat 
                  ? 'bg-emerald-500 text-white border-emerald-500 shadow-lg shadow-emerald-500/20' 
                  : 'bg-elevated text-zinc-500 border-zinc-200 dark:border-white/5 hover:border-zinc-300 dark:hover:border-white/10 hover:text-zinc-900 dark:hover:text-white shadow-sm'
              }`}
            >
              {cat === '__all__' ? t('epp.all') : cat}
            </button>
          ))}
        </div>
      </div>

      {/* Catalog Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
        {filteredEPP.map((item, index) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: index * 0.05 }}
            className="bg-elevated border border-zinc-200 dark:border-white/5 rounded-3xl sm:rounded-[2.5rem] p-4 sm:p-6 group hover:border-emerald-500/30 transition-all relative overflow-hidden flex flex-col shadow-sm"
          >
            <div className="absolute top-0 right-0 p-4 sm:p-6">
              <div className={`w-2 h-2 rounded-full ${item.required ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-zinc-300 dark:bg-zinc-700'}`} />
            </div>

            <div className="aspect-square rounded-2xl sm:rounded-3xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/5 mb-4 sm:mb-6 flex items-center justify-center overflow-hidden group-hover:scale-105 transition-transform duration-500">
              <img 
                src={item.imageUrl || undefined} 
                alt={item.name}
                className="w-3/4 h-3/4 object-contain opacity-80 group-hover:opacity-100 transition-opacity"
                referrerPolicy="no-referrer"
              />
            </div>

            <div className="space-y-2 sm:space-y-3 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[9px] sm:text-[10px] font-black text-emerald-600 dark:text-emerald-500 uppercase tracking-widest bg-emerald-50 dark:bg-emerald-500/10 px-2 py-1 rounded-md border border-emerald-100 dark:border-emerald-500/20">
                  {item.category}
                </span>
              </div>
              <h3 className="text-base sm:text-lg font-black text-primary-token uppercase tracking-tight leading-tight">
                {item.name}
              </h3>
              <p className="text-xs sm:text-sm text-zinc-500 line-clamp-2 leading-relaxed">
                {item.description}
              </p>
            </div>

            <div className="mt-4 sm:mt-6 pt-4 sm:pt-6 border-t border-zinc-200 dark:border-white/5 flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-[9px] sm:text-[10px] font-black text-zinc-500 dark:text-zinc-600 uppercase tracking-widest">{t('epp.stock_available')}</span>
                <span className="text-xs sm:text-sm font-bold text-primary-token mt-0.5">{item.stock || 0} {t('epp.units_short')}</span>
              </div>
              <button className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-emerald-500 transition-all group/btn">
                <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5 group-hover/btn:translate-x-1 transition-transform" />
              </button>
            </div>
          </motion.div>
        ))}
      </div>

      {filteredEPP.length === 0 && !loading && (
        <div className="text-center py-12 sm:py-20 bg-zinc-50 dark:bg-zinc-900/20 rounded-3xl sm:rounded-[3rem] border border-dashed border-zinc-200 dark:border-white/5 px-4">
          <Shield className="w-12 h-12 sm:w-16 sm:h-16 text-zinc-300 dark:text-zinc-800 mx-auto mb-4 sm:mb-6" />
          <h3 className="text-lg sm:text-xl font-black text-primary-token uppercase tracking-tight">{t('epp.empty_title')}</h3>
          <p className="text-zinc-500 text-xs sm:text-sm mt-2 uppercase tracking-widest font-bold">{t('epp.empty_subtitle')}</p>
        </div>
      )}

      {/* Add EPP Modal */}
      <AnimatePresence>
        {isAdding && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-surface border border-zinc-200 dark:border-white/10 rounded-3xl p-6 w-full max-w-md relative max-h-[90vh] overflow-y-auto custom-scrollbar shadow-2xl"
            >
              <button
                onClick={() => setIsAdding(false)}
                className="absolute top-4 right-4 text-muted-token hover:text-zinc-900 dark:hover:text-white transition-colors"
              >
                <X className="w-6 h-6" />
              </button>

              <h2 className="text-2xl font-black text-primary-token uppercase tracking-tight mb-6">{t('epp.add_modal_title')}</h2>

              <form onSubmit={handleAddItem} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-muted-token uppercase tracking-widest mb-2">{t('epp.field_name')}</label>
                  <input
                    type="text"
                    required
                    value={newItem.name}
                    onChange={e => setNewItem({ ...newItem, name: e.target.value })}
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-white/5 rounded-xl px-4 py-3 text-primary-token focus:outline-none focus:ring-2 focus:ring-emerald-500/50 shadow-sm"
                    placeholder={t('epp.placeholder_name')}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-muted-token uppercase tracking-widest mb-2">{t('epp.field_category')}</label>
                  <input
                    type="text"
                    required
                    value={newItem.category}
                    onChange={e => setNewItem({ ...newItem, category: e.target.value })}
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-white/5 rounded-xl px-4 py-3 text-primary-token focus:outline-none focus:ring-2 focus:ring-emerald-500/50 shadow-sm"
                    placeholder={t('epp.placeholder_category')}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-muted-token uppercase tracking-widest mb-2">{t('epp.field_description')}</label>
                  <textarea
                    required
                    value={newItem.description}
                    onChange={e => setNewItem({ ...newItem, description: e.target.value })}
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-white/5 rounded-xl px-4 py-3 text-primary-token focus:outline-none focus:ring-2 focus:ring-emerald-500/50 resize-none h-24 shadow-sm"
                    placeholder={t('epp.placeholder_description')}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-muted-token uppercase tracking-widest mb-2">{t('epp.field_initial_stock')}</label>
                    <input
                      type="number"
                      required
                      min="0"
                      value={newItem.stock}
                      onChange={e => setNewItem({ ...newItem, stock: parseInt(e.target.value) || 0 })}
                      className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-white/5 rounded-xl px-4 py-3 text-primary-token focus:outline-none focus:ring-2 focus:ring-emerald-500/50 shadow-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-muted-token uppercase tracking-widest mb-2">{t('epp.field_image_url')}</label>
                    <input
                      type="url"
                      value={newItem.imageUrl}
                      onChange={e => setNewItem({ ...newItem, imageUrl: e.target.value })}
                      className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-white/5 rounded-xl px-4 py-3 text-primary-token focus:outline-none focus:ring-2 focus:ring-emerald-500/50 shadow-sm"
                      placeholder="https://..."
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <input
                    type="checkbox"
                    id="required"
                    checked={newItem.required}
                    onChange={e => setNewItem({ ...newItem, required: e.target.checked })}
                    className="w-5 h-5 rounded border-zinc-300 dark:border-white/10 bg-zinc-50 dark:bg-zinc-800 text-emerald-500 focus:ring-emerald-500/50 focus:ring-offset-white dark:focus:ring-offset-zinc-900"
                  />
                  <label htmlFor="required" className="text-sm font-bold text-primary-token">
                    {t('epp.required')}
                  </label>
                </div>

                <button
                  type="submit"
                  className="w-full bg-emerald-500 text-white font-black uppercase tracking-widest py-4 rounded-xl hover:bg-emerald-600 transition-colors mt-6 shadow-lg shadow-emerald-500/20"
                >
                  {t('epp.save_item')}
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AssignEPPModal
        isOpen={isAssigning}
        onClose={() => setIsAssigning(false)}
        projectId={selectedProject?.id}
        eppItems={eppItems || []}
        workers={workers || []}
      />
      <EPPVerificationModal
        isOpen={isVerifying}
        onClose={() => setIsVerifying(false)}
        workers={workers || []}
        eppItems={eppItems || []}
      />

      {/* Purchase-order sign modal (Bloque 4.2) — biometric WebAuthn signature,
          never auto-pushes to the supplier (Ley 19.799). */}
      {orderToSign && selectedProject && tenantId && workerUid && (
        <PurchaseOrderSignModal
          open={Boolean(orderToSign)}
          projectId={selectedProject.id}
          tenantId={tenantId}
          order={orderToSign}
          adminUid={workerUid}
          adminName={user?.displayName ?? undefined}
          onClose={() => setOrderToSign(null)}
          onSigned={() => {
            setOrderToSign(null);
            // Force the panel to re-fetch so the signed order drops off the list.
            setOrdersRefreshKey((k) => k + 1);
          }}
          onError={(msg) => setInspectionMsg(msg)}
        />
      )}
    </div>
  );
}
