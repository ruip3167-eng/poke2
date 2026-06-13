import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator,
  RefreshControl, TextInput, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { api, CardRecord } from '@/src/api';
import { useAuth } from '@/src/auth-context';
import { auth as fbAuth, fbSignOut } from '@/src/firebase';
import { COLORS, SPACING, RADII, TYPE } from '@/src/theme';
import { formatPrice } from '@/src/grading';
import { useI18n } from '@/src/i18n-context';

type FilterKey = 'recent' | 'value' | 'Mint' | 'Near Mint' | 'Lightly Played' | 'Played' | 'Poor';

const FILTERS_BASE: { key: FilterKey; labelKey: 'recent' | 'value' | null; condLabel?: string; icon?: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'recent', labelKey: 'recent', icon: 'time-outline' },
  { key: 'value',  labelKey: 'value',   icon: 'trending-up-outline' },
  { key: 'Mint',          labelKey: null, condLabel: 'Mint' },
  { key: 'Near Mint',     labelKey: null, condLabel: 'Near Mint' },
  { key: 'Lightly Played', labelKey: null, condLabel: 'Lightly Played' },
  { key: 'Played',        labelKey: null, condLabel: 'Played' },
  { key: 'Poor',          labelKey: null, condLabel: 'Poor' },
];

// Grade → colour ramp (green → red).
const GRADE_COLORS: Record<string, string> = {
  'Mint':            '#22C55E',
  'Near Mint':       '#84CC16',
  'Lightly Played':  '#F59E0B',
  'Played':          '#FB923C',
  'Poor':            '#EF4444',
};
const GRADE_ORDER = ['Mint', 'Near Mint', 'Lightly Played', 'Played', 'Poor'];

export default function DashboardScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const { t, locale, toggleLocale } = useI18n();
  const [cards, setCards] = useState<CardRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>('recent');

  // Localised filter chips. The condition labels stay literal (Mint / Near
  // Mint / …) because they are TCG grading terms recognized across markets.
  const FILTERS = useMemo(
    () =>
      FILTERS_BASE.map((f) => ({
        ...f,
        label:
          f.labelKey === 'recent'
            ? t.dashboard.filterRecent
            : f.labelKey === 'value'
              ? t.dashboard.filterValue
              : (f.condLabel as string),
      })),
    [t.dashboard.filterRecent, t.dashboard.filterValue],
  );

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

  const total = useMemo(
    () => cards.reduce((s, c) => s + (c.estimated_value || 0), 0),
    [cards],
  );

  // Grade distribution for the condition chart.
  const distribution = useMemo(() => {
    const counts: Record<string, number> = {};
    cards.forEach((c) => { counts[c.condition_grade] = (counts[c.condition_grade] ?? 0) + 1; });
    return GRADE_ORDER
      .map((g) => ({ grade: g, count: counts[g] ?? 0 }))
      .filter((d) => d.count > 0);
  }, [cards]);

  // Filtered + sorted view.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = cards;
    if (q) {
      rows = rows.filter((c) =>
        c.name.toLowerCase().includes(q) || (c.set_name ?? '').toLowerCase().includes(q),
      );
    }
    if (filter !== 'recent' && filter !== 'value') {
      rows = rows.filter((c) => c.condition_grade === filter);
    }
    rows = [...rows];
    if (filter === 'value') {
      rows.sort((a, b) => (b.estimated_value || 0) - (a.estimated_value || 0));
    } else {
      // 'recent' or condition filter → sort by created_at desc
      rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    }
    return rows;
  }, [cards, query, filter]);

  const logout = async () => {
    await fbSignOut(fbAuth);
    router.replace('/(auth)/login');
  };

  const renderRow = ({ item }: { item: CardRecord }) => (
    <Pressable
      testID={`portfolio-card-${item.id}`}
      style={styles.row}
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
      <View style={styles.rowImgWrap}>
        {item.image_url ? (
          <Image source={{ uri: item.image_url }} style={styles.rowImg} contentFit="cover" />
        ) : (
          <View style={[styles.rowImg, styles.rowImgPlaceholder]}>
            <Ionicons name="image-outline" size={20} color={COLORS.onSurfaceTertiary} />
          </View>
        )}
      </View>
      <View style={styles.rowInfo}>
        <Text style={styles.rowName} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.rowSet} numberOfLines={1}>{item.set_name || t.dashboard.unknownSet}</Text>
        <View style={styles.gradeChip}>
          <View style={[styles.gradeDot, { backgroundColor: GRADE_COLORS[item.condition_grade] ?? COLORS.onSurfaceTertiary }]} />
          <Text style={styles.gradeChipText}>{item.condition_grade}</Text>
        </View>
      </View>
      <Text style={styles.rowPrice}>{formatPrice(item.estimated_value)}</Text>
    </Pressable>
  );

  const renderEmpty = () => (
    <View style={styles.empty} testID="portfolio-empty">
      <View style={styles.emptyIcon}>
        <Ionicons name="albums-outline" size={48} color={COLORS.brand} />
      </View>
      <Text style={styles.emptyTitle}>
        {cards.length === 0 ? t.dashboard.emptyTitle : t.dashboard.noResults}
      </Text>
      <Text style={styles.emptySub}>
        {cards.length === 0 ? t.dashboard.emptySub : t.dashboard.noResultsSub}
      </Text>
      {cards.length === 0 && (
        <Pressable
          testID="empty-scan-cta"
          style={styles.emptyCta}
          onPress={() => router.push('/(tabs)/scan')}
        >
          <Ionicons name="scan-outline" size={18} color={COLORS.onBrand} />
          <Text style={styles.emptyCtaText}>{t.dashboard.scanCard}</Text>
        </Pressable>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="dashboard-screen">
      <FlatList
        data={visible}
        keyExtractor={(c) => c.id}
        renderItem={renderRow}
        contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: 120 }}
        ItemSeparatorComponent={() => <View style={{ height: SPACING.md }} />}
        ListHeaderComponent={
          <View>
            {/* Header */}
            <View style={styles.headerRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.greeting}>{t.dashboard.greeting}</Text>
                <Text style={styles.email} numberOfLines={1}>{user?.email}</Text>
              </View>
              <View style={styles.headerActions}>
                <Pressable
                  onPress={toggleLocale}
                  testID="locale-toggle"
                  style={styles.flagBtn}
                  accessibilityLabel={locale === 'pt' ? 'Switch to English' : 'Mudar para Português'}
                >
                  <Text style={styles.flagEmoji}>{locale === 'pt' ? '🇵🇹' : '🇬🇧'}</Text>
                </Pressable>
                <Pressable onPress={logout} testID="logout-btn" style={styles.iconBtn}>
                  <Ionicons name="log-out-outline" size={20} color={COLORS.onSurfaceSecondary} />
                </Pressable>
              </View>
            </View>

            {/* Total value card */}
            <View style={styles.totalCard}>
              <Text style={styles.totalLabel}>{t.dashboard.totalLabel}</Text>
              <Text style={styles.totalValue} testID="portfolio-total">{formatPrice(total)}</Text>
              <View style={styles.totalMeta}>
                <Ionicons name="layers-outline" size={14} color={COLORS.onSurfaceTertiary} />
                <Text style={styles.totalMetaText}>
                  {t.dashboard.cardsSaved(cards.length)}
                </Text>
              </View>
            </View>

            {/* Condition analysis */}
            {cards.length > 0 && (
              <View style={styles.analysisBlock} testID="condition-analysis">
                <Text style={styles.section}>{t.dashboard.conditionAnalysis}</Text>
                <View style={styles.distBar}>
                  {distribution.map((d) => {
                    const pct = (d.count / cards.length) * 100;
                    return (
                      <View
                        key={d.grade}
                        style={{
                          width: `${pct}%`,
                          backgroundColor: GRADE_COLORS[d.grade],
                        }}
                      />
                    );
                  })}
                </View>
                <View style={styles.legend}>
                  {distribution.map((d) => (
                    <View key={d.grade} style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: GRADE_COLORS[d.grade] }]} />
                      <Text style={styles.legendLabel}>{d.grade}</Text>
                      <Text style={styles.legendPct}>
                        {Math.round((d.count / cards.length) * 100)}%
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Collection header + search */}
            <Text style={styles.section}>{t.dashboard.collection}</Text>

            <View style={styles.searchWrap}>
              <Ionicons name="search-outline" size={18} color={COLORS.onSurfaceTertiary} />
              <TextInput
                testID="search-input"
                placeholder={t.dashboard.searchPlaceholder}
                placeholderTextColor={COLORS.onSurfaceTertiary}
                value={query}
                onChangeText={setQuery}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.searchInput}
              />
              {query.length > 0 && (
                <Pressable onPress={() => setQuery('')} testID="search-clear" hitSlop={8}>
                  <Ionicons name="close-circle" size={18} color={COLORS.onSurfaceTertiary} />
                </Pressable>
              )}
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chipRow}
              contentContainerStyle={styles.chipRowContent}
            >
              {FILTERS.map((f) => {
                const active = filter === f.key;
                return (
                  <Pressable
                    key={f.key}
                    testID={`filter-${f.key}`}
                    onPress={() => setFilter(f.key)}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    {f.icon && (
                      <Ionicons
                        name={f.icon}
                        size={14}
                        color={active ? COLORS.brand : COLORS.onSurfaceTertiary}
                      />
                    )}
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {f.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
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

  // Header
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: SPACING.md, paddingBottom: SPACING.lg },
  greeting: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.sm, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 },
  email: { color: COLORS.onSurface, fontSize: TYPE.lg, fontWeight: '700', marginTop: 2, maxWidth: 260 },
  iconBtn: { width: 40, height: 40, borderRadius: RADII.pill, backgroundColor: COLORS.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  headerActions: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'center' },
  flagBtn: { width: 40, height: 40, borderRadius: RADII.pill, backgroundColor: COLORS.surfaceTertiary, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  flagEmoji: { fontSize: 22, lineHeight: 26 },

  // Total card
  totalCard: {
    backgroundColor: COLORS.surfaceTertiary,
    borderRadius: RADII.md,
    padding: SPACING.xl,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.lg,
  },
  totalLabel: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.sm, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  totalValue: {
    color: COLORS.brand,
    fontSize: 52,
    fontWeight: '900',
    letterSpacing: -1.2,
    marginTop: SPACING.sm,
    textShadowColor: 'rgba(255,230,0,0.35)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 18,
  },
  totalMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: SPACING.sm },
  totalMetaText: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.sm, fontWeight: '500' },

  // Analysis
  analysisBlock: { marginBottom: SPACING.xl },
  distBar: {
    flexDirection: 'row',
    height: 14,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: COLORS.surfaceSecondary,
    marginBottom: SPACING.md,
  },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.md, rowGap: SPACING.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 999 },
  legendLabel: { color: COLORS.onSurfaceSecondary, fontSize: TYPE.sm, fontWeight: '600' },
  legendPct: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.sm, fontWeight: '700', marginLeft: 2 },

  // Section
  section: { color: COLORS.onSurface, fontSize: TYPE.lg, fontWeight: '700', marginBottom: SPACING.md },

  // Search
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.surfaceSecondary,
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    height: 48,
    marginBottom: SPACING.md,
  },
  searchInput: {
    flex: 1,
    color: COLORS.onSurface,
    fontSize: TYPE.base,
    paddingVertical: 0,
  },

  // Chip row (horizontal scroll, never wraps)
  chipRow: { height: 56, marginBottom: SPACING.md },
  chipRowContent: { gap: SPACING.sm, paddingVertical: SPACING.sm, paddingRight: SPACING.lg },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
    height: 36,
    paddingHorizontal: SPACING.md,
    borderRadius: RADII.pill,
    backgroundColor: COLORS.surfaceSecondary,
    borderWidth: 1.5,
    borderColor: COLORS.border,
  },
  chipActive: {
    backgroundColor: 'transparent',
    borderColor: COLORS.brand,
  },
  chipText: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.sm, fontWeight: '700' },
  chipTextActive: { color: COLORS.brand },

  // Card rows (list, not grid)
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    backgroundColor: COLORS.surfaceSecondary,
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
  },
  rowImgWrap: {
    width: 56,
    height: 78,
    borderRadius: RADII.sm,
    overflow: 'hidden',
    backgroundColor: COLORS.surfaceTertiary,
  },
  rowImg: { width: '100%', height: '100%' },
  rowImgPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  rowInfo: { flex: 1, gap: 2 },
  rowName: { color: COLORS.onSurface, fontSize: TYPE.base, fontWeight: '700' },
  rowSet: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.sm, marginTop: 1 },
  gradeChip: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADII.pill,
    marginTop: 4,
  },
  gradeDot: { width: 6, height: 6, borderRadius: 999 },
  gradeChipText: { color: COLORS.onSurfaceSecondary, fontSize: 10, fontWeight: '700' },
  rowPrice: {
    color: COLORS.brand,
    fontSize: TYPE.lg,
    fontWeight: '900',
    letterSpacing: -0.3,
  },

  // Empty
  empty: { alignItems: 'center', paddingHorizontal: SPACING.xl, paddingTop: SPACING.xxl },
  emptyIcon: { width: 88, height: 88, borderRadius: RADII.pill, backgroundColor: COLORS.brandSoft, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.lg },
  emptyTitle: { color: COLORS.onSurface, fontSize: TYPE.xl, fontWeight: '800', marginBottom: SPACING.xs },
  emptySub: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.base, textAlign: 'center', lineHeight: 20, marginBottom: SPACING.xl },
  emptyCta: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: COLORS.brand, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.md, borderRadius: RADII.pill },
  emptyCtaText: { color: COLORS.onBrand, fontWeight: '800', fontSize: TYPE.base },

  loader: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
});
