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
import { COLORS, SPACING, RADII, TYPE } from '@/src/theme';

const BENEFITS = [
  'Scans de IA e avaliações de estado ilimitados',
  'Histórico completo e gráficos de evolução do valor do teu Portfólio',
  'Suporte prioritário para novas coleções e Cartas Desportivas',
] as const;

export default function PaywallScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const subscribe = async () => {
    if (!user || loading) return;
    setErr(null);
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      // MOCKED purchase — flips is_pro=true on the server.
      await api.upgrade(user.uid);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.replace('/(tabs)/dashboard');
    } catch (e: any) {
      setErr(e?.message ?? 'Não foi possível processar a subscrição');
    } finally {
      setLoading(false);
    }
  };

  const restore = async () => {
    if (!user) return;
    // Mock "restaurar compras" — if user previously upgraded, this will surface
    // the existing is_pro flag and send them back to the dashboard.
    try {
      const c = await api.getScanCount(user.uid);
      if (c.is_pro) {
        router.replace('/(tabs)/dashboard');
        return;
      }
      setErr('Nenhuma subscrição ativa encontrada nesta conta.');
    } catch {
      setErr('Não foi possível verificar compras anteriores.');
    }
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
          Torna-te um Colecionador Pro 🚀
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

        <View style={styles.priceCard} testID="paywall-price-card">
          <View style={styles.priceBadge}>
            <Text style={styles.priceBadgeText}>PRO MENSAL</Text>
          </View>
          <View style={styles.priceRow}>
            <Text style={styles.priceValue}>3,99 €</Text>
            <Text style={styles.priceUnit}>/ mês</Text>
          </View>
          <Text style={styles.priceSub}>Cancela quando quiseres · Sem compromisso</Text>
        </View>

        {err && (
          <Text style={styles.error} testID="paywall-error">{err}</Text>
        )}

        <Pressable
          testID="paywall-subscribe-button"
          style={({ pressed }) => [styles.cta, pressed && { opacity: 0.88 }, loading && { opacity: 0.7 }]}
          onPress={subscribe}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color={COLORS.onBrand} />
            : <Text style={styles.ctaText}>Subscrever Agora</Text>}
        </Pressable>

        <Pressable
          onPress={restore}
          style={styles.linkBtn}
          testID="paywall-restore-button"
        >
          <Text style={styles.linkText}>Restaurar Compras</Text>
        </Pressable>

        <Pressable
          onPress={() => router.back()}
          style={styles.linkBtn}
          testID="paywall-continue-free-button"
        >
          <Text style={styles.linkTextDim}>Continuar com a versão gratuita</Text>
        </Pressable>

        <Text style={styles.disclaimer}>
          Pagamento simulado para efeitos de teste · Não há cobrança real
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
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: -0.5,
    lineHeight: 38,
    marginBottom: SPACING.xl,
  },
  benefits: {
    gap: SPACING.md,
    marginBottom: SPACING.xl,
  },
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
  priceCard: {
    backgroundColor: COLORS.surfaceSecondary,
    borderRadius: RADII.md,
    borderWidth: 2,
    borderColor: COLORS.brand,
    padding: SPACING.xl,
    marginBottom: SPACING.lg,
    alignItems: 'center',
  },
  priceBadge: {
    backgroundColor: COLORS.brand,
    paddingHorizontal: SPACING.md,
    paddingVertical: 4,
    borderRadius: RADII.pill,
    marginBottom: SPACING.md,
  },
  priceBadgeText: {
    color: COLORS.onBrand,
    fontWeight: '900',
    fontSize: 10,
    letterSpacing: 1.2,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  priceValue: {
    color: COLORS.brand,
    fontSize: 48,
    fontWeight: '900',
    letterSpacing: -1,
    textShadowColor: 'rgba(255,230,0,0.35)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 16,
  },
  priceUnit: {
    color: COLORS.onSurfaceTertiary,
    fontSize: TYPE.lg,
    fontWeight: '600',
  },
  priceSub: {
    color: COLORS.onSurfaceTertiary,
    fontSize: TYPE.sm,
    marginTop: SPACING.sm,
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
  linkBtn: {
    alignItems: 'center',
    paddingVertical: SPACING.md,
  },
  linkText: {
    color: COLORS.onSurfaceSecondary,
    fontSize: TYPE.base,
    fontWeight: '700',
  },
  linkTextDim: {
    color: COLORS.onSurfaceTertiary,
    fontSize: TYPE.base,
    fontWeight: '600',
  },
  disclaimer: {
    color: COLORS.onSurfaceTertiary,
    fontSize: 11,
    textAlign: 'center',
    marginTop: SPACING.md,
    opacity: 0.7,
  },
});
