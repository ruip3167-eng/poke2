import { useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';

import { api } from '@/src/api';
import { useAuth } from '@/src/auth-context';
import { useRevenueCat } from '@/src/revenuecat-context';
import { purchaseByIdentifier, getCustomerInfo, hasProAccess } from '@/src/revenuecat';
import { COLORS, SPACING, RADII, TYPE } from '@/src/theme';

import { useT } from '@/src/i18n-context';

const PLAN_PRICES = { monthly: '3,99 €', annual: '27,99 €' };

export default function PaywallScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { available: rcAvailable, refresh: refreshRC } = useRevenueCat();
  const t = useT();
  type PlanKey = 'monthly' | 'yearly';
  // Yearly selected by default — drives conversion to the higher-LTV plan.
  const [selected, setSelected] = useState<PlanKey>('yearly');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const BENEFITS = [t.paywall.benefit1, t.paywall.benefit2, t.paywall.benefit3];

  const pickPlan = (k: PlanKey) => {
    if (k === selected) return;
    Haptics.selectionAsync().catch(() => {});
    setSelected(k);
  };

  const subscribe = async () => {
    if (!user || loading) return;
    setErr(null);
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      const packageId = selected === 'yearly' ? '$annual' : '$monthly';
      if (rcAvailable) {
        // Real RevenueCat purchase — uses the native StoreKit / Billing flow.
        const res = await purchaseByIdentifier(packageId);
        if (res.ok && res.isPro) {
          await refreshRC();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          router.replace('/(tabs)/dashboard');
          return;
        }
        if (res.reason === 'cancelled') {
          // user dismissed Apple/Google sheet — silent
          return;
        }
        if (res.reason === 'no-offering' || res.reason?.startsWith('no-')) {
          setErr(t.paywall.unavailable);
          return;
        }
        setErr(res.reason ?? t.paywall.purchaseFailed);
        return;
      }
      // Expo Go / web fallback — keep the existing mock so the app stays usable
      // until a native build is generated via EAS / Publish.
      await api.upgrade(user.uid);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.replace('/(tabs)/dashboard');
    } catch (e: any) {
      setErr(e?.message ?? t.paywall.purchaseFailed);
    } finally {
      setLoading(false);
    }
  };

  const restore = async () => {
    if (!user) return;
    try {
      if (rcAvailable) {
        const info = await getCustomerInfo();
        if (hasProAccess(info)) {
          await refreshRC();
          router.replace('/(tabs)/dashboard');
          return;
        }
        setErr(t.paywall.noActiveSub);
        return;
      }
      const c = await api.getScanCount(user.uid);
      if (c.is_pro) {
        router.replace('/(tabs)/dashboard');
        return;
      }
      setErr(t.paywall.noActiveSub);
    } catch {
      setErr(t.paywall.restoreFailed);
    }
  };

  const renderPlan = (k: PlanKey) => {
    const isSelected = selected === k;
    const label = k === 'yearly' ? t.paywall.annualLabel : t.paywall.monthlyLabel;
    const price = k === 'yearly' ? PLAN_PRICES.annual : PLAN_PRICES.monthly;
    const unit = k === 'yearly' ? t.paywall.perYear : t.paywall.perMonth;
    const perMonth = k === 'yearly' ? t.paywall.annualPerMonth : undefined;
    const savePct = k === 'yearly' ? t.paywall.save : undefined;
    return (
      <Pressable
        key={k}
        testID={`paywall-plan-${k}`}
        onPress={() => pickPlan(k)}
        style={[styles.planCard, isSelected && styles.planCardActive]}
      >
        {savePct && (
          <View style={styles.saveBadge}>
            <Text style={styles.saveBadgeText}>{savePct}</Text>
          </View>
        )}
        <View style={styles.planHeader}>
          <Text style={styles.planLabel}>{label}</Text>
          <View style={[styles.radio, isSelected && styles.radioActive]}>
            {isSelected && <View style={styles.radioDot} />}
          </View>
        </View>
        <View style={styles.priceRow}>
          <Text style={[styles.priceValue, isSelected && styles.priceValueActive]}>{price}</Text>
          <Text style={styles.priceUnit}>{unit}</Text>
        </View>
        {perMonth && <Text style={styles.priceSub}>{perMonth}</Text>}
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']} testID="paywall-screen">
      <LinearGradient
        colors={['rgba(255,230,0,0.22)', 'transparent']}
        style={styles.glow}
      />
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          onPress={() => router.back()}
          style={styles.close}
          testID="paywall-close"
        >
          <Ionicons name="close" size={20} color={COLORS.onSurface} />
        </Pressable>

        <View style={styles.iconWrap}>
          <Ionicons name="rocket-outline" size={32} color={COLORS.brand} />
        </View>

        <Text style={styles.title} testID="paywall-title">
          {t.paywall.title}
        </Text>

        <View style={styles.benefits}>
          {BENEFITS.map((b, i) => (
            <View key={i} style={styles.benefitRow} testID={`paywall-benefit-${i}`}>
              <View style={styles.checkIcon}>
                <Ionicons name="checkmark" size={16} color={COLORS.onBrand} />
              </View>
              <Text style={styles.benefitText}>{b}</Text>
            </View>
          ))}
        </View>

        <View style={styles.plans} testID="paywall-plan-selector">
          {renderPlan('yearly')}
          {renderPlan('monthly')}
        </View>

        {err && <Text style={styles.error} testID="paywall-error">{err}</Text>}

        <Pressable
          testID="paywall-subscribe-button"
          style={({ pressed }) => [styles.cta, pressed && { opacity: 0.88 }, loading && { opacity: 0.7 }]}
          onPress={subscribe}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color={COLORS.onBrand} />
            : <Text style={styles.ctaText}>{t.paywall.subscribe}</Text>}
        </Pressable>

        <Pressable onPress={restore} style={styles.linkBtn} testID="paywall-restore-button">
          <Text style={styles.linkText}>{t.paywall.restore}</Text>
        </Pressable>

        <Pressable
          onPress={() => router.back()}
          style={styles.linkBtn}
          testID="paywall-continue-free-button"
        >
          <Text style={styles.linkTextDim}>{t.paywall.continueFree}</Text>
        </Pressable>

        <Text style={styles.disclaimer}>
          {rcAvailable ? t.paywall.disclaimerReal : t.paywall.disclaimerMock}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.surface },
  glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 400 },
  scroll: { padding: SPACING.xl, paddingBottom: SPACING.xxxl },

  close: {
    alignSelf: 'flex-end',
    width: 40, height: 40, borderRadius: RADII.pill,
    backgroundColor: COLORS.surfaceTertiary,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: SPACING.lg,
  },
  iconWrap: {
    width: 72, height: 72, borderRadius: RADII.pill,
    backgroundColor: COLORS.brandSoft,
    alignItems: 'center', justifyContent: 'center',
    alignSelf: 'flex-start',
    marginBottom: SPACING.lg,
  },
  title: {
    color: COLORS.onSurface,
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: -0.5,
    lineHeight: 36,
    marginBottom: SPACING.xl,
  },

  benefits: { gap: SPACING.md, marginBottom: SPACING.xl },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.md,
    backgroundColor: COLORS.surfaceSecondary,
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.lg,
  },
  checkIcon: {
    width: 24, height: 24, borderRadius: RADII.pill,
    backgroundColor: COLORS.brand,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 2,
  },
  benefitText: {
    flex: 1,
    color: COLORS.onSurface,
    fontSize: TYPE.base,
    lineHeight: 20,
    fontWeight: '500',
  },

  // Plans
  plans: { gap: SPACING.md, marginBottom: SPACING.lg },
  planCard: {
    backgroundColor: COLORS.surfaceSecondary,
    borderRadius: RADII.md,
    borderWidth: 2,
    borderColor: COLORS.border,
    padding: SPACING.lg,
    position: 'relative',
  },
  planCardActive: {
    borderColor: COLORS.brand,
    backgroundColor: 'rgba(255,230,0,0.06)',
  },
  saveBadge: {
    position: 'absolute',
    top: -10,
    right: 16,
    backgroundColor: COLORS.brand,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: RADII.pill,
    shadowColor: COLORS.brand,
    shadowOpacity: 0.7,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  saveBadgeText: {
    color: COLORS.onBrand,
    fontWeight: '900',
    fontSize: 11,
    letterSpacing: 0.8,
  },
  planHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  planLabel: {
    color: COLORS.onSurfaceSecondary,
    fontWeight: '700',
    fontSize: TYPE.base,
    letterSpacing: 0.3,
  },
  radio: {
    width: 22, height: 22, borderRadius: 999,
    borderWidth: 2,
    borderColor: COLORS.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: { borderColor: COLORS.brand },
  radioDot: { width: 10, height: 10, borderRadius: 999, backgroundColor: COLORS.brand },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  priceValue: {
    color: COLORS.onSurface,
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: -0.8,
  },
  priceValueActive: {
    color: COLORS.brand,
    textShadowColor: 'rgba(255,230,0,0.4)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 14,
  },
  priceUnit: {
    color: COLORS.onSurfaceTertiary,
    fontSize: TYPE.base,
    fontWeight: '600',
  },
  priceSub: {
    color: COLORS.onSurfaceTertiary,
    fontSize: TYPE.sm,
    marginTop: 6,
    fontWeight: '600',
  },

  error: {
    color: COLORS.error,
    fontSize: TYPE.sm,
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  cta: {
    backgroundColor: COLORS.brand,
    paddingVertical: 18,
    borderRadius: RADII.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 60,
    shadowColor: COLORS.brand,
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
  },
  ctaText: {
    color: COLORS.onBrand,
    fontSize: TYPE.lg,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  linkBtn: { alignItems: 'center', paddingVertical: SPACING.md },
  linkText: { color: COLORS.onSurfaceSecondary, fontSize: TYPE.base, fontWeight: '700' },
  linkTextDim: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.base, fontWeight: '600' },
  disclaimer: {
    color: COLORS.onSurfaceTertiary,
    fontSize: 11,
    textAlign: 'center',
    marginTop: SPACING.md,
    opacity: 0.7,
  },
});
