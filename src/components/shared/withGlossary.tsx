import React, { useMemo, useState } from 'react';
import { SAFETY_GLOSSARY } from '../../constants/glossary';

interface GlossaryItem {
  term: string;
  definition: string;
}

const parseGlossary = (): GlossaryItem[] => {
  const items: GlossaryItem[] = [];
  const lines = SAFETY_GLOSSARY.split('\n').filter(line => line.trim() !== '');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.includes(':')) {
      const [term, ...defParts] = line.split(':');
      const definition = defParts.join(':').trim();
      if (term && definition) {
        items.push({ term: term.trim(), definition });
      }
    } else if (line.length > 3 && !line.startsWith('Técnicas') && line !== line.toUpperCase()) {
      if (line.split(' ').length <= 4 && i + 1 < lines.length && !lines[i+1].includes(':')) {
         const term = line;
         const definition = lines[i+1].trim();
         items.push({ term, definition });
         i++;
      }
    }
  }
  // Sort by length descending to match longer terms first
  return items.sort((a, b) => b.term.length - a.term.length);
};

const glossaryItems = parseGlossary();

export function withGlossary<P extends { text: string }>(WrappedComponent: React.ComponentType<P>) {
  return function WithGlossaryComponent(props: P) {
    const [tooltipContent, setTooltipContent] = useState<string | null>(null);
    const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

    const handleMouseEnter = (e: React.MouseEvent, definition: string) => {
      setTooltipContent(definition);
      setTooltipPos({ x: e.clientX, y: e.clientY });
    };

    const handleMouseLeave = () => {
      setTooltipContent(null);
    };

    const handleMouseMove = (e: React.MouseEvent) => {
      if (tooltipContent) {
        setTooltipPos({ x: e.clientX, y: e.clientY });
      }
    };

    const renderTextWithGlossary = (text: string) => {
      if (!text) return text;

      let parts = [{ text, isTerm: false, definition: '' }];

      glossaryItems.forEach(item => {
        const newParts: typeof parts = [];
        const regex = new RegExp(`\\b(${item.term})\\b`, 'gi');

        parts.forEach(part => {
          if (part.isTerm) {
            newParts.push(part);
            return;
          }

          const splitText = part.text.split(regex);
          
          splitText.forEach((segment, index) => {
            if (segment.toLowerCase() === item.term.toLowerCase()) {
              newParts.push({ text: segment, isTerm: true, definition: item.definition });
            } else if (segment) {
              newParts.push({ text: segment, isTerm: false, definition: '' });
            }
          });
        });
        parts = newParts;
      });

      return (
        <span onMouseMove={handleMouseMove}>
          {parts.map((part, i) => 
            part.isTerm ? (
              <span
                key={i}
                className="border-b border-dashed border-emerald-600 dark:border-emerald-500 text-emerald-700 dark:text-emerald-400 cursor-help relative inline-block"
                onMouseEnter={(e) => handleMouseEnter(e, part.definition)}
                onMouseLeave={handleMouseLeave}
              >
                {part.text}
              </span>
            ) : (
              <span key={i}>{part.text}</span>
            )
          )}
          {tooltipContent && (
            <div 
              className="fixed z-[9999] bg-white dark:bg-zinc-900 border border-emerald-200 dark:border-emerald-500/30 text-zinc-900 dark:text-white p-3 rounded-xl shadow-2xl max-w-xs text-xs pointer-events-none"
              style={{ 
                left: tooltipPos.x + 15, 
                top: tooltipPos.y + 15,
                transform: 'translate(0, 0)' // Simple positioning, might need adjustment near edges
              }}
            >
              {tooltipContent}
            </div>
          )}
        </span>
      );
    };

    // We pass the rendered ReactNode instead of the raw string
    // This requires the WrappedComponent to accept ReactNode, but the prop type is string.
    // To fix this cleanly, we just return the rendered span directly if it's a simple wrapper,
    // or we need to change the prop type. Since we control GlossaryText, we'll just render it here.
    
    // Actually, a better HOC pattern for this specific use case:
    return (
      <span className="with-glossary-wrapper">
        {renderTextWithGlossary(props.text)}
      </span>
    );
  };
}
