// Praeventio Guard — Bucket CC: revenue-by-tier bar + customers-by-tier pie.
//
// Two small composable charts share this file because they consume the
// same `revenueByTier` slice from `B2dMetrics`. Coloring uses the
// teal/petroleum/gold palette per user preferences (project memory).

import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import type { B2dTier } from '../../services/analytics/b2dMetrics';

export interface RevenueByTierProps {
  /** USD per tier. Zero-valued tiers are filtered out before rendering. */
  revenueByTier: Record<B2dTier, number>;
  /** Optional: customers per tier — drives the pie chart. */
  customersByTier?: Record<B2dTier, number>;
}

const TIER_LABEL: Record<B2dTier, string> = {
  'climate-base': 'Climate Base',
  'climate-pro': 'Climate Pro',
  'hazmat-base': 'Hazmat Base',
  'hazmat-pro': 'Hazmat Pro',
  'normativa-base': 'Normativa Base',
  'normativa-pro': 'Normativa Pro',
  'suite-base': 'Suite Base',
  'suite-pro': 'Suite Pro',
};

// Teal → petroleum → gold gradient, mapped tier-by-tier.
const TIER_COLOR: Record<B2dTier, string> = {
  'climate-base': '#4db6ac',
  'climate-pro': '#2a8a81',
  'hazmat-base': '#1f6f7a',
  'hazmat-pro': '#0f4f5e',
  'normativa-base': '#6b7280',
  'normativa-pro': '#a78bfa',
  'suite-base': '#d4af37',
  'suite-pro': '#b8860b',
};

export function RevenueByTierChart({ revenueByTier, customersByTier }: RevenueByTierProps) {
  const barData = (Object.keys(revenueByTier) as B2dTier[])
    .filter((t) => revenueByTier[t] > 0)
    .map((t) => ({ tier: TIER_LABEL[t], revenue: revenueByTier[t], color: TIER_COLOR[t] }));

  const pieData = customersByTier
    ? (Object.keys(customersByTier) as B2dTier[])
        .filter((t) => (customersByTier[t] ?? 0) > 0)
        .map((t) => ({ tier: TIER_LABEL[t], customers: customersByTier[t], color: TIER_COLOR[t] }))
    : [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="w-full h-64">
        <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">
          Ingresos por tier (USD/mes)
        </h4>
        {barData.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-zinc-500">
            Sin ingresos B2D todavía.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={barData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
              <XAxis dataKey="tier" stroke="#71717a" fontSize={11} />
              <YAxis stroke="#71717a" fontSize={11} />
              <Tooltip formatter={(v: number) => [`$${v.toLocaleString('en-US')}`, 'USD']} />
              <Bar dataKey="revenue">
                {barData.map((entry, i) => (
                  <Cell key={`bar-${i}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {customersByTier && (
        <div className="w-full h-64">
          <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">
            Clientes por tier
          </h4>
          {pieData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-zinc-500">
              Sin clientes activos.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="customers"
                  nameKey="tier"
                  innerRadius={48}
                  outerRadius={80}
                  paddingAngle={2}
                >
                  {pieData.map((entry, i) => (
                    <Cell key={`pie-${i}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
    </div>
  );
}
