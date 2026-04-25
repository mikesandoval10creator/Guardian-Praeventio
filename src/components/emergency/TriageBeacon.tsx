import React, { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import QRCode from 'react-qr-code';
import { useWakeLock } from '../../hooks/useWakeLock';

type TriageSeverity = 'CRITICO' | 'GRAVE' | 'ESTABLE';

interface TriageBeaconProps {
  workerId: string;
  workerName?: string;
  bloodType?: string;
  allergies?: string;
  impactForce?: number; // g-force value
  onDismiss?: () => void; // only for supervisors with biometric auth
}

const severityConfig: Record<TriageSeverity, { bg: string; text: string; label: string }> = {
  CRITICO: { bg: 'bg-red-600', text: 'text-white', label: 'CRÍTICO' },
  GRAVE:   { bg: 'bg-yellow-400', text: 'text-black', label: 'GRAVE' },
  ESTABLE: { bg: 'bg-emerald-500', text: 'text-white', label: 'ESTABLE' },
};

function getSeverity(impactForce?: number): TriageSeverity {
  if (!impactForce || impactForce < 15) return 'ESTABLE';
  if (impactForce < 25) return 'GRAVE';
  return 'CRITICO';
}

export function TriageBeacon({ workerId, workerName, bloodType, allergies, impactForce, onDismiss }: TriageBeaconProps) {
  const { requestWakeLock, releaseWakeLock } = useWakeLock();
  const severity = getSeverity(impactForce);
  const config = severityConfig[severity];

  // QR payload: offline-readable worker medical summary
  const qrPayload = JSON.stringify({
    id: workerId,
    name: workerName || 'Desconocido',
    blood: bloodType || '?',
    allergies: allergies || 'Ninguna registrada',
    severity,
    impactG: impactForce?.toFixed(1) ?? 'N/A',
    ts: new Date().toISOString(),
  });

  // Keep screen on during triage
  useEffect(() => {
    requestWakeLock();
    return () => { releaseWakeLock(); };
  }, [requestWakeLock, releaseWakeLock]);

  // Pulse vibration pattern to signal rescuers
  useEffect(() => {
    if (!navigator.vibrate) return;
    const id = setInterval(() => {
      navigator.vibrate([200, 100, 200, 100, 200]);
    }, 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className={`fixed inset-0 z-[200] flex flex-col items-center justify-center ${config.bg}`}>
      {/* Severity badge */}
      <motion.div
        animate={{ opacity: [1, 0.4, 1] }}
        transition={{ repeat: Infinity, duration: 1.5 }}
        className="mb-6 text-center"
      >
        <p className={`text-5xl font-black tracking-widest uppercase ${config.text}`}>
          {config.label}
        </p>
        <p className={`text-sm font-bold mt-1 ${config.text} opacity-80`}>
          {workerName || 'Trabajador'}
        </p>
      </motion.div>

      {/* QR code — high contrast for dark environments */}
      <div className="bg-white p-4 rounded-2xl shadow-2xl">
        <QRCode value={qrPayload} size={200} level="M" />
      </div>

      {/* Medical summary below QR */}
      <div className={`mt-6 text-center space-y-1 ${config.text}`}>
        <p className="text-lg font-black">
          Sangre: <span className="font-mono">{bloodType || '?'}</span>
        </p>
        <p className="text-sm font-bold opacity-80">Alergias: {allergies || 'Ninguna'}</p>
        {impactForce !== undefined && (
          <p className="text-xs font-bold opacity-60">Impacto: {impactForce.toFixed(1)}g</p>
        )}
      </div>

      {/* Dismiss only if callback provided (requires supervisor biometric) */}
      {onDismiss && (
        <button
          onClick={onDismiss}
          className={`mt-8 px-6 py-3 border-2 border-white/50 rounded-xl text-xs font-black uppercase tracking-widest ${config.text} opacity-60 hover:opacity-100 transition-opacity`}
        >
          Desbloquear (Supervisor)
        </button>
      )}
    </div>
  );
}
