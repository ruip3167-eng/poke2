export const COLORS = {
  surface: '#121212',
  onSurface: '#FFFFFF',
  surfaceSecondary: '#1E1E1E',
  onSurfaceSecondary: '#FFFFFF',
  surfaceTertiary: '#262626',
  onSurfaceTertiary: '#A0A0A0',
  brand: '#FFE600',
  brandSoft: 'rgba(255, 230, 0, 0.12)',
  brandDim: '#E6D000',
  onBrand: '#000000',
  success: '#22C55E',
  warning: '#F59E0B',
  warningOrange: '#FB923C',
  error: '#EF4444',
  border: '#262626',
  borderStrong: '#3A3A3A',
  divider: '#1A1A1A',
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
