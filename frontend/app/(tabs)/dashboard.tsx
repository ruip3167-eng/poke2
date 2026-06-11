import { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { api, CardRecord } from '@/src/api';
import { useAuth } from '@/src/auth-context';
import { auth as fbAuth, fbSignOut } from '@/src/firebase';
import { COLORS, SPACING, RADII, TYPE } from '@/src/theme';
import { formatPrice } from '@/src/grading';

export default function DashboardScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [cards, setCards] = useState<CardRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const data = await api.getPortfolio(user.uid);
      setCards(data);
    } catch (e) {
      console.log('portfolio load err', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const onRefresh = () => { setRefreshing(true); load(); };

  const total = cards.reduce((s, c) => s + (c.estimated_value || 0), 0);

  const logout = async () => {
    await fbSignOut(fbAuth);
    router.replace('/(auth)/login');
  };

  const renderEmpty = () => (
    <View style={styles.empty} testID="portfolio-empty">
      <View style={styles.emptyIcon}>
        <Ionicons name="albums-outline" size={48} color={COLORS.brand} />
      </View>
      <Text style={styles.emptyTitle}>Your portfolio is empty</Text>
      <Text style={styles.emptySub}>Scan your first Pokémon card to start tracking its market value.</Text>
      <Pressable
        testID="empty-scan-cta"
        style={styles.emptyCta}
        onPress={() => router.push('/(tabs)/scan')}
      >
        <Ionicons name="scan-outline" size={18} color={COLORS.onBrand} />
        <Text style={styles.emptyCtaText}>Scan Card</Text>
      </Pressable>
    </View>
  );

  const renderItem = ({ item }: { item: CardRecord }) => (
    <Pressable
      testID={`portfolio-card-${item.id}`}
      style={styles.card}
      onPress={() => router.push({
        pathname: '/card-detail',
        params: {
          id: item.id, name: item.name, set_name: item.set_name ?? '',
          number: item.number ?? '', image_url: item.image_url ?? '',
          market_price: String(item.market_price), estimated_value: String(item.estimated_value),
          condition_grade: item.condition_grade, condition_multiplier: String(item.condition_multiplier),
          mode: 'saved',
        },
      })}
    >
      <View style={styles.cardImgWrap}>
        {item.image_url ? (
          <Image source={{ uri: item.image_url }} style={styles.cardImg} contentFit="cover" />
        ) : (
          <View style={[styles.cardImg, styles.cardImgPlaceholder]}>
            <Ionicons name="image-outline" size={28} color={COLORS.onSurfaceTertiary} />
          </View>
        )}
      </View>
      <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
      <Text style={styles.cardSet} numberOfLines={1}>{item.set_name || 'Unknown set'}</Text>
      <View style={styles.priceRow}>
        <Text style={styles.cardPrice}>{formatPrice(item.estimated_value)}</Text>
        <View style={styles.gradePill}>
          <Text style={styles.gradePillText}>{item.condition_grade}</Text>
        </View>
      </View>
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="dashboard-screen">
      <FlatList
        data={cards}
        keyExtractor={(c) => c.id}
        renderItem={renderItem}
        numColumns={2}
        contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: 120 }}
        columnWrapperStyle={{ gap: SPACING.md, justifyContent: 'space-between' }}
        ItemSeparatorComponent={() => <View style={{ height: SPACING.md }} />}
        ListHeaderComponent={
          <View>
            <View style={styles.headerRow}>
              <View>
                <Text style={styles.greeting}>Welcome back</Text>
                <Text style={styles.email} numberOfLines={1}>{user?.email}</Text>
              </View>
              <Pressable onPress={logout} testID="logout-btn" style={styles.iconBtn}>
                <Ionicons name="log-out-outline" size={20} color={COLORS.onSurfaceSecondary} />
              </Pressable>
            </View>

            <LinearGradient
              colors={['rgba(212,255,0,0.18)', 'rgba(212,255,0,0.02)']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={styles.totalCard}
            >
              <Text style={styles.totalLabel}>Total portfolio value</Text>
              <Text style={styles.totalValue} testID="portfolio-total">{formatPrice(total)}</Text>
              <View style={styles.totalMeta}>
                <Ionicons name="layers-outline" size={14} color={COLORS.onSurfaceTertiary} />
                <Text style={styles.totalMetaText}>{cards.length} card{cards.length === 1 ? '' : 's'} saved</Text>
              </View>
            </LinearGradient>

            <Text style={styles.sectionTitle}>Collection</Text>
          </View>
        }
        ListEmptyComponent={!loading ? renderEmpty : null}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.brand} />}
      />
      {loading && cards.length === 0 && (
        <View style={styles.loader} pointerEvents="none">
          <ActivityIndicator color={COLORS.brand} />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.surface },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: SPACING.md, paddingBottom: SPACING.lg },
  greeting: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.sm, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 },
  email: { color: COLORS.onSurface, fontSize: TYPE.lg, fontWeight: '700', marginTop: 2, maxWidth: 260 },
  iconBtn: { width: 40, height: 40, borderRadius: RADII.pill, backgroundColor: COLORS.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  totalCard: {
    borderRadius: RADII.lg, padding: SPACING.xl, borderWidth: 1, borderColor: 'rgba(212,255,0,0.25)',
    marginBottom: SPACING.xl,
  },
  totalLabel: { color: COLORS.onSurfaceSecondary, fontSize: TYPE.sm, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 },
  totalValue: { color: COLORS.onSurface, fontSize: TYPE.mega, fontWeight: '900', letterSpacing: -1, marginTop: SPACING.sm },
  totalMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: SPACING.sm },
  totalMetaText: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.sm, fontWeight: '500' },
  sectionTitle: { color: COLORS.onSurface, fontSize: TYPE.lg, fontWeight: '700', marginBottom: SPACING.md },
  card: { flex: 1, backgroundColor: COLORS.surfaceSecondary, borderRadius: RADII.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, maxWidth: '49%' },
  cardImgWrap: { aspectRatio: 0.72, borderRadius: RADII.sm, overflow: 'hidden', marginBottom: SPACING.sm, backgroundColor: COLORS.surfaceTertiary },
  cardImg: { width: '100%', height: '100%' },
  cardImgPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  cardName: { color: COLORS.onSurface, fontSize: TYPE.base, fontWeight: '700' },
  cardSet: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.sm, marginTop: 2 },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: SPACING.sm },
  cardPrice: { color: COLORS.brand, fontSize: TYPE.lg, fontWeight: '800', letterSpacing: -0.3 },
  gradePill: { backgroundColor: COLORS.surfaceTertiary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADII.pill },
  gradePillText: { color: COLORS.onSurfaceSecondary, fontSize: 10, fontWeight: '700' },
  empty: { alignItems: 'center', paddingHorizontal: SPACING.xl, paddingTop: SPACING.xxl },
  emptyIcon: { width: 88, height: 88, borderRadius: RADII.pill, backgroundColor: COLORS.brandSoft, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.lg },
  emptyTitle: { color: COLORS.onSurface, fontSize: TYPE.xl, fontWeight: '800', marginBottom: SPACING.xs },
  emptySub: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.base, textAlign: 'center', lineHeight: 20, marginBottom: SPACING.xl },
  emptyCta: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: COLORS.brand, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.md, borderRadius: RADII.pill },
  emptyCtaText: { color: COLORS.onBrand, fontWeight: '800', fontSize: TYPE.base },
  loader: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
});
