import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView,
  Platform, ActivityIndicator, ScrollView,
} from 'react-native';
import { useRouter, Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { auth, createUserWithEmailAndPassword } from '@/src/firebase';
import { COLORS, SPACING, RADII, TYPE } from '@/src/theme';

export default function SignupScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!email.trim() || password.length < 6) {
      setErr('Email required and password ≥ 6 chars'); return;
    }
    setErr(null); setLoading(true);
    try {
      await createUserWithEmailAndPassword(auth, email.trim(), password);
      router.replace('/(tabs)/dashboard');
    } catch (e: any) {
      setErr(e?.message?.replace('Firebase: ', '') ?? 'Signup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} testID="signup-screen">
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.brandRow}>
            <View style={styles.brandDot}><Ionicons name="scan-outline" size={22} color={COLORS.onBrand} /></View>
            <Text style={styles.brandText}>PokéValue</Text>
          </View>

          <Text style={styles.title}>Create account</Text>
          <Text style={styles.subtitle}>Track every card you scan. Free 10 scans, then go Pro.</Text>

          <Text style={styles.label}>Email</Text>
          <TextInput
            testID="signup-email-input"
            style={styles.input}
            placeholder="you@example.com"
            placeholderTextColor={COLORS.onSurfaceTertiary}
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            testID="signup-password-input"
            style={styles.input}
            placeholder="At least 6 characters"
            placeholderTextColor={COLORS.onSurfaceTertiary}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          {err && <Text style={styles.error} testID="signup-error">{err}</Text>}

          <Pressable
            testID="signup-submit-button"
            style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]}
            onPress={submit}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color={COLORS.onBrand} />
              : <Text style={styles.primaryBtnText}>Create account</Text>}
          </Pressable>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account?  </Text>
            <Link href="/(auth)/login" asChild>
              <Pressable testID="signup-go-login">
                <Text style={styles.linkText}>Sign in</Text>
              </Pressable>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.surface },
  scroll: { padding: SPACING.xl, paddingTop: SPACING.xxl, flexGrow: 1 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, marginBottom: SPACING.xxl },
  brandDot: { width: 36, height: 36, borderRadius: RADII.md, backgroundColor: COLORS.brand, alignItems: 'center', justifyContent: 'center' },
  brandText: { color: COLORS.onSurface, fontSize: TYPE.xl, fontWeight: '700', letterSpacing: 0.4 },
  title: { color: COLORS.onSurface, fontSize: TYPE.hero, fontWeight: '800', marginBottom: SPACING.xs },
  subtitle: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.base, marginBottom: SPACING.xxl },
  label: { color: COLORS.onSurfaceSecondary, fontSize: TYPE.sm, marginBottom: SPACING.xs, marginTop: SPACING.md, fontWeight: '600' },
  input: { backgroundColor: COLORS.surfaceTertiary, borderRadius: RADII.md, padding: SPACING.lg, color: COLORS.onSurface, fontSize: TYPE.lg, borderWidth: 1, borderColor: COLORS.border },
  error: { color: COLORS.error, marginTop: SPACING.md, fontSize: TYPE.base },
  primaryBtn: { backgroundColor: COLORS.brand, paddingVertical: SPACING.lg, borderRadius: RADII.md, marginTop: SPACING.xl, alignItems: 'center', minHeight: 52, justifyContent: 'center' },
  primaryBtnText: { color: COLORS.onBrand, fontSize: TYPE.lg, fontWeight: '800', letterSpacing: 0.3 },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: SPACING.xl },
  footerText: { color: COLORS.onSurfaceTertiary, fontSize: TYPE.base },
  linkText: { color: COLORS.brand, fontSize: TYPE.base, fontWeight: '700' },
});
