import { useAppMode } from '../../contexts/AppModeContext';

export type MascotMood = 'default' | 'celebrating' | 'alert' | 'thinking' | 'emergency';

export type MascotSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface GuardianMascotProps {
  mood?: MascotMood;
  size?: MascotSize;
  className?: string;
  alt?: string;
}

const SIZE_MAP: Record<MascotSize, string> = {
  xs: 'w-10 h-10',
  sm: 'w-16 h-16',
  md: 'w-24 h-24',
  lg: 'w-36 h-36',
  xl: 'w-48 h-48',
};

const MOOD_FILE: Record<MascotMood, string> = {
  default:     '/mascots/guardian-default.png',
  celebrating: '/mascots/guardian-celebrando.png',
  alert:       '/mascots/guardian-atento.png',
  thinking:    '/mascots/guardian-pensativo.png',
  emergency:   '/mascots/guardian-emergencias.png',
};

const MOOD_ALT: Record<MascotMood, string> = {
  default:     'Guardian Praeventio',
  celebrating: 'Guardian celebrando',
  alert:       'Guardian en alerta',
  thinking:    'Guardian analizando',
  emergency:   'Guardian en emergencia',
};

export function GuardianMascot({
  mood,
  size = 'md',
  className = '',
  alt,
}: GuardianMascotProps) {
  const { mode } = useAppMode();

  // No mascot in driving mode
  if (mode === 'driving') return null;

  // Emergency mood only in emergency mode; force it when mode is emergency
  const resolvedMood: MascotMood =
    mode === 'emergency' ? 'emergency' : (mood ?? 'default');

  const src = MOOD_FILE[resolvedMood];
  const altText = alt ?? MOOD_ALT[resolvedMood];

  return (
    <img
      src={src}
      alt={altText}
      className={`${SIZE_MAP[size]} object-contain select-none motion-safe:transition-opacity ${className}`}
      draggable={false}
    />
  );
}
