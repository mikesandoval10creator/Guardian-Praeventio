import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Quote } from 'lucide-react';

const quotes = [
  "El riesgo se neutraliza en el diseño, no en la reacción.",
  "Conoce a tu enemigo (el riesgo) y conócete a ti mismo; en cien batallas, nunca estarás en peligro.",
  "La suprema excelencia consiste en quebrar la resistencia del riesgo sin luchar (prevenirlo).",
  "Las oportunidades se multiplican a medida que se aprovechan.",
  "En medio del caos, también hay oportunidad.",
  "El general que gana la batalla hace muchos cálculos en su templo antes de que se libre la batalla.",
  "La invencibilidad radica en la defensa; la posibilidad de victoria, en el ataque."
];

export function WisdomCapsule() {
  const [quote, setQuote] = useState('');

  useEffect(() => {
    setQuote(quotes[Math.floor(Math.random() * quotes.length)]);
  }, []);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 bg-zinc-900/80 border border-zinc-800 rounded-2xl relative overflow-hidden max-w-md mx-auto"
    >
      <Quote className="absolute -top-2 -left-2 w-12 h-12 text-zinc-800 opacity-50 rotate-180" />
      <p className="relative z-10 text-sm font-medium text-zinc-300 italic text-center px-4">
        "{quote}"
      </p>
      <p className="relative z-10 text-[10px] font-black text-zinc-600 uppercase tracking-widest text-center mt-3">
        El Guardián / Sun Tzu
      </p>
    </motion.div>
  );
}
