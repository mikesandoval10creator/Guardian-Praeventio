// Praeventio Guard — Bucket CC: MRR-over-time chart for the B2D admin panel.
//
// Renders a 12-month MRR line. Caller passes precomputed datapoints; this
// component is intentionally dumb so the page (or a later metrics
// endpoint) owns the data shape.

import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

export interface MrrPoint {
  /** Short label like "May 26", "Jun 26" — already localised. */
  monthLabel: string;
  /** USD MRR for that month. */
  mrr: number;
}

export interface MrrChartProps {
  data: MrrPoint[];
}

export function MrrChart({ data }: MrrChartProps) {
  if (!data.length) {
    return (
      <div className="h-64 flex items-center justify-center text-sm text-zinc-500">
        Sin datos de MRR todavía.
      </div>
    );
  }
  return (
    <div className="w-full h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
          <XAxis dataKey="monthLabel" stroke="#71717a" fontSize={12} />
          <YAxis stroke="#71717a" fontSize={12} />
          <Tooltip
            formatter={(v: number) => [`$${v.toLocaleString('en-US')} USD`, 'MRR']}
          />
          <Line
            type="monotone"
            dataKey="mrr"
            stroke="#4db6ac"
            strokeWidth={2}
            dot={{ r: 3, fill: '#4db6ac' }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
