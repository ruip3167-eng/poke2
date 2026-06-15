/**
 * Manual card search — fallback when the AI scanner fails to identify a card.
 *
 * Mirrors the Ludex UX: the user picks a set from a searchable list and
 * types the card number printed on the bottom of the card. We hit
 * /api/cards/find on the backend, which proxies pokemontcg.io and returns
 * the same PriceResponse shape as a scanned card. From there we route to
 * the existing /condition screen so the rest of the flow (condition
 * grading + card-detail + Add to portfolio) is unchanged.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator,
  TextInput, FlatList, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api, type SetSummary } from '@/src/api';
import { COLORS, SPACING, RADII, TYPE } from '@/src/theme';
import { useT } from '@/src/i18n-context';

export default function ManualSearchScreen() {
  const router = useRouter();
  const t = useT();

  // When opened from /card-detail's "Fix card" CTA we receive the user's
  // existing condition grade + multiplier so we can drop them straight back
  // into the detail screen with the new card data + their preserved grading.
  const params = useLocalSearchParams<{
    keepCondition?: string;
    condition_grade?: string;
    condition_multiplier?: string;
    condition_json?: string;
  }>();
  const keepCondition = params.keepCondition === '1';
  const existingGrade = params.condition_grade ?? 'Mint';
  const existingMult = Number(params.condition_multiplier ?? '1') || 1;
  const existingCondJson = params.condition_json ?? '';

  const [sets, setSets] = useState<SetSummary[] | null>(null);
  const [setsError, setSetsError] = useState(false);
  const [selectedSet, setSelectedSet] = useState<SetSummary | null>(null);
  const [number, setNumber] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.listSets()
      .then((data) => { if (!cancelled) setSets(data); })
      .catch(() => { if (!cancelled) setSetsError(true); });
    return () => { cancelled = true; };
  }, []);

  const filteredSets = useMemo(() => {
    if (!sets) return [];
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return sets;
    return sets.filter((s) =>
      s.name.toLowerCase().includes(q) ||
      (s.series?.toLowerCase() ?? '').includes(q) ||
      s.id.toLowerCase().includes(q),
    );
  }, [sets, pickerQuery]);

  const onSearch = async () => {
    setErr(null);
    if (!selectedSet) { setErr(t.manualSearch.pickSetFirst); return; }
    const num = number.trim();
    if (!num) { setErr(t.manualSearch.enterNumber); return; }
    setSearching(true);
    try {
      const found = await api.findCard({ set_id: selectedSet.id, number: num });
      if (keepCondition) {
        // Coming from card-detail "Fix card" flow — reapply the user's
        // existing condition multiplier to the new market price and drop
        // them straight back on the detail screen with the corrected data.
        const apiMarket = found.recommended_eur ?? found.cardmarket_trend
          ?? found.cardmarket_average ?? found.tcgplayer_market ?? null;
        const isFallback = apiMarket === null || apiMarket === 0;
        const market = isFallback ? 100 : (apiMarket as number);
        const estimated = market * existingMult;
        router.replace({
          pathname: '/card-detail',
          params: {
            name: found.name,
            set_name: found.set_name ?? '',
            number: found.number ?? num,
            image_url: found.image_url ?? '',
            market_price: String(market),
            tcgplayer_market: String(found.tcgplayer_market ?? ''),
            tcgplayer_holofoil_market: String(found.tcgplayer_holofoil_market ?? ''),
            tcgplayer_normal_market: String(found.tcgplayer_normal_market ?? ''),
            cardmarket_average: String(found.cardmarket_average ?? ''),
            cardmarket_trend: String(found.cardmarket_trend ?? ''),
            price_source: found.price_source ?? '',
            estimated_value: String(estimated),
            condition_grade: existingGrade,
            condition_multiplier: String(existingMult),
            condition_json: existingCondJson,
            mode: 'new',
            is_fallback_price: isFallback ? '1' : '0',
            card_id_api: found.card_id ?? '',
          },
        });
      } else {
        // Default flow (entry from scan tab in older versions): route through
        // the condition screen so the user can grade the card from scratch.
        router.replace({
          pathname: '/condition',
          params: {
            name: found.name,
            set_name: found.set_name ?? '',
            number: found.number ?? num,
          },
        });
      }
    } catch (e: any) {
      const status = (e as { status?: number })?.status;
      const msg = e?.message ?? '';
      setErr(status === 404 || msg.startsWith('HTTP 404') ? t.manualSearch.notFound : (msg || t.manualSearch.notFound));
    } finally {
      setSearching(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} testID="manual-search-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="manual-search-close">
          <Ionicons name="close" size={20} color={COLORS.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>{t.manualSearch.title}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.subtitle}>{t.manualSearch.subtitle}</Text>

        {/* Set picker */}
        <Text style={styles.label}>{t.manualSearch.setLabel}</Text>
        <Pressable
          testID="manual-set-picker"
          onPress={() => setPickerOpen(true)}
          style={[styles.input, styles.pickerBtn]}
          disabled={!sets || sets.length === 0}
        >
          {sets === null && !setsError ? (
            <View style={styles.pickerLoading}>
              <ActivityIndicator size="small" color={COLORS.brand} />
              <Text style={styles.pickerLoadingText}>{t.manualSearch.loadingSets}</Text>
            </View>
          ) : setsError || sets?.length === 0 ? (
            <Text style={styles.pickerPlaceholder}>{t.manualSearch.noSets}</Text>
          ) : selectedSet ? (
            <View style={styles.pickerValue}>
              <Text style={styles.pickerName} numberOfLines={1}>{selectedSet.name}</Text>
              {selectedSet.series ? (
                <Text style={styles.pickerSeries} numberOfLines={1}>{selectedSet.series}</Text>
              ) : null}
            </View>
          ) : (
            <Text style={styles.pickerPlaceholder}>{t.manualSearch.setPlaceholder}</Text>
          )}
          <Ionicons name="chevron-down" size={18} color={COLORS.onSurfaceTertiary} />
        </Pressable>

        {/* Number input */}
        <Text style={[styles.label, { marginTop: SPACING.lg }]}>{t.manualSearch.numberLabel}</Text>
        <TextInput
          testID="manual-number-input"
          value={number}
          onChangeText={setNumber}
          placeholder={t.manualSearch.numberPlaceholder}
          placeholderTextColor={COLORS.onSurfaceTertiary}
          style={styles.input}
          keyboardType="default"
          returnKeyType="search"
          onSubmitEditing={onSearch}
          autoCapitalize="none"
          autoCorrect={false}
        />

        {err ? <Text style={styles.errText} testID="manual-search-error">{err}</Text> : null}

        <Pressable
          testID="manual-search-submit"
          onPress={onSearch}
          disabled={searching || !selectedSet}
          style={[styles.cta, (searching || !selectedSet) && { opacity: 0.6 }]}
        >
          {searching ? (
            <View style={styles.ctaInner}>
              <ActivityIndicator size="small" color={COLORS.onBrand} />
              <Text style={styles.ctaText}>{t.manualSearch.searching}</Text>
            </View>
          ) : (
            <View style={styles.ctaInner}>
              <Ionicons name="search" size={18} color={COLORS.onBrand} />
              <Text style={styles.ctaText}>{t.manualSearch.search}</Text>
            </View>
          )}
        </Pressable>
      </ScrollView>

      {/* Set picker modal */}
      <Modal visible={pickerOpen} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setPickerOpen(false)}>
        <SafeAreaView style={styles.modalRoot}>
          <View style={styles.modalHeader}>
            <Pressable onPress={() => setPickerOpen(false)} style={styles.iconBtn} testID="manual-set-picker-close">
              <Ionicons name="close" size={20} color={COLORS.onSurface} />
            </Pressable>
            <Text style={styles.headerTitle}>{t.manualSearch.setLabel}</Text>
            <View style={{ width: 40 }} />
          </View>
          <View style={styles.searchBarWrap}>
            <Ionicons name="search" size={16} color={COLORS.onSurfaceTertiary} />
            <TextInput
              value={pickerQuery}
              onChangeText={setPickerQuery}
              placeholder={t.manualSearch.setSearchPlaceholder}
              placeholderTextColor={COLORS.onSurfaceTertiary}
              style={styles.searchBar}
              autoCorrect={false}
              autoCapitalize="none"
              testID="manual-set-search-input"
            />
            {pickerQuery ? (
              <Pressable onPress={() => setPickerQuery('')}>
                <Ionicons name="close-circle" size={18} color={COLORS.onSurfaceTertiary} />
              </Pressable>
            ) : null}
          </View>
          <FlatList
            data={filteredSets}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                testID={`manual-set-option-${item.id}`}
                onPress={() => { setSelectedSet(item); setPickerOpen(false); setPickerQuery(''); setErr(null); }}
                style={({ pressed }) => [styles.setRow, pressed && { backgroundColor: COLORS.surfaceTertiary }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.setRowName} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.setRowMeta} numberOfLines={1}>
                    {[item.series, item.release_date].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                {selectedSet?.id === item.id && (
                  <Ionicons name="checkmark-circle" size={20} color={COLORS.brand} />
                )}
              </Pressable>
            )}
            ListEmptyComponent={() => (
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyText}>{t.manualSearch.noSets}</Text>
              </View>
            )}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border,
  },
  iconBtn: { width: 40, height: 40, borderRadius: RADII.pill, backgroundColor: COLORS.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: COLORS.onSurface, fontWeight: '900', fontSize: TYPE.lg },
  scroll: { padding: SPACING.lg, paddingBottom: SPACING.xxxl },
  subtitle: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.sm, marginBottom: SPACING.lg, lineHeight: 18 },
  label: { color: COLORS.onSurfaceSecondary, fontSize: TYPE.xs, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: SPACING.sm },
  input: {
    backgroundColor: COLORS.surfaceSecondary,
    borderRadius: RADII.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 14,
    color: COLORS.onSurface,
    fontSize: TYPE.base,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  pickerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: 52,
  },
  pickerLoading: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  pickerLoadingText: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.base },
  pickerPlaceholder: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.base },
  pickerValue: { flex: 1, marginRight: SPACING.sm },
  pickerName: { color: COLORS.onSurface, fontWeight: '700', fontSize: TYPE.base },
  pickerSeries: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.xs, marginTop: 2 },
  errText: { color: COLORS.error, fontSize: TYPE.sm, marginTop: SPACING.md },
  cta: {
    marginTop: SPACING.xl,
    backgroundColor: COLORS.brand,
    borderRadius: RADII.pill,
    paddingVertical: 16,
    alignItems: 'center',
  },
  ctaInner: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  ctaText: { color: COLORS.onBrand, fontWeight: '900', fontSize: TYPE.base, letterSpacing: 0.3 },
  // Modal
  modalRoot: { flex: 1, backgroundColor: COLORS.surface },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border,
  },
  searchBarWrap: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    margin: SPACING.lg,
    paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.surfaceSecondary,
    borderRadius: RADII.md,
    borderWidth: 1, borderColor: COLORS.border,
  },
  searchBar: { flex: 1, paddingVertical: 12, color: COLORS.onSurface, fontSize: TYPE.base },
  setRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border,
  },
  setRowName: { color: COLORS.onSurface, fontWeight: '700', fontSize: TYPE.base },
  setRowMeta: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.xs, marginTop: 2 },
  emptyWrap: { padding: SPACING.xl, alignItems: 'center' },
  emptyText: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.sm },
});
