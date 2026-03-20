import React from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface CardProps extends React.ComponentPropsWithoutRef<'div'> {}

export function Card({ children, className, ...props }: CardProps) {
  return (
    <div 
      className={cn(
        "bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm overflow-hidden",
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
