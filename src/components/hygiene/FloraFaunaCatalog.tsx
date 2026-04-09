import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Leaf, Search, AlertTriangle, Info, X } from 'lucide-react';
import { Card } from '../shared/Card';

const catalogData = [
  {
    id: '1',
    name: 'Bugainvillea (Bugambilia)',
    type: 'Flora',
    status: 'Precaución',
    description: 'Planta trepadora común. Sus espinas pueden causar lesiones menores o rasgaduras en EPP.',
    action: 'Evitar contacto directo. Usar guantes de cuero si es necesario podar para despejar accesos.'
  },
  {
    id: '2',
    name: 'Quillay (Quillaja saponaria)',
    type: 'Flora',
    status: 'Protegida',
    description: 'Árbol endémico de Chile. Su corteza contiene saponina.',
    action: 'Prohibida su tala o daño. Establecer perímetro de protección de 5 metros durante instalación de campamento.'
  },
  {
    id: '3',
    name: 'Araña de Rincón (Loxosceles laeta)',
    type: 'Fauna',
    status: 'Peligro Crítico',
    description: 'Arácnido altamente venenoso. Suele esconderse en lugares oscuros y secos.',
    action: 'Revisar ropa y zapatos antes de usar. Mantener campamento limpio y ordenado. En caso de mordedura, aplicar hielo y trasladar a centro médico inmediatamente.'
  },
  {
    id: '4',
    name: 'Zorro Culpeo (Lycalopex culpaeus)',
    type: 'Fauna',
    status: 'Protegida',
    description: 'Cánido nativo. Puede acercarse a los campamentos buscando comida.',
    action: 'Prohibido alimentar. Mantener basura en contenedores cerrados. No acercarse ni intentar acariciar.'
  },
  {
    id: '5',
    name: 'Litre (Lithraea caustica)',
    type: 'Flora',
    status: 'Peligro',
    description: 'Árbol endémico. Produce alergia severa por contacto o cercanía (litrismo).',
    action: 'Identificar y señalizar. Evitar contacto absoluto. No quemar su madera bajo ninguna circunstancia.'
  }
];

export function FloraFaunaCatalog() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedItem, setSelectedItem] = useState<typeof catalogData[0] | null>(null);

  const filteredData = catalogData.filter(item => 
    item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.type.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Protegida': return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30';
      case 'Precaución': return 'text-yellow-500 bg-yellow-500/10 border-yellow-500/30';
      case 'Peligro': return 'text-orange-500 bg-orange-500/10 border-orange-500/30';
      case 'Peligro Crítico': return 'text-rose-500 bg-rose-500/10 border-rose-500/30';
      default: return 'text-zinc-500 bg-zinc-500/10 border-zinc-500/30';
    }
  };

  return (
    <Card className="p-6 border-white/5 space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Leaf className="w-5 h-5 text-emerald-500" />
            Catálogo Flora y Fauna
          </h3>
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-1">
            Base de datos local (Offline)
          </p>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
        <input
          type="text"
          placeholder="Buscar especie..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-10 pr-4 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors"
        />
      </div>

      <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar pr-2">
        {filteredData.length > 0 ? (
          filteredData.map(item => (
            <motion.button
              key={item.id}
              onClick={() => setSelectedItem(item)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="w-full text-left p-3 rounded-xl bg-zinc-900/50 border border-white/5 hover:border-emerald-500/30 transition-colors flex items-center justify-between group"
            >
              <div>
                <p className="text-sm font-bold text-white group-hover:text-emerald-400 transition-colors">{item.name}</p>
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest">{item.type}</p>
              </div>
              <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-full border ${getStatusColor(item.status)}`}>
                {item.status}
              </span>
            </motion.button>
          ))
        ) : (
          <div className="text-center py-8 text-zinc-500 text-sm">
            No se encontraron especies.
          </div>
        )}
      </div>

      <AnimatePresence>
        {selectedItem && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute inset-0 z-10 bg-zinc-950/90 backdrop-blur-sm p-6 flex flex-col"
          >
            <div className="flex justify-between items-start mb-4">
              <div>
                <h4 className="text-lg font-bold text-white">{selectedItem.name}</h4>
                <span className={`inline-block mt-2 text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-full border ${getStatusColor(selectedItem.status)}`}>
                  {selectedItem.status}
                </span>
              </div>
              <button 
                onClick={() => setSelectedItem(null)}
                className="p-2 rounded-full bg-zinc-900 text-zinc-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="space-y-4 flex-1 overflow-y-auto custom-scrollbar">
              <div>
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1 flex items-center gap-1">
                  <Info className="w-3 h-3" /> Descripción
                </p>
                <p className="text-sm text-zinc-300 leading-relaxed">{selectedItem.description}</p>
              </div>
              
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <p className="text-[10px] font-bold text-amber-500 uppercase tracking-widest mb-2 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Acción Preventiva
                </p>
                <p className="text-sm text-amber-200 leading-relaxed">{selectedItem.action}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
