import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '@/src/auth-context';
import { COLORS } from '@/src/theme';

export default function Index() {
  const { user, loading } = useAuth();

  useEffect(() => {
    // no-op — Redirect drives nav once loading flips
  }, [loading]);

  if (loading) {
    return (
      <View style={styles.center} testID="root-loading">
        <ActivityIndicator color={COLORS.brand} size="large" />
      </View>
    );
  }
  if (!user) return <Redirect href="/(auth)/login" />;
  return <Redirect href="/(tabs)/dashboard" />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface },
});
