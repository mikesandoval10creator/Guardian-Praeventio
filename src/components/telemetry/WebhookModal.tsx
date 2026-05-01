import { motion, AnimatePresence } from 'framer-motion';
import { Terminal, X, Copy, CheckCircle2 } from 'lucide-react';

interface WebhookModalProps {
  open: boolean;
  curlCommand: string;
  copied: boolean;
  onClose: () => void;
  onCopy: () => void;
}

/**
 * Modal that displays the curl example for connecting real IoT
 * hardware to Praeventio Guard. The curl text itself is computed
 * in `webhookCommand.ts` and passed in.
 */
export function WebhookModal({ open, curlCommand, copied, onClose, onCopy }: WebhookModalProps) {
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-zinc-900 border border-white/10 rounded-3xl p-6 max-w-2xl w-full shadow-2xl"
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30">
                  <Terminal className="w-5 h-5 text-emerald-500" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-white uppercase tracking-tight">IoT Webhook Generator</h3>
                  <p className="text-xs text-zinc-400">Conecta hardware real a Praeventio Guard</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-white/10 rounded-xl transition-colors"
              >
                <X className="w-5 h-5 text-zinc-400" />
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-sm text-zinc-300">
                Usa este comando en la terminal de tu dispositivo IoT (Raspberry Pi, Arduino con WiFi, etc.) para enviar datos reales al sistema. Verás cómo el Digital Twin y las alertas reaccionan instantáneamente.
              </p>

              <div className="relative group">
                <pre className="bg-black border border-white/10 rounded-xl p-4 overflow-x-auto text-xs font-mono text-emerald-400 leading-relaxed">
                  {curlCommand}
                </pre>
                <button
                  onClick={onCopy}
                  className="absolute top-3 right-3 p-2 bg-white/10 hover:bg-white/20 rounded-lg backdrop-blur-md transition-colors"
                >
                  {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-zinc-300" />}
                </button>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4">
                <h4 className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-2">Variables Soportadas</h4>
                <ul className="text-xs text-blue-200/70 space-y-1 list-disc list-inside">
                  <li><strong className="text-blue-300">type:</strong> "wearable" | "machinery"</li>
                  <li><strong className="text-blue-300">status:</strong> "normal" | "warning" | "critical"</li>
                  <li><strong className="text-blue-300">metric:</strong> "Ritmo Cardíaco", "Temperatura", "Velocidad", "Detección de Caída"</li>
                </ul>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
