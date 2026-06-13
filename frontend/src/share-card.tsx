/**
 * Shareable "graded card" composition + share helper.
 *
 * The user taps Share on the Card Detail screen. We render a styled
 * "social card" off-screen with the card art + grade + estimated value,
 * snapshot it with react-native-view-shot, then hand the resulting JPEG
 * to expo-sharing to surface the native share sheet (Instagram, WhatsApp,
 * Discord, etc).
 */
import { forwardRef } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import ViewShot, { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';

import { COLORS, RADII, SPACING, TYPE } from '@/src/theme';
import { formatPrice } from '@/src/grading';
import { dictionaries, type Locale } from '@/src/i18n';

export type ShareCardData = {
  name: string;
  setName?: string | null;
  number?: string | null;
  imageUri: string;
  grade: string;
  multiplier: number; // 0..1
  estimatedValue: number;
};

type Props = {
  data: ShareCardData;
  locale: Locale;
};

export const ShareCard = forwardRef<ViewShot, Props>(({ data, locale }, ref) => {
  const t = dictionaries[locale];
  const pct = Math.round(data.multiplier * 100);
  const sub = [data.setName, data.number].filter(Boolean).join(' · ');

  return (
    <ViewShot
      ref={ref}
      options={{ format: 'jpg', quality: 0.95, result: 'tmpfile' }}
      style={styles.shot}
    >
      <View style={styles.card}>
        <LinearGradient
          colors={['#1A1A1A', '#0B0B0B']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />

        {/* Header brand */}
        <View style={styles.header}>
          <View style={styles.brandPill}>
            <Ionicons name="flash" size={14} color={COLORS.onBrand} />
            <Text style={styles.brandText}>POKEVALUE SCANNER</Text>
          </View>
        </View>

        {/* Card art */}
        <View style={styles.artWrap}>
          <Image
            source={{ uri: data.imageUri }}
            style={styles.art}
            contentFit="contain"
          />
          {/* glow ring */}
          <View pointerEvents="none" style={styles.glow} />
        </View>

        {/* Card name + set */}
        <Text style={styles.name} numberOfLines={2}>{data.name}</Text>
        {sub.length > 0 && <Text style={styles.sub} numberOfLines={1}>{sub}</Text>}

        {/* Stats strip */}
        <View style={styles.stats}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>{t.share.grade}</Text>
            <Text style={styles.statValue}>{data.grade}</Text>
          </View>
          <View style={[styles.statBox, styles.statBoxCenter]}>
            <Text style={styles.statLabel}>{t.share.valueRetained}</Text>
            <Text style={[styles.statValue, { color: COLORS.brand }]}>{pct}%</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>{t.share.estimatedValue}</Text>
            <Text style={styles.statValue}>{formatPrice(data.estimatedValue)}</Text>
          </View>
        </View>

        {/* Hero price */}
        <View style={styles.priceWrap}>
          <Text style={styles.priceValue}>{formatPrice(data.estimatedValue)}</Text>
          <Text style={styles.priceFootnote}>{t.share.poweredBy}</Text>
        </View>
      </View>
    </ViewShot>
  );
});

ShareCard.displayName = 'ShareCard';

/**
 * Capture the ref'd ViewShot and open native share sheet.
 * Returns true on success, false otherwise (caller can show toast).
 */
export async function shareCardSnapshot(
  ref: React.RefObject<ViewShot | null>,
  caption: string,
  locale: Locale,
): Promise<{ ok: boolean; error?: string }> {
  const t = dictionaries[locale];
  try {
    const available = await Sharing.isAvailableAsync();
    if (!available) {
      return { ok: false, error: t.share.sharingUnavailable };
    }
    if (!ref.current) {
      return { ok: false, error: t.share.shareFailed };
    }
    const uri = await captureRef(ref, {
      format: 'jpg',
      quality: 0.95,
      result: 'tmpfile',
    });
    await Sharing.shareAsync(uri, {
      mimeType: 'image/jpeg',
      dialogTitle: caption,
      UTI: Platform.OS === 'ios' ? 'public.jpeg' : undefined,
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? t.share.shareFailed };
  }
}

const CARD_W = 360;
const styles = StyleSheet.create({
  // ViewShot host – kept off-screen until user taps share. We render at
  // a fixed dimension so the snapshot looks identical across devices.
  shot: {
    position: 'absolute',
    left: -10000,
    top: 0,
    width: CARD_W,
    backgroundColor: 'transparent',
  },
  card: {
    width: CARD_W,
    padding: SPACING.lg,
    borderRadius: RADII.lg,
    overflow: 'hidden',
    backgroundColor: '#0B0B0B',
    borderWidth: 1,
    borderColor: 'rgba(255,230,0,0.25)',
  },
  header: { flexDirection: 'row', justifyContent: 'flex-start', marginBottom: SPACING.md },
  brandPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.brand,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADII.pill,
  },
  brandText: { color: COLORS.onBrand, fontWeight: '900', fontSize: 10, letterSpacing: 0.6 },
  artWrap: {
    alignSelf: 'center',
    width: 220,
    height: 300,
    marginVertical: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  art: { width: '100%', height: '100%', borderRadius: 14 },
  glow: {
    position: 'absolute',
    width: 240,
    height: 320,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'rgba(255,230,0,0.35)',
    shadowColor: COLORS.brand,
    shadowOpacity: 0.7,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
  },
  name: {
    color: COLORS.onSurface,
    fontWeight: '900',
    fontSize: TYPE.xl,
    textAlign: 'center',
    marginTop: SPACING.sm,
    letterSpacing: -0.3,
  },
  sub: {
    color: COLORS.onSurfaceTertiary,
    fontSize: TYPE.sm,
    textAlign: 'center',
    marginTop: 2,
  },
  stats: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: RADII.md,
    marginTop: SPACING.lg,
    paddingVertical: SPACING.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  statBox: { flex: 1, alignItems: 'center' },
  statBoxCenter: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  statLabel: {
    color: COLORS.onSurfaceTertiary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  statValue: {
    color: COLORS.onSurface,
    fontWeight: '900',
    fontSize: TYPE.base,
    marginTop: 4,
  },
  priceWrap: {
    marginTop: SPACING.lg,
    alignItems: 'center',
    backgroundColor: 'rgba(255,230,0,0.08)',
    borderRadius: RADII.md,
    paddingVertical: SPACING.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,230,0,0.4)',
  },
  priceValue: {
    color: COLORS.brand,
    fontSize: 44,
    fontWeight: '900',
    letterSpacing: -1.2,
  },
  priceFootnote: {
    color: COLORS.onSurfaceTertiary,
    fontSize: TYPE.sm,
    marginTop: 4,
    fontWeight: '600',
  },
});
