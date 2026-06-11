export const COLORS = {
  surface: '#0A0B0E',
  onSurface: '#F3F4F6',
  surfaceSecondary: '#14161C',
  onSurfaceSecondary: '#D1D5DB',
  surfaceTertiary: '#20232B',
  onSurfaceTertiary: '#9CA3AF',
  brand: '#D4FF00',
  brandSoft: 'rgba(212, 255, 0, 0.12)',
  brandDim: '#B2D600',
  onBrand: '#000000',
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  border: '#20232B',
  borderStrong: '#374151',
  divider: '#1A1C23',
} as const;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const RADII = { sm: 6, md: 12, lg: 20, pill: 999 } as const;

// Use system fonts with weight-based styling (no @expo-google-fonts allowed).
// Display headlines lean condensed/heavy; body uses default system.
export const FONTS = {
  display: undefined as undefined,
  displayMd: undefined as undefined,
  text: undefined as undefined,
  textMd: undefined as undefined,
  textBold: undefined as undefined,
} as const;

export const TYPE = {
  sm: 12,
  base: 14,
  lg: 16,
  xl: 20,
  xxl: 24,
  hero: 36,
  mega: 48,
} as const;
