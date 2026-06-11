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
const FALLBACK_CARD = 'https://images.unsplash.com/photo-1613771404784-3a5686aa2be3?crop=entropy&cs=srgb&fm=jpg&w=600&q=80';

export default function CardDetailScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const p = useLocalSearchParams<{
    id?: string;
    name: string; set_name?: string; number?: string; image_url?: string;
    market_price: string; tcgplayer_market?: string; cardmarket_average?: string;
    estimated_value: string; condition_grade: string; condition_multiplier: string;
    condition_json?: string; mode?: string; price_error?: string; is_fallback_price?: string;
  }>();
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(p.mode === 'saved');
  const [err, setErr] = useState<string | null>(null);

  const market = Number(p.market_price || '0');
  const estimated = Number(p.estimated_value || '0');
  const mult = Number(p.condition_multiplier || '1');
  const tcg = p.tcgplayer_market && p.tcgplayer_market !== '' ? Number(p.tcgplayer_market) : null;
  const cm = p.cardmarket_average && p.cardmarket_average !== '' ? Number(p.cardmarket_average) : null;
  const img = p.image_url && p.image_url !== '' ? p.image_url : FALLBACK_CARD;
  const isFallback = p.is_fallback_price === '1';

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
        image_url: p.image_url || null,
        market_price: market,
        estimated_value: estimated,
        condition,
        condition_grade: p.condition_grade,
        condition_multiplier: mult,
      });
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
        <Image source={{ uri: img }} style={styles.hero} contentFit="cover" />
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
            <View>
              <Text style={styles.metaLabel}>Condition</Text>
              <Text style={styles.gradeText}>{p.condition_grade}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.metaLabel}>Value retained</Text>
              <Text style={styles.gradeMult}>{Math.round(mult * 100)}%</Text>
            </View>
          </View>
        </View>

        <View style={styles.estimateCard}>
          <Text style={styles.metaLabel}>Estimated value</Text>
          <Text style={styles.estimateValue} testID="detail-estimated-value">{formatPrice(estimated)}</Text>
          <Text style={styles.estimateSub}>
            {formatPrice(market)} × {Math.round(mult * 100)}% condition
          </Text>
        </View>

        <Text style={styles.section}>Live market</Text>
        <View style={styles.marketRow}>
          <View style={styles.marketCard}>
            <View style={styles.marketIcon}><Ionicons name="logo-usd" size={16} color={COLORS.brand} /></View>
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
  estimateCard: { backgroundColor: 'rgba(212,255,0,0.08)', borderColor: 'rgba(212,255,0,0.35)', borderWidth: 1, borderRadius: RADII.md, padding: SPACING.lg, marginBottom: SPACING.xl },
  estimateValue: { color: COLORS.onSurface, fontSize: TYPE.mega, fontWeight: '900', marginTop: 4, letterSpacing: -1 },
  estimateSub: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.sm, marginTop: 4 },
  section: { color: COLORS.onSurface, fontSize: TYPE.lg, fontWeight: '700', marginBottom: SPACING.md },
  marketRow: { flexDirection: 'row', gap: SPACING.md },
  marketCard: { flex: 1, backgroundColor: COLORS.surfaceSecondary, padding: SPACING.lg, borderRadius: RADII.md, borderWidth: 1, borderColor: COLORS.border },
  marketIcon: { width: 32, height: 32, borderRadius: RADII.pill, backgroundColor: COLORS.brandSoft, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.sm },
  marketLabel: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.sm, fontWeight: '600' },
  marketPrice: { color: COLORS.onSurface, fontSize: TYPE.xl, fontWeight: '900', marginTop: 2 },
  warn: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'flex-start', backgroundColor: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.3)', borderWidth: 1, padding: SPACING.md, borderRadius: RADII.md, marginTop: SPACING.lg },
  warnText: { color: COLORS.onSurfaceSecondary, fontSize: TYPE.sm, flex: 1, lineHeight: 18 },
  info: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'flex-start', backgroundColor: 'rgba(212,255,0,0.06)', borderColor: 'rgba(212,255,0,0.3)', borderWidth: 1, padding: SPACING.md, borderRadius: RADII.md, marginTop: SPACING.lg },
  infoText: { color: COLORS.onSurfaceSecondary, fontSize: TYPE.sm, flex: 1, lineHeight: 18 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: SPACING.lg, backgroundColor: 'rgba(10,11,14,0.96)', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.divider },
  cta: { backgroundColor: COLORS.brand, paddingVertical: SPACING.lg, borderRadius: RADII.md, alignItems: 'center', minHeight: 52, justifyContent: 'center' },
  ctaText: { color: COLORS.onBrand, fontWeight: '900', fontSize: TYPE.lg },
});
