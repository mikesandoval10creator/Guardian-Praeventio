import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Canonical class merger: clsx for conditionals + tailwind-merge for dedupe. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
