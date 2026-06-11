import { Condition } from './api';

export interface GradeResult {
  grade: string;
  multiplier: number;
}

// Map per-aspect grades to numeric scores (0..1)
const ASPECT_SCORE: Record<string, number> = {
  mint: 1.0,
  near_mint: 0.92,
  lightly_played: 0.75,
  played: 0.55,
  poor: 0.35,
};

export function gradeCard(c: Condition): GradeResult {
  const aspects = [
    ASPECT_SCORE[c.centering] ?? 0.7,
    ASPECT_SCORE[c.corners] ?? 0.7,
    ASPECT_SCORE[c.edges] ?? 0.7,
    ASPECT_SCORE[c.surface] ?? 0.7,
  ];
  let avg = aspects.reduce((a, b) => a + b, 0) / aspects.length;
  if (c.whitening) avg -= 0.08;
  if (c.scratches) avg -= 0.1;
  avg = Math.max(0.15, Math.min(1, avg));

  let grade = 'Poor';
  if (avg >= 0.95) grade = 'Mint';
  else if (avg >= 0.85) grade = 'Near Mint';
  else if (avg >= 0.7) grade = 'Lightly Played';
  else if (avg >= 0.5) grade = 'Played';

  return { grade, multiplier: Number(avg.toFixed(2)) };
}

// Fallback market price used when pokemontcg.io has no data for the card.
export const FALLBACK_MARKET_PRICE = 100;

export const formatPrice = (n: number | null | undefined) => {
  if (typeof n !== 'number' || Number.isNaN(n)) return '—';
  // Portuguese / euro style: "92,00 €"
  return `${n.toFixed(2).replace('.', ',')} €`;
};
