import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type ViewShot from 'react-native-view-shot';

import { api } from '@/src/api';
import { useAuth } from '@/src/auth-context';
import { COLORS, SPACING, RADII, TYPE } from '@/src/theme';
import { formatPrice } from '@/src/grading';
import { scanStore } from '@/src/scan-store';
import { useI18n } from '@/src/i18n-context';
import { ShareCard, shareCardSnapshot } from '@/src/share-card';
const FALLBACK_CARD = 'https://images.unsplash.com/photo-1613771404784-3a5686aa2be3?crop=entropy&cs=srgb&fm=jpg&w=600&q=80';

export default function CardDetailScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const shareRef = useRef<ViewShot>(null);
  const p = useLocalSearchParams<{
    id?: string;
    name: string; set_name?: string; number?: string; image_url?: string;
    market_price: string;
    tcgplayer_market?: string; tcgplayer_holofoil_market?: string; tcgplayer_normal_market?: string;
    cardmarket_average?: string; cardmarket_trend?: string;
    price_source?: string;
    estimated_value: string; condition_grade: string; condition_multiplier: string;
    condition_json?: string; mode?: string; price_error?: string;
    is_fallback_price?: string; scan_id?: string;
    // Set when loading an item from the portfolio dashboard.
    price_at_creation?: string;
    card_id_api?: string;
  }>();
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(p.mode === 'saved');
  const [err, setErr] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  const market = Number(p.market_price || '0');
  const estimated = Number(p.estimated_value || '0');
  const mult = Number(p.condition_multiplier || '1');

  // Refetched live data for SAVED cards. We always refresh prices when the
  // user reopens a saved card so the trend arrow reflects the latest market.
  const [livePrice, setLivePrice] = useState<{ market: number; estimated: number } | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const baselineAtSave = p.price_at_creation && p.price_at_creation !== ''
    ? Number(p.price_at_creation) : null;
  // Current "live" price drives the trend comparison. For brand-new scans we
  // use the price we already computed in condition.tsx; for saved cards we
  // refetch in the effect below.
  const liveMarketPrice = livePrice?.market ?? market;
  const liveEstimated = livePrice?.estimated ?? estimated;

  // Refresh live prices for saved cards so the trend is meaningful.
  useEffect(() => {
    if (p.mode !== 'saved' || !p.name) return;
    let cancelled = false;
    setLiveLoading(true);
    api.getPrice({
      name: p.name,
      set_name: p.set_name || undefined,
      number: p.number || undefined,
    })
      .then((price) => {
        if (cancelled) return;
        const apiMarket = price.recommended_eur ?? price.cardmarket_trend
          ?? price.cardmarket_average ?? price.tcgplayer_market ?? null;
        if (apiMarket && apiMarket > 0) {
          setLivePrice({ market: apiMarket, estimated: apiMarket * mult });
        }
      })
      .catch(() => { /* fall back silently to the persisted snapshot */ })
      .finally(() => { if (!cancelled) setLiveLoading(false); });
    return () => { cancelled = true; };
  }, [p.mode, p.name, p.set_name, p.number, mult]);

  // Prefer holofoil if we have it (most-collected variant). Fall back to whatever
  // single TCGplayer value the backend already picked.
  const tcgHolo = p.tcgplayer_holofoil_market && p.tcgplayer_holofoil_market !== ''
    ? Number(p.tcgplayer_holofoil_market) : null;
  const tcgGeneric = p.tcgplayer_market && p.tcgplayer_market !== ''
    ? Number(p.tcgplayer_market) : null;
  const tcg = tcgHolo ?? tcgGeneric;
  // Prefer Cardmarket trend (real-time EU market) over averageSellPrice.
  const cmTrend = p.cardmarket_trend && p.cardmarket_trend !== ''
    ? Number(p.cardmarket_trend) : null;
  const cmAvg = p.cardmarket_average && p.cardmarket_average !== ''
    ? Number(p.cardmarket_average) : null;
  const cm = cmTrend ?? cmAvg;
  const isFallback = p.is_fallback_price === '1';
  const priceSource = (p.price_source || '').toString();

  // Trend = current live market vs. the price we recorded at save time.
  // 1¢ tolerance to avoid flagging floating-point rounding as a change.
  const trend: 'up' | 'down' | 'flat' | null = (() => {
    if (p.mode !== 'saved' || baselineAtSave === null || liveMarketPrice <= 0) return null;
    const diff = liveMarketPrice - baselineAtSave;
    if (Math.abs(diff) < 0.01) return 'flat';
    return diff > 0 ? 'up' : 'down';
  })();
  const trendDiff = (trend && baselineAtSave) ? liveMarketPrice - baselineAtSave : 0;
  const trendPct = (trend && baselineAtSave && baselineAtSave > 0)
    ? (trendDiff / baselineAtSave) * 100 : 0;

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
        tcgplayer_market: tcg,
        cardmarket_average: cmAvg,
        cardmarket_trend: cmTrend,
        price_source: priceSource || null,
        price_at_creation: market,
        card_id: p.card_id_api || null,
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
    Alert.alert(t.detail.removeConfirmTitle, t.detail.removeConfirmBody, [
      { text: t.common.cancel, style: 'cancel' },
      {
        text: t.common.remove, style: 'destructive', onPress: async () => {
          await api.deleteCard(p.id!);
          router.replace('/(tabs)/dashboard');
        },
      },
    ]);
  };

  const share = async () => {
    if (sharing) return;
    // Web preview has no view-shot / native share. Fail gracefully.
    if (Platform.OS === 'web') {
      setErr(t.share.sharingUnavailable);
      setTimeout(() => setErr(null), 2500);
      return;
    }
    setSharing(true);
    setErr(null);
    try {
      // Give the off-screen ShareCard a tick to lay out before snapshotting.
      await new Promise((r) => setTimeout(r, 50));
      const caption = t.share.captionWithApp(p.name, formatPrice(estimated));
      const res = await shareCardSnapshot(shareRef, caption, locale);
      if (!res.ok && res.error) {
        setErr(res.error);
        setTimeout(() => setErr(null), 3000);
      }
    } finally {
      setSharing(false);
    }
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
          <View style={styles.heroActions}>
            <Pressable
              onPress={share}
              style={styles.iconBtn}
              testID="detail-share"
              accessibilityLabel={t.share.shareCard}
              disabled={sharing}
            >
              {sharing
                ? <ActivityIndicator color={COLORS.brand} size="small" />
                : <Ionicons name="share-social-outline" size={20} color={COLORS.brand} />}
            </Pressable>
            {p.id ? (
              <Pressable onPress={remove} style={styles.iconBtn} testID="detail-remove">
                <Ionicons name="trash-outline" size={18} color={COLORS.error} />
              </Pressable>
            ) : null}
          </View>
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
              <Text style={styles.metaLabel}>{t.detail.condition}</Text>
              <Text style={styles.gradeText}>{p.condition_grade}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.metaLabel}>{t.detail.valueRetained}</Text>
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
            <Text style={styles.retentionLabelTxt}>{t.detail.poor}</Text>
            <Text style={styles.retentionLabelTxt}>{t.detail.mint}</Text>
          </View>
        </View>

        <View style={styles.estimateCard}>
          <Text style={styles.metaLabel}>{t.detail.estimatedValue}</Text>
          <View style={styles.estimateValueRow}>
            <Text style={styles.estimateValue} testID="detail-estimated-value">
              {formatPrice(liveEstimated)}
            </Text>
            {trend && (
              <View
                style={[
                  styles.detailTrendBadge,
                  trend === 'up' && styles.detailTrendUp,
                  trend === 'down' && styles.detailTrendDown,
                ]}
                testID={`detail-trend-${trend}`}
              >
                {liveLoading ? (
                  <ActivityIndicator size="small" color={COLORS.brand} />
                ) : (
                  <>
                    <Ionicons
                      name={trend === 'up' ? 'arrow-up' : trend === 'down' ? 'arrow-down' : 'remove'}
                      size={14}
                      color={trend === 'up' ? COLORS.success : trend === 'down' ? COLORS.error : COLORS.onSurfaceTertiary}
                    />
                    {trend !== 'flat' && (
                      <Text style={[
                        styles.detailTrendText,
                        { color: trend === 'up' ? COLORS.success : COLORS.error },
                      ]}>
                        {trendPct > 0 ? '+' : ''}{trendPct.toFixed(1)}%
                      </Text>
                    )}
                  </>
                )}
              </View>
            )}
          </View>
          <Text style={styles.estimateSub}>{t.detail.estimatedSub(formatPrice(liveMarketPrice), Math.round(mult * 100))}</Text>
        </View>

        <View style={styles.marketHeader}>
          <Text style={styles.section}>{t.detail.liveMarket}</Text>
          {!isFallback && priceSource ? (
            <Text style={styles.sourceLabel} testID="price-source-label">
              {priceSource === 'cardmarket_trend' ? t.detail.sourceCardmarketTrend
                : priceSource === 'cardmarket_avg' ? t.detail.sourceCardmarketAvg
                : priceSource === 'tcgplayer_holofoil' ? t.detail.sourceTcgHolofoil
                : priceSource === 'tcgplayer_normal' ? t.detail.sourceTcgNormal
                : t.detail.sourceTcgOther(priceSource.replace('tcgplayer_', ''))}
            </Text>
          ) : null}
        </View>
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
            <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
              <Ionicons name="information-circle-outline" size={16} color={COLORS.brand} style={{ marginTop: 2 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.warnText}>
                  {t.detail.demoNotice(formatPrice(market))}
                </Text>
                <Text style={[styles.warnText, styles.tipText]}>
                  {t.detail.demoTipRetry}
                </Text>
                <Pressable
                  testID="demo-rescan-cta"
                  onPress={() => router.replace('/(tabs)/scan')}
                  style={({ pressed }) => [styles.rescanBtn, pressed && { opacity: 0.8 }]}
                >
                  <Ionicons name="scan" size={16} color={COLORS.onBrand} />
                  <Text style={styles.rescanBtnText}>{t.detail.rescanCta}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}

        {!isFallback && p.price_error && (
          <View style={styles.warn} testID="price-error">
            <Ionicons name="information-circle-outline" size={16} color={COLORS.warning} />
            <Text style={styles.warnText} numberOfLines={3}>
              {t.detail.noLiveData} {p.price_error}
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
                <Text style={styles.ctaText}>{t.detail.saved}</Text>
              </View>
            ) : (
              <Text style={styles.ctaText}>{t.detail.addToPortfolio}</Text>
            )}
          </Pressable>
        </SafeAreaView>
      )}

      {/* Off-screen composer used to snapshot a polished share card. */}
      {Platform.OS !== 'web' && (
        <ShareCard
          ref={shareRef}
          locale={locale}
          data={{
            name: p.name,
            setName: p.set_name,
            number: p.number,
            imageUri: displayImage,
            grade: p.condition_grade,
            multiplier: mult,
            estimatedValue: estimated,
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.surface },
  heroWrap: { height: 360, backgroundColor: COLORS.surfaceTertiary },
  hero: { width: '100%', height: '100%' },
  heroTop: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: SPACING.lg },
  heroActions: { flexDirection: 'row', gap: SPACING.sm },
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
  estimateValueRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, flexWrap: 'wrap' },
  estimateValue: { color: COLORS.brand, fontSize: 56, fontWeight: '900', marginTop: 6, letterSpacing: -1.5, textShadowColor: 'rgba(255,230,0,0.35)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 18 },
  detailTrendBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: RADII.pill, marginTop: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1, borderColor: 'transparent',
  },
  detailTrendUp:   { backgroundColor: 'rgba(34,197,94,0.12)', borderColor: 'rgba(34,197,94,0.45)' },
  detailTrendDown: { backgroundColor: 'rgba(239,68,68,0.12)', borderColor: 'rgba(239,68,68,0.45)' },
  detailTrendText: { fontWeight: '800', fontSize: TYPE.sm, letterSpacing: -0.2 },
  estimateSub: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.sm, marginTop: 6 },
  retentionTrack: { height: 10, borderRadius: 999, marginTop: SPACING.md, overflow: 'hidden', backgroundColor: COLORS.surface, position: 'relative' },
  retentionMarker: { position: 'absolute', top: -3, width: 4, height: 16, backgroundColor: COLORS.brand, borderRadius: 2, marginLeft: -2, shadowColor: COLORS.brand, shadowOpacity: 0.9, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  retentionLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: SPACING.xs },
  retentionLabelTxt: { color: COLORS.onSurfaceTertiary, fontSize: 10, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  section: { color: COLORS.onSurface, fontSize: TYPE.lg, fontWeight: '700', marginBottom: SPACING.md },
  marketHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: SPACING.sm },
  sourceLabel: { color: COLORS.brand, fontSize: TYPE.xs, fontWeight: '700', letterSpacing: 0.3 },
  marketRow: { flexDirection: 'row', gap: SPACING.md },
  marketCard: { flex: 1, backgroundColor: COLORS.surfaceSecondary, padding: SPACING.lg, borderRadius: RADII.md, borderWidth: 1, borderColor: COLORS.border },
  marketIcon: { width: 32, height: 32, borderRadius: RADII.pill, backgroundColor: COLORS.brandSoft, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.sm },
  marketLabel: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.sm, fontWeight: '600' },
  marketPrice: { color: COLORS.onSurface, fontSize: TYPE.xl, fontWeight: '900', marginTop: 2 },
  warn: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'flex-start', backgroundColor: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.3)', borderWidth: 1, padding: SPACING.md, borderRadius: RADII.md, marginTop: SPACING.lg },
  warnText: { color: COLORS.onSurfaceSecondary, fontSize: TYPE.sm, flex: 1, lineHeight: 18 },
  tipText: { marginTop: SPACING.sm, color: COLORS.onSurfaceTertiary, fontSize: TYPE.sm, fontStyle: 'italic' },
  rescanBtn: {
    marginTop: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.brand,
    paddingVertical: 10,
    paddingHorizontal: SPACING.lg,
    borderRadius: RADII.pill,
    alignSelf: 'flex-start',
  },
  rescanBtnText: { color: COLORS.onBrand, fontWeight: '900', fontSize: TYPE.sm, letterSpacing: 0.3 },
  info: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'flex-start', backgroundColor: 'rgba(255,230,0,0.06)', borderColor: 'rgba(255,230,0,0.3)', borderWidth: 1, padding: SPACING.md, borderRadius: RADII.md, marginTop: SPACING.lg },
  infoText: { color: COLORS.onSurfaceSecondary, fontSize: TYPE.sm, flex: 1, lineHeight: 18 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: SPACING.lg, backgroundColor: 'rgba(10,11,14,0.96)', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.divider },
  cta: { backgroundColor: COLORS.brand, paddingVertical: SPACING.lg, borderRadius: RADII.md, alignItems: 'center', minHeight: 52, justifyContent: 'center' },
  ctaText: { color: COLORS.onBrand, fontWeight: '900', fontSize: TYPE.lg },
});
