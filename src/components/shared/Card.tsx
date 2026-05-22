import React, { useRef } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface CardProps extends React.ComponentPropsWithoutRef<'div'> {
  /** Disable the GSAP hover micro-interaction (defaults to enabled). */
  interactive?: boolean;
}

export function Card({ children, className, interactive = true, ...props }: CardProps) {
  const scopeRef = useRef<HTMLDivElement>(null);

  // GSAP hover micro-interaction (Emil Kowalski: "Animations should feel
  // invisible — they reinforce intent, not steal attention.")
  // - Only transform + box-shadow → compositor / GPU friendly.
  // - Respect prefers-reduced-motion via gsap.matchMedia().
  useGSAP(
    () => {
      if (!interactive || !scopeRef.current) return;
      const el = scopeRef.current;

      const mm = gsap.matchMedia();

      mm.add(
        {
          motionOK: '(prefers-reduced-motion: no-preference)',
          motionReduced: '(prefers-reduced-motion: reduce)',
        },
        // gsap matchMedia callback. El context (`ctx`) trae `conditions`
        // que evalúa cada query — tipamos el shape mínimo para no
        // depender de los typings de gsap/react que a veces no exportan
        // el tipo MatchMediaContext.
        (ctx: { conditions: Record<string, boolean> }) => {
          const { motionOK } = ctx.conditions as { motionOK: boolean };

          // Force GPU compositing layer up-front to avoid first-hover jank.
          gsap.set(el, { willChange: 'transform', force3D: true });

          if (!motionOK) return undefined; // Reduced motion: skip animation entirely.

          const enter = () => {
            gsap.to(el, {
              scale: 1.01,
              y: -2,
              boxShadow:
                '0 10px 25px -8px rgba(0, 0, 0, 0.12), 0 4px 10px -4px rgba(0, 0, 0, 0.06)',
              duration: 0.25,
              ease: 'power1.inOut',
              overwrite: 'auto',
            });
          };

          const leave = () => {
            gsap.to(el, {
              scale: 1,
              y: 0,
              boxShadow:
                '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
              duration: 0.25,
              ease: 'power1.inOut',
              overwrite: 'auto',
            });
          };

          const down = () => {
            gsap.to(el, {
              scale: 0.985,
              duration: 0.15,
              ease: 'power2.out',
              overwrite: 'auto',
            });
          };

          const up = () => {
            gsap.to(el, {
              scale: 1.01,
              duration: 0.18,
              ease: 'back.out(1.7)',
              overwrite: 'auto',
            });
          };

          el.addEventListener('mouseenter', enter);
          el.addEventListener('mouseleave', leave);
          el.addEventListener('pointerdown', down);
          el.addEventListener('pointerup', up);

          return () => {
            el.removeEventListener('mouseenter', enter);
            el.removeEventListener('mouseleave', leave);
            el.removeEventListener('pointerdown', down);
            el.removeEventListener('pointerup', up);
          };
        }
      );
    },
    { scope: scopeRef, dependencies: [interactive] }
  );

  return (
    <div
      ref={scopeRef}
      className={cn(
        "bg-elevated border border-default-token rounded-2xl shadow-mode overflow-hidden",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export interface ButtonProps extends React.ComponentPropsWithoutRef<'button'> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg' | 'icon';
}

export function Button({
  children,
  className,
  variant = 'primary',
  size = 'md',
  ...props
}: ButtonProps) {
  const variants = {
    primary: "bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm",
    secondary: "bg-zinc-100 hover:bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-zinc-100",
    outline: "border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300",
    ghost: "hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400",
    danger: "bg-red-600 hover:bg-red-700 text-white shadow-sm",
  };

  const sizes = {
    sm: "px-3 py-1.5 text-xs font-medium rounded-lg",
    md: "px-4 py-2 text-sm font-medium rounded-xl",
    lg: "px-6 py-3 text-base font-medium rounded-2xl",
    icon: "p-2 rounded-full",
  };

  return (
    <button
      className={cn(
        "inline-flex items-center justify-center transition-colors disabled:opacity-50 disabled:pointer-events-none",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
