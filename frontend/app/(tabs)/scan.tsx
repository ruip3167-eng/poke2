import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, withSequence } from 'react-native-reanimated';

import { api } from '@/src/api';
import { useAuth } from '@/src/auth-context';
import { COLORS, SPACING, RADII, TYPE } from '@/src/theme';

export default function ScanScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [flash, setFlash] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanInfo, setScanInfo] = useState<{ count: number; free_limit: number; is_pro: boolean } | null>(null);
  const [active, setActive] = useState(true);

  // pause / resume camera when leaving the tab to free up the sensor
  useFocusEffect(
    useCallback(() => {
      setActive(true);
      return () => setActive(false);
    }, [])
  );

  // laser sweep animation
  const sweep = useSharedValue(0);
  useEffect(() => {
    sweep.value = withRepeat(
      withSequence(withTiming(1, { duration: 1400 }), withTiming(0, { duration: 0 })),
      -1,
      false,
    );
  }, [sweep]);
  const sweepStyle = useAnimatedStyle(() => ({
    top: `${sweep.value * 100}%`,
    opacity: sweep.value > 0 && sweep.value < 1 ? 1 : 0,
  }));

  useEffect(() => {
    (async () => {
      if (!user) return;
      try {
        const c = await api.getScanCount(user.uid);
        setScanInfo(c);
      } catch {}
    })();
  }, [user]);

  const capture = async () => {
    if (!cameraRef.current || scanning || !user) return;
    setError(null);

    // Check paywall first
    try {
      const c = await api.getScanCount(user.uid);
      setScanInfo(c);
      if (!c.is_pro && c.count >= c.free_limit) {
        router.push('/paywall');
        return;
      }
    } catch {}

    setScanning(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.6, skipProcessing: true });
      if (!photo?.uri) throw new Error('Capture failed');

      // resize + base64 encode
      const manip = await ImageManipulator.manipulateAsync(
        photo.uri,
        [{ resize: { width: 1024 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      const b64 = manip.base64 ?? '';
      if (!b64) throw new Error('Could not encode image');

      const result = await api.analyzeImage(b64, user.uid);

      // Try to fetch price now (best effort) — but Condition screen will fetch too.
      const updated = await api.incrementScan(user.uid).catch(() => null);
      if (updated) setScanInfo(updated);

      router.push({
        pathname: '/condition',
        params: {
          name: result.name,
          set_name: result.set_name ?? '',
          number: result.number ?? '',
        },
      });
    } catch (e: any) {
      setError(e?.message ?? 'Scan failed');
    } finally {
      setScanning(false);
    }
  };

  if (!permission) return <SafeAreaView style={styles.root} />;

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.root} testID="scan-permission">
        <View style={styles.permWrap}>
          <View style={styles.permIcon}><Ionicons name="camera-outline" size={48} color={COLORS.brand} /></View>
          <Text style={styles.permTitle}>Camera access needed</Text>
          <Text style={styles.permSub}>Allow camera to scan and identify your Pokémon cards.</Text>
          <Pressable style={styles.primaryBtn} onPress={requestPermission} testID="scan-grant-permission">
            <Text style={styles.primaryBtnText}>Grant permission</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const remaining = scanInfo ? Math.max(0, scanInfo.free_limit - scanInfo.count) : null;

  return (
    <View style={styles.root} testID="scan-screen">
      {active && (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={flash}
        />
      )}

      {/* dim mask */}
      <View pointerEvents="none" style={styles.mask} />

      {/* card framing brackets */}
      <View style={styles.frame} pointerEvents="none">
        <View style={[styles.corner, styles.cTL]} />
        <View style={[styles.corner, styles.cTR]} />
        <View style={[styles.corner, styles.cBL]} />
        <View style={[styles.corner, styles.cBR]} />
        {scanning && <Animated.View style={[styles.laser, sweepStyle]} />}
      </View>

      <SafeAreaView style={styles.topBar} edges={['top']}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="scan-back">
          <Ionicons name="chevron-back" size={22} color={COLORS.onSurface} />
        </Pressable>
        <View style={styles.counterPill}>
          <Ionicons
            name={scanInfo?.is_pro ? 'flash' : 'flash-outline'}
            size={14}
            color={scanInfo?.is_pro ? COLORS.brand : COLORS.onSurfaceSecondary}
          />
          <Text style={styles.counterText} testID="scan-counter">
            {scanInfo?.is_pro ? 'PRO · Unlimited' : (remaining === null ? '—' : `${remaining} free scans left`)}
          </Text>
        </View>
        <Pressable onPress={() => setFlash((f) => !f)} style={styles.iconBtn} testID="scan-flash-toggle">
          <Ionicons name={flash ? 'flash' : 'flash-off-outline'} size={20} color={flash ? COLORS.brand : COLORS.onSurface} />
        </Pressable>
      </SafeAreaView>

      <Text style={styles.hint} testID="scan-hint">Align the card inside the brackets</Text>

      {error && (
        <View style={styles.errorBanner} testID="scan-error">
          <Ionicons name="alert-circle" size={16} color={COLORS.error} />
          <Text style={styles.errorText} numberOfLines={2}>{error}</Text>
        </View>
      )}

      <SafeAreaView style={styles.bottomBar} edges={['bottom']}>
        <BlurView
          tint="dark"
          intensity={Platform.OS === 'ios' ? 60 : 0}
          style={styles.bottomBlur}
        >
          <Pressable
            testID="scan-shutter"
            style={({ pressed }) => [styles.shutter, pressed && { transform: [{ scale: 0.96 }] }]}
            onPress={capture}
            disabled={scanning}
          >
            <View style={styles.shutterInner}>
              {scanning ? (
                <ActivityIndicator color={COLORS.onBrand} />
              ) : (
                <Ionicons name="scan" size={28} color={COLORS.onBrand} />
              )}
            </View>
          </Pressable>
          <Text style={styles.shutterLabel}>{scanning ? 'Analyzing…' : 'Tap to scan'}</Text>
        </BlurView>
      </SafeAreaView>
    </View>
  );
}

const FRAME_W = '78%';
const FRAME_H = '52%';
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  mask: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10,11,14,0.35)' },
  frame: {
    position: 'absolute', alignSelf: 'center', top: '20%',
    width: FRAME_W as any, height: FRAME_H as any, overflow: 'hidden',
  },
  corner: { position: 'absolute', width: 28, height: 28, borderColor: COLORS.brand },
  cTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 8 },
  cTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 8 },
  cBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 8 },
  cBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 8 },
  laser: { position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: COLORS.brand, shadowColor: COLORS.brand, shadowOpacity: 0.9, shadowRadius: 10 },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: SPACING.lg },
  iconBtn: { width: 40, height: 40, borderRadius: RADII.pill, backgroundColor: 'rgba(20,22,28,0.7)', alignItems: 'center', justifyContent: 'center' },
  counterPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(20,22,28,0.8)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADII.pill, borderWidth: 1, borderColor: COLORS.border },
  counterText: { color: COLORS.onSurfaceSecondary, fontSize: TYPE.sm, fontWeight: '700' },
  hint: { position: 'absolute', alignSelf: 'center', top: '74%', color: COLORS.onSurface, fontSize: TYPE.base, fontWeight: '600', backgroundColor: 'rgba(10,11,14,0.6)', paddingHorizontal: 14, paddingVertical: 6, borderRadius: RADII.pill },
  errorBanner: { position: 'absolute', top: '12%', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(20,22,28,0.92)', borderColor: COLORS.error, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, borderRadius: RADII.md, maxWidth: '85%' },
  errorText: { color: COLORS.onSurface, fontSize: TYPE.sm, flex: 1 },
  bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  bottomBlur: { paddingTop: SPACING.lg, paddingBottom: SPACING.xl, alignItems: 'center', backgroundColor: Platform.OS === 'ios' ? 'transparent' : 'rgba(10,11,14,0.92)' },
  shutter: { width: 88, height: 88, borderRadius: RADII.pill, backgroundColor: 'rgba(212,255,0,0.25)', alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: COLORS.brand },
  shutterInner: { width: 70, height: 70, borderRadius: RADII.pill, backgroundColor: COLORS.brand, alignItems: 'center', justifyContent: 'center' },
  shutterLabel: { color: COLORS.onSurfaceSecondary, fontWeight: '700', marginTop: SPACING.sm, fontSize: TYPE.sm, letterSpacing: 0.3 },
  permWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACING.xl, backgroundColor: COLORS.surface },
  permIcon: { width: 88, height: 88, borderRadius: RADII.pill, backgroundColor: COLORS.brandSoft, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.lg },
  permTitle: { color: COLORS.onSurface, fontSize: TYPE.xl, fontWeight: '800', marginBottom: SPACING.xs },
  permSub: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.base, textAlign: 'center', marginBottom: SPACING.xl, lineHeight: 20 },
  primaryBtn: { backgroundColor: COLORS.brand, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.md, borderRadius: RADII.pill, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: COLORS.onBrand, fontWeight: '800', fontSize: TYPE.base },
});
