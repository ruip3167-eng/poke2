import { useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { COLORS, SPACING, RADII, TYPE } from '@/src/theme';
import { gradeCard, formatPrice, FALLBACK_MARKET_PRICE } from '@/src/grading';
import { api, type Condition } from '@/src/api';
import { useT } from '@/src/i18n-context';

const GRADES = [
  { v: 'mint', label: 'Mint' },
  { v: 'near_mint', label: 'NM' },
  { v: 'lightly_played', label: 'LP' },
  { v: 'played', label: 'PL' },
  { v: 'poor', label: 'Poor' },
] as const;

const ASPECT_KEYS: (keyof Condition)[] = ['centering', 'corners', 'edges', 'surface'];

export default function ConditionScreen() {
  const router = useRouter();
  const t = useT();
  const params = useLocalSearchParams<{ name: string; set_name?: string; number?: string; scan_id?: string }>();
  const [cond, setCond] = useState<Condition>({
    centering: 'near_mint',
    corners: 'near_mint',
    edges: 'near_mint',
    surface: 'near_mint',
    whitening: false,
    scratches: false,
  });
  const [loading, setLoading] = useState(false);

  const setAspect = (key: keyof Condition, v: string) => {
    Haptics.selectionAsync().catch(() => {});
    setCond((c) => ({ ...c, [key]: v as any }));
  };

  const { grade, multiplier } = gradeCard(cond);

  const calculate = async () => {
    if (!params.name) return;
    setLoading(true);
    try {
      const price = await api.getPrice({
        name: params.name,
        set_name: params.set_name || undefined,
        number: params.number || undefined,
      });
      // The backend already picks the best EUR price for us
      // (Cardmarket trend → Cardmarket avg → TCGplayer USD→EUR).
      const apiMarket = price.recommended_eur
        ?? price.cardmarket_trend
        ?? price.cardmarket_average
        ?? price.tcgplayer_market
        ?? null;
      const isFallback = apiMarket === null || apiMarket === 0;
      const market = isFallback ? FALLBACK_MARKET_PRICE : (apiMarket as number);
      const estimated = market * multiplier;

      router.replace({
        pathname: '/card-detail',
        params: {
          name: price.name,
          set_name: price.set_name ?? '',
          number: price.number ?? '',
          image_url: price.image_url ?? '',
          market_price: String(market),
          tcgplayer_market: String(price.tcgplayer_market ?? ''),
          tcgplayer_holofoil_market: String(price.tcgplayer_holofoil_market ?? ''),
          tcgplayer_normal_market: String(price.tcgplayer_normal_market ?? ''),
          cardmarket_average: String(price.cardmarket_average ?? ''),
          cardmarket_trend: String(price.cardmarket_trend ?? ''),
          price_source: price.price_source ?? '',
          estimated_value: String(estimated),
          condition_grade: grade,
          condition_multiplier: String(multiplier),
          condition_json: JSON.stringify(cond),
          mode: 'new',
          is_fallback_price: isFallback ? '1' : '0',
          scan_id: params.scan_id ?? '',
        },
      });
    } catch (e: any) {
      setLoading(false);
      // No price data — use the fallback so the result screen still shows a value.
      const market = FALLBACK_MARKET_PRICE;
      const estimated = market * multiplier;
      router.replace({
        pathname: '/card-detail',
        params: {
          name: params.name,
          set_name: params.set_name ?? '',
          number: params.number ?? '',
          image_url: '',
          market_price: String(market),
          estimated_value: String(estimated),
          condition_grade: grade,
          condition_multiplier: String(multiplier),
          condition_json: JSON.stringify(cond),
          mode: 'new',
          is_fallback_price: '1',
          scan_id: params.scan_id ?? '',
          price_error: e?.message?.slice(0, 200) ?? 'No price data',
        },
      });
    }
  };

  return (
    <SafeAreaView style={styles.root} testID="condition-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.closeBtn} testID="condition-close">
          <Ionicons name="close" size={20} color={COLORS.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>{t.condition.title}</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Full-screen overlay while we fetch live prices from pokemontcg.io. */}
      {loading && (
        <View style={styles.loadingOverlay} testID="price-loading-overlay" pointerEvents="auto">
          <View style={styles.loadingCard}>
            <ActivityIndicator color={COLORS.brand} size="large" />
            <Text style={styles.loadingTitle}>{t.condition.fetchingTitle}</Text>
            <Text style={styles.loadingSub}>{t.condition.fetchingSub}</Text>
          </View>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.banner}>
          <Text style={styles.bannerLabel}>{t.condition.detectedCard}</Text>
          <Text style={styles.bannerName} numberOfLines={2}>{params.name || t.condition.unknownCard}</Text>
          {(params.set_name || params.number) && (
            <Text style={styles.bannerSub}>
              {[params.set_name, params.number].filter(Boolean).join(' · ')}
            </Text>
          )}
        </View>

        {ASPECT_KEYS.map((key) => (
          <View key={key} style={styles.row} testID={`aspect-${key}`}>
            <View style={{ marginBottom: SPACING.sm }}>
              <Text style={styles.rowTitle}>{t.condition[key as 'centering' | 'corners' | 'edges' | 'surface']}</Text>
              <Text style={styles.rowSub}>
                {t.condition[`${key}Sub` as 'centeringSub' | 'cornersSub' | 'edgesSub' | 'surfaceSub']}
              </Text>
            </View>
            <View style={styles.segment}>
              {GRADES.map((g) => {
                const selected = (cond[key] as string) === g.v;
                return (
                  <Pressable
                    key={g.v}
                    testID={`aspect-${key}-${g.v}`}
                    onPress={() => setAspect(key, g.v)}
                    style={[styles.segItem, selected && styles.segItemActive]}
                  >
                    <Text style={[styles.segText, selected && styles.segTextActive]}>{g.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}

        <View style={styles.toggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{t.condition.whitening}</Text>
            <Text style={styles.rowSub}>{t.condition.whiteningSub}</Text>
          </View>
          <Switch
            testID="toggle-whitening"
            value={cond.whitening}
            onValueChange={(v) => { Haptics.selectionAsync().catch(() => {}); setCond({ ...cond, whitening: v }); }}
            trackColor={{ true: COLORS.brand, false: COLORS.surfaceTertiary }}
            thumbColor={cond.whitening ? COLORS.onBrand : COLORS.onSurfaceTertiary}
          />
        </View>

        <View style={styles.toggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{t.condition.scratches}</Text>
            <Text style={styles.rowSub}>{t.condition.scratchesSub}</Text>
          </View>
          <Switch
            testID="toggle-scratches"
            value={cond.scratches}
            onValueChange={(v) => { Haptics.selectionAsync().catch(() => {}); setCond({ ...cond, scratches: v }); }}
            trackColor={{ true: COLORS.brand, false: COLORS.surfaceTertiary }}
            thumbColor={cond.scratches ? COLORS.onBrand : COLORS.onSurfaceTertiary}
          />
        </View>

        <View style={styles.summary}>
          <View>
            <Text style={styles.summaryLabel}>{t.condition.grade}</Text>
            <Text style={styles.summaryGrade} testID="summary-grade">{grade}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.summaryLabel}>{t.condition.valueRetained}</Text>
            <Text style={styles.summaryValue}>{Math.round(multiplier * 100)}%</Text>
          </View>
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <Pressable
          testID="condition-calculate-button"
          style={[styles.cta, loading && { opacity: 0.7 }]}
          onPress={calculate}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color={COLORS.onBrand} />
            : <Text style={styles.ctaText}>{t.condition.calculate}</Text>}
        </Pressable>
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  closeBtn: { width: 40, height: 40, borderRadius: RADII.pill, backgroundColor: COLORS.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: COLORS.onSurface, fontSize: TYPE.lg, fontWeight: '700' },
  scroll: { paddingHorizontal: SPACING.lg, paddingBottom: 120 },
  banner: { backgroundColor: 'rgba(255,230,0,0.06)', borderColor: 'rgba(255,230,0,0.25)', borderWidth: 1, padding: SPACING.lg, borderRadius: RADII.md, marginBottom: SPACING.lg },
  bannerLabel: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.sm, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7 },
  bannerName: { color: COLORS.onSurface, fontSize: TYPE.xl, fontWeight: '900', marginTop: 4 },
  bannerSub: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.sm, marginTop: 4 },
  row: { backgroundColor: COLORS.surfaceSecondary, padding: SPACING.lg, borderRadius: RADII.md, marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.border },
  rowTitle: { color: COLORS.onSurface, fontSize: TYPE.base, fontWeight: '700' },
  rowSub: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.sm, marginTop: 2 },
  segment: { flexDirection: 'row', backgroundColor: COLORS.surface, borderRadius: RADII.pill, padding: 4, borderWidth: 1, borderColor: COLORS.border },
  segItem: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: RADII.pill, borderWidth: 1.5, borderColor: 'transparent' },
  segItemActive: { backgroundColor: 'transparent', borderColor: COLORS.brand },
  segText: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.sm, fontWeight: '700' },
  segTextActive: { color: COLORS.brand },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.lg, backgroundColor: COLORS.surfaceSecondary, padding: SPACING.lg, borderRadius: RADII.md, marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.border },
  summary: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: COLORS.surfaceTertiary, padding: SPACING.lg, borderRadius: RADII.md, marginTop: SPACING.md },
  summaryLabel: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.sm, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6 },
  summaryGrade: { color: COLORS.brand, fontSize: TYPE.xxl, fontWeight: '900', marginTop: 4 },
  summaryValue: { color: COLORS.onSurface, fontSize: TYPE.xxl, fontWeight: '900', marginTop: 4 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: SPACING.lg, backgroundColor: 'rgba(10,11,14,0.96)', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.divider },
  cta: { backgroundColor: COLORS.brand, paddingVertical: SPACING.lg, borderRadius: RADII.md, alignItems: 'center', minHeight: 52, justifyContent: 'center' },
  ctaText: { color: COLORS.onBrand, fontWeight: '900', fontSize: TYPE.lg },
  loadingOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(10,11,14,0.85)',
    alignItems: 'center', justifyContent: 'center',
    zIndex: 10,
  },
  loadingCard: {
    backgroundColor: COLORS.surfaceSecondary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.xl,
    borderRadius: RADII.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,230,0,0.3)',
    alignItems: 'center',
    minWidth: 260,
    gap: SPACING.md,
  },
  loadingTitle: { color: COLORS.onSurface, fontSize: TYPE.lg, fontWeight: '800', textAlign: 'center' },
  loadingSub: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.sm, textAlign: 'center' },
});
