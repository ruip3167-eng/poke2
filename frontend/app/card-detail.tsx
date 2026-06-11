import { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/src/api';
import { useAuth } from '@/src/auth-context';
import { COLORS, SPACING, RADII, TYPE } from '@/src/theme';
import { formatPrice } from '@/src/grading';
import { scanStore } from '@/src/scan-store';
const FALLBACK_CARD = 'https://images.unsplash.com/photo-1613771404784-3a5686aa2be3?crop=entropy&cs=srgb&fm=jpg&w=600&q=80';

export default function CardDetailScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const p = useLocalSearchParams<{
    id?: string;
    name: string; set_name?: string; number?: string; image_url?: string;
    market_price: string; tcgplayer_market?: string; cardmarket_average?: string;
    estimated_value: string; condition_grade: string; condition_multiplier: string;
    condition_json?: string; mode?: string; price_error?: string;
    is_fallback_price?: string; scan_id?: string;
  }>();
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(p.mode === 'saved');
  const [err, setErr] = useState<string | null>(null);

  const market = Number(p.market_price || '0');
  const estimated = Number(p.estimated_value || '0');
  const mult = Number(p.condition_multiplier || '1');
  const tcg = p.tcgplayer_market && p.tcgplayer_market !== '' ? Number(p.tcgplayer_market) : null;
  const cm = p.cardmarket_average && p.cardmarket_average !== '' ? Number(p.cardmarket_average) : null;
  const isFallback = p.is_fallback_price === '1';

  // Image source priority: official card art (pokemontcg.io) → photo captured
  // by the user during the scan → static fallback (so nothing breaks for
  // portfolio items saved on older versions of the app).
  const officialUrl = p.image_url && p.image_url !== '' ? p.image_url : null;
  const capturedUri = scanStore.getCapturedImage(p.scan_id);
  const displayImage = officialUrl ?? capturedUri ?? FALLBACK_CARD;
  // The URL we actually persist to MongoDB. We DO save the captured photo
  // (as a data:image/jpeg;base64,... URI) when the official image is missing —
  // never the generic Unsplash placeholder.
  const persistImageUrl = officialUrl ?? capturedUri ?? null;

  const save = async () => {
    if (!user) return;
    setSaving(true); setErr(null);
    try {
      const condition = p.condition_json
        ? JSON.parse(p.condition_json as string)
        : { centering: 'near_mint', corners: 'near_mint', edges: 'near_mint', surface: 'near_mint', whitening: false, scratches: false };

      await api.saveCard({
        user_id: user.uid,
        name: p.name,
        set_name: p.set_name || null,
        number: p.number || null,
        image_url: persistImageUrl,
        market_price: market,
        estimated_value: estimated,
        condition,
        condition_grade: p.condition_grade,
        condition_multiplier: mult,
      });
      // Free the in-memory capture once it's been persisted.
      scanStore.clear(p.scan_id);
      setSavedOk(true);
      setTimeout(() => router.replace('/(tabs)/dashboard'), 600);
    } catch (e: any) {
      setErr(e?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!p.id) return;
    Alert.alert('Remove card?', 'This will delete it from your portfolio.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          await api.deleteCard(p.id!);
          router.replace('/(tabs)/dashboard');
        },
      },
    ]);
  };

  return (
    <View style={styles.root} testID="card-detail-screen">
      <View style={styles.heroWrap}>
        <Image source={{ uri: displayImage }} style={styles.hero} contentFit="cover" />
        <LinearGradient
          colors={['rgba(10,11,14,0)', 'rgba(10,11,14,0.85)', COLORS.surface]}
          style={StyleSheet.absoluteFill}
          locations={[0, 0.55, 1]}
        />
        <SafeAreaView edges={['top']} style={styles.heroTop}>
          <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="detail-close">
            <Ionicons name="chevron-back" size={22} color={COLORS.onSurface} />
          </Pressable>
          {p.id ? (
            <Pressable onPress={remove} style={styles.iconBtn} testID="detail-remove">
              <Ionicons name="trash-outline" size={18} color={COLORS.error} />
            </Pressable>
          ) : <View style={{ width: 40 }} />}
        </SafeAreaView>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        <Text style={styles.cardName} testID="detail-name">{p.name}</Text>
        {(p.set_name || p.number) && (
          <Text style={styles.cardSet}>
            {[p.set_name, p.number].filter(Boolean).join(' · ')}
          </Text>
        )}

        <View style={styles.gradeBlock}>
          <View style={styles.gradeRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.metaLabel}>Condition</Text>
              <Text style={styles.gradeText}>{p.condition_grade}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.metaLabel}>Value retained</Text>
              <Text style={styles.gradeMult} testID="value-retained-pct">{Math.round(mult * 100)}%</Text>
            </View>
          </View>

          {/* Green → Yellow → Red gradient track. The neon-yellow marker sits
              at `mult` (0–1) along the bar — closer to green = better. */}
          <View style={styles.retentionTrack} testID="value-retained-bar">
            <LinearGradient
              colors={['#EF4444', '#FB923C', '#F59E0B', '#22C55E']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
            <View
              pointerEvents="none"
              style={[
                styles.retentionMarker,
                { left: `${Math.max(2, Math.min(98, mult * 100))}%` },
              ]}
            />
          </View>
          <View style={styles.retentionLabels}>
            <Text style={styles.retentionLabelTxt}>Poor</Text>
            <Text style={styles.retentionLabelTxt}>Mint</Text>
          </View>
        </View>

        <View style={styles.estimateCard}>
          <Text style={styles.metaLabel}>Valor estimado</Text>
          <Text style={styles.estimateValue} testID="detail-estimated-value">{formatPrice(estimated)}</Text>
          <Text style={styles.estimateSub}>
            {formatPrice(market)} × {Math.round(mult * 100)}% condition
          </Text>
        </View>

        <Text style={styles.section}>Live market</Text>
        <View style={styles.marketRow}>
          <View style={styles.marketCard}>
            <View style={styles.marketIcon}><Ionicons name="cash-outline" size={16} color={COLORS.brand} /></View>
            <Text style={styles.marketLabel}>TCGplayer</Text>
            <Text style={styles.marketPrice}>{tcg !== null ? formatPrice(tcg) : (isFallback ? formatPrice(market) : '—')}</Text>
          </View>
          <View style={styles.marketCard}>
            <View style={styles.marketIcon}><Ionicons name="cart-outline" size={16} color={COLORS.brand} /></View>
            <Text style={styles.marketLabel}>Cardmarket</Text>
            <Text style={styles.marketPrice}>{cm !== null ? formatPrice(cm) : (isFallback ? formatPrice(market) : '—')}</Text>
          </View>
        </View>

        {isFallback && (
          <View style={styles.info} testID="demo-price-notice">
            <Ionicons name="information-circle-outline" size={16} color={COLORS.brand} />
            <Text style={styles.infoText} numberOfLines={3}>
              Demo price: this card isn{'\u2019'}t in our live price feed yet, so we{'\u2019'}re using a placeholder market value of {formatPrice(market)}.
            </Text>
          </View>
        )}

        {!isFallback && p.price_error && (
          <View style={styles.warn} testID="price-error">
            <Ionicons name="information-circle-outline" size={16} color={COLORS.warning} />
            <Text style={styles.warnText} numberOfLines={3}>
              No live market data for this card yet. {p.price_error}
            </Text>
          </View>
        )}

        {err && (
          <View style={styles.warn}>
            <Ionicons name="alert-circle-outline" size={16} color={COLORS.error} />
            <Text style={styles.warnText} numberOfLines={2}>{err}</Text>
          </View>
        )}
      </ScrollView>

      {p.mode !== 'saved' && (
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <Pressable
            testID="detail-save-button"
            style={[styles.cta, (saving || savedOk) && { opacity: 0.7 }]}
            onPress={save}
            disabled={saving || savedOk}
          >
            {saving ? (
              <ActivityIndicator color={COLORS.onBrand} />
            ) : savedOk ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="checkmark" size={20} color={COLORS.onBrand} />
                <Text style={styles.ctaText}>Saved</Text>
              </View>
            ) : (
              <Text style={styles.ctaText}>Add to portfolio</Text>
            )}
          </Pressable>
        </SafeAreaView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.surface },
  heroWrap: { height: 360, backgroundColor: COLORS.surfaceTertiary },
  hero: { width: '100%', height: '100%' },
  heroTop: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: SPACING.lg },
  iconBtn: { width: 40, height: 40, borderRadius: RADII.pill, backgroundColor: 'rgba(20,22,28,0.85)', alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, marginTop: -32 },
  bodyContent: { paddingHorizontal: SPACING.lg, paddingBottom: 120 },
  cardName: { color: COLORS.onSurface, fontSize: TYPE.hero, fontWeight: '900', letterSpacing: -0.5 },
  cardSet: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.base, marginTop: 4, marginBottom: SPACING.lg },
  gradeBlock: { backgroundColor: COLORS.surfaceSecondary, borderRadius: RADII.md, padding: SPACING.lg, borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.md },
  gradeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  metaLabel: { color: COLORS.onSurfaceTertiary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7 },
  gradeText: { color: COLORS.brand, fontSize: TYPE.xxl, fontWeight: '900', marginTop: 4 },
  gradeMult: { color: COLORS.onSurface, fontSize: TYPE.xxl, fontWeight: '900', marginTop: 4 },
  estimateCard: { backgroundColor: 'rgba(255,230,0,0.06)', borderColor: 'rgba(255,230,0,0.4)', borderWidth: 1, borderRadius: RADII.md, padding: SPACING.lg, marginBottom: SPACING.xl },
  estimateValue: { color: COLORS.brand, fontSize: 56, fontWeight: '900', marginTop: 6, letterSpacing: -1.5, textShadowColor: 'rgba(255,230,0,0.35)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 18 },
  estimateSub: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.sm, marginTop: 6 },
  retentionTrack: { height: 10, borderRadius: 999, marginTop: SPACING.md, overflow: 'hidden', backgroundColor: COLORS.surface, position: 'relative' },
  retentionMarker: { position: 'absolute', top: -3, width: 4, height: 16, backgroundColor: COLORS.brand, borderRadius: 2, marginLeft: -2, shadowColor: COLORS.brand, shadowOpacity: 0.9, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  retentionLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: SPACING.xs },
  retentionLabelTxt: { color: COLORS.onSurfaceTertiary, fontSize: 10, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  section: { color: COLORS.onSurface, fontSize: TYPE.lg, fontWeight: '700', marginBottom: SPACING.md },
  marketRow: { flexDirection: 'row', gap: SPACING.md },
  marketCard: { flex: 1, backgroundColor: COLORS.surfaceSecondary, padding: SPACING.lg, borderRadius: RADII.md, borderWidth: 1, borderColor: COLORS.border },
  marketIcon: { width: 32, height: 32, borderRadius: RADII.pill, backgroundColor: COLORS.brandSoft, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.sm },
  marketLabel: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.sm, fontWeight: '600' },
  marketPrice: { color: COLORS.onSurface, fontSize: TYPE.xl, fontWeight: '900', marginTop: 2 },
  warn: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'flex-start', backgroundColor: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.3)', borderWidth: 1, padding: SPACING.md, borderRadius: RADII.md, marginTop: SPACING.lg },
  warnText: { color: COLORS.onSurfaceSecondary, fontSize: TYPE.sm, flex: 1, lineHeight: 18 },
  info: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'flex-start', backgroundColor: 'rgba(255,230,0,0.06)', borderColor: 'rgba(255,230,0,0.3)', borderWidth: 1, padding: SPACING.md, borderRadius: RADII.md, marginTop: SPACING.lg },
  infoText: { color: COLORS.onSurfaceSecondary, fontSize: TYPE.sm, flex: 1, lineHeight: 18 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: SPACING.lg, backgroundColor: 'rgba(10,11,14,0.96)', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.divider },
  cta: { backgroundColor: COLORS.brand, paddingVertical: SPACING.lg, borderRadius: RADII.md, alignItems: 'center', minHeight: 52, justifyContent: 'center' },
  ctaText: { color: COLORS.onBrand, fontWeight: '900', fontSize: TYPE.lg },
});
