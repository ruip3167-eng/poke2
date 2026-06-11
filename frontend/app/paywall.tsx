import { useRouter } from 'expo-router';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, SPACING, RADII, TYPE } from '@/src/theme';

export default function PaywallScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.root} testID="paywall-screen">
      <LinearGradient
        colors={['rgba(212,255,0,0.22)', 'transparent']}
        style={StyleSheet.absoluteFill}
      />
      <ScrollView contentContainerStyle={{ padding: SPACING.xl, paddingTop: SPACING.xxl }}>
        <Pressable onPress={() => router.back()} style={styles.close} testID="paywall-close">
          <Ionicons name="close" size={22} color={COLORS.onSurface} />
        </Pressable>

        <View style={styles.iconWrap}>
          <Ionicons name="lock-closed" size={36} color={COLORS.brand} />
        </View>
        <Text style={styles.title}>You{'\u2019'}ve used all 10 free scans</Text>
        <Text style={styles.subtitle}>
          Upgrade to PokéValue Pro for unlimited scanning, priority AI vision, and live market alerts.
        </Text>

        <Pressable
          testID="paywall-go-pro"
          style={styles.cta}
          onPress={() => { router.back(); router.push('/(tabs)/upgrade'); }}
        >
          <Text style={styles.ctaText}>See Pro plans</Text>
        </Pressable>

        <Pressable onPress={() => router.back()} testID="paywall-maybe-later" style={styles.later}>
          <Text style={styles.laterText}>Maybe later</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.surface },
  close: { alignSelf: 'flex-end', width: 40, height: 40, borderRadius: RADII.pill, backgroundColor: COLORS.surfaceTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.lg },
  iconWrap: { width: 88, height: 88, borderRadius: RADII.pill, backgroundColor: COLORS.brandSoft, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start', marginBottom: SPACING.lg },
  title: { color: COLORS.onSurface, fontSize: TYPE.hero, fontWeight: '900', marginBottom: SPACING.md, letterSpacing: -0.5 },
  subtitle: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.base, lineHeight: 22, marginBottom: SPACING.xxl },
  cta: { backgroundColor: COLORS.brand, paddingVertical: SPACING.lg, borderRadius: RADII.md, alignItems: 'center', minHeight: 56, justifyContent: 'center' },
  ctaText: { color: COLORS.onBrand, fontSize: TYPE.lg, fontWeight: '900' },
  later: { alignItems: 'center', paddingVertical: SPACING.lg, marginTop: SPACING.sm },
  laterText: { color: COLORS.onSurfaceTertiary, fontWeight: '700', fontSize: TYPE.base },
});
