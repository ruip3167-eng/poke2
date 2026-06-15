import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';

import { api } from '@/src/api';
import { useAuth } from '@/src/auth-context';
import { proStore, useIsPro } from '@/src/pro-store';
import { COLORS, SPACING, RADII, TYPE } from '@/src/theme';

const BENEFITS = [
  { icon: 'infinite-outline', title: 'Unlimited scans', sub: 'Scan every binder, every set.' },
  { icon: 'flash-outline', title: 'Priority AI vision', sub: 'Faster, sharper recognition.' },
  { icon: 'trending-up-outline', title: 'Live market alerts', sub: 'Know when your cards spike.' },
] as const;

export default function UpgradeScreen() {
  const { user } = useAuth();
  const router = useRouter();
  // Sync Pro flag — read on first render so the pricing UI never paints
  // for a paid user. Combined with the bounce on focus, the user simply
  // doesn't see this screen as Pro.
  const proFromStore = useIsPro();
  const [plan, setPlan] = useState<'monthly' | 'yearly'>('yearly');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [isPro, setIsPro] = useState<boolean>(() => proStore.get());

  // Hard bounce on focus. If a Pro user lands on this tab (via tab-bar tap,
  // deep link, etc.) we throw them straight to the dashboard.
  useFocusEffect(useCallback(() => {
    if (proStore.get()) {
      router.replace('/(tabs)/dashboard');
    }
  }, [router]));

  // Keep local state in sync with the store and react to a mid-screen flip
  // (e.g. RC entitlement landing while the user is on this tab).
  useEffect(() => { setIsPro(proFromStore || proStore.get()); }, [proFromStore]);

  useEffect(() => {
    (async () => {
      if (!user) return;
      try {
        const c = await api.getScanCount(user.uid);
        if (c.is_pro) {
          proStore.setPro(true);
          setIsPro(true);
        }
      } catch {}
    })();
  }, [user]);

  // Belt-and-braces: render nothing for Pro users so the pricing table can
  // never flash before the focus effect bounces them away.
  if (proFromStore || proStore.get()) return null;

  const subscribe = async () => {
    if (!user) return;
    setLoading(true);
    try {
      // MOCK upgrade — flips is_pro server-side
      await api.upgrade(user.uid);
      proStore.setPro(true);
      setDone(true);
      setIsPro(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} testID="upgrade-screen">
      <LinearGradient
        colors={['rgba(255,230,0,0.18)', 'transparent']}
        style={StyleSheet.absoluteFill}
      />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.badge}>
          <Ionicons name="flash" size={12} color={COLORS.onBrand} />
          <Text style={styles.badgeText}>POKÉVALUE PRO</Text>
        </View>
        <Text style={styles.title}>Scan without limits.</Text>
        <Text style={styles.subtitle}>
          {isPro
            ? 'You are on Pro — enjoy unlimited scans and priority recognition.'
            : 'Unlock the full power of AI card recognition and live market pricing.'}
        </Text>

        <View style={styles.benefits}>
          {BENEFITS.map((b) => (
            <View key={b.title} style={styles.benefitRow}>
              <View style={styles.benefitIcon}>
                <Ionicons name={b.icon as any} size={18} color={COLORS.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.benefitTitle}>{b.title}</Text>
                <Text style={styles.benefitSub}>{b.sub}</Text>
              </View>
            </View>
          ))}
        </View>

        {!isPro && (
          <View style={styles.plans} testID="plan-toggle">
            <Pressable
              testID="plan-monthly"
              style={[styles.planCard, plan === 'monthly' && styles.planCardActive]}
              onPress={() => setPlan('monthly')}
            >
              <Text style={styles.planLabel}>Mensal</Text>
              <Text style={styles.planPrice}>3,99 €</Text>
              <Text style={styles.planSub}>por mês</Text>
            </Pressable>
            <Pressable
              testID="plan-yearly"
              style={[styles.planCard, plan === 'yearly' && styles.planCardActive]}
              onPress={() => setPlan('yearly')}
            >
              <View style={styles.savePill}><Text style={styles.savePillText}>POUPA 41%</Text></View>
              <Text style={styles.planLabel}>Anual</Text>
              <Text style={styles.planPrice}>27,99 €</Text>
              <Text style={styles.planSub}>2,33 € / mês</Text>
            </Pressable>
          </View>
        )}

        {done && (
          <View style={styles.successBox} testID="upgrade-success">
            <Ionicons name="checkmark-circle" size={20} color={COLORS.success} />
            <Text style={styles.successText}>És agora Pro. Scans ilimitados desbloqueados.</Text>
          </View>
        )}

        <Pressable
          testID="upgrade-cta-button"
          style={[styles.cta, (loading || isPro) && { opacity: 0.6 }]}
          disabled={loading || isPro}
          onPress={subscribe}
        >
          {loading
            ? <ActivityIndicator color={COLORS.onBrand} />
            : <Text style={styles.ctaText}>{isPro ? 'És Pro' : 'Subscrever Agora'}</Text>}
        </Pressable>

        <Text style={styles.footer}>
          Pagamento simulado · Sem cobrança real neste protótipo.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.surface },
  scroll: { padding: SPACING.xl, paddingBottom: 140 },
  badge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.brand, paddingHorizontal: SPACING.md, paddingVertical: 6, borderRadius: RADII.pill, marginBottom: SPACING.lg, marginTop: SPACING.md },
  badgeText: { color: COLORS.onBrand, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  title: { color: COLORS.onSurface, fontSize: TYPE.hero, fontWeight: '900', letterSpacing: -0.5, marginBottom: SPACING.sm },
  subtitle: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.base, lineHeight: 22, marginBottom: SPACING.xxl },
  benefits: { gap: SPACING.md, marginBottom: SPACING.xxl },
  benefitRow: { flexDirection: 'row', gap: SPACING.md, alignItems: 'center', backgroundColor: COLORS.surfaceSecondary, padding: SPACING.lg, borderRadius: RADII.md, borderWidth: 1, borderColor: COLORS.border },
  benefitIcon: { width: 36, height: 36, borderRadius: RADII.pill, backgroundColor: COLORS.brandSoft, alignItems: 'center', justifyContent: 'center' },
  benefitTitle: { color: COLORS.onSurface, fontSize: TYPE.base, fontWeight: '700' },
  benefitSub: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.sm, marginTop: 2 },
  plans: { flexDirection: 'row', gap: SPACING.md, marginBottom: SPACING.xl },
  planCard: { flex: 1, backgroundColor: COLORS.surfaceSecondary, padding: SPACING.lg, borderRadius: RADII.md, borderWidth: 2, borderColor: COLORS.border, position: 'relative' },
  planCardActive: { borderColor: COLORS.brand, backgroundColor: 'rgba(255,230,0,0.06)' },
  planLabel: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.sm, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  planPrice: { color: COLORS.onSurface, fontSize: TYPE.xxl, fontWeight: '900', marginTop: 4 },
  planSub: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.sm, marginTop: 2 },
  savePill: { position: 'absolute', top: -10, right: 10, backgroundColor: COLORS.brand, paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADII.pill },
  savePillText: { color: COLORS.onBrand, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  successBox: { flexDirection: 'row', gap: SPACING.md, alignItems: 'center', backgroundColor: 'rgba(16,185,129,0.12)', padding: SPACING.md, borderRadius: RADII.md, borderWidth: 1, borderColor: 'rgba(16,185,129,0.35)', marginBottom: SPACING.lg },
  successText: { color: COLORS.onSurface, fontSize: TYPE.base, flex: 1 },
  cta: { backgroundColor: COLORS.brand, paddingVertical: SPACING.lg, borderRadius: RADII.md, alignItems: 'center', minHeight: 56, justifyContent: 'center' },
  ctaText: { color: COLORS.onBrand, fontWeight: '900', fontSize: TYPE.lg, letterSpacing: 0.3 },
  footer: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.sm, textAlign: 'center', marginTop: SPACING.lg },
});
