// Adapted from Aceternity UI — Flip Words (https://ui.aceternity.com/components/flip-words)
import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '../../lib/utils';

/**
 * Cycles through words. Each phrase animates as one element, so gradient text (background-clip: text)
 * stays clipped to the glyphs; per-letter transforms and filters break that clip and paint a blurred box.
 * Outgoing and incoming phrases share one grid cell, so they cross-fade without shifting the layout.
 */
export const FlipWords = ({ words, duration = 3000, className }) => {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setIndex(current => (current + 1) % words.length), duration);
    return () => clearInterval(id);
  }, [words.length, duration]);

  return (
    <span className={cn('flip-words', className)}>
      <AnimatePresence initial={false}>
        <motion.span
          key={words[index]}
          className="flip-word"
          initial={{ opacity: 0, y: '0.35em', filter: 'blur(6px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1], delay: 0.12 } }}
          exit={{ opacity: 0, y: '-0.35em', filter: 'blur(6px)', transition: { duration: 0.3, ease: 'easeIn' } }}
        >
          {words[index]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
};
