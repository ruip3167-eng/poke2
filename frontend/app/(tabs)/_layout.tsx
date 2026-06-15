import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Platform, StyleSheet, View } from 'react-native';
import { COLORS } from '@/src/theme';
import { useT } from '@/src/i18n-context';
import { useIsPro } from '@/src/pro-store';

export default function TabsLayout() {
  const t = useT();
  // Read the synchronous Pro flag. When true we morph the Upgrade tab into a
  // "Pro" status badge (lightning-bolt-filled, neon yellow) that just bounces
  // the user back to the dashboard — never the paywall — so even a stray tap
  // never re-exposes the pricing table.
  const isPro = useIsPro();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.brand,
        tabBarInactiveTintColor: COLORS.onSurfaceTertiary,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: Platform.OS === 'android' ? 'rgba(18,18,18,0.96)' : 'transparent',
          borderTopColor: COLORS.divider,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: 72,
          paddingTop: 8,
          paddingBottom: 14,
        },
        tabBarBackground: () =>
          Platform.OS === 'ios' ? (
            <BlurView tint="dark" intensity={70} style={StyleSheet.absoluteFill} />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(18,18,18,0.96)' }]} />
          ),
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: t.tabs.portfolio,
          tabBarIcon: ({ color }) => <Ionicons name="grid-outline" size={22} color={color} />,
          tabBarButtonTestID: 'tab-dashboard',
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: t.tabs.scan,
          tabBarIcon: ({ color }) => <Ionicons name="scan-outline" size={24} color={color} />,
          tabBarButtonTestID: 'tab-scan',
        }}
      />
      <Tabs.Screen
        name="upgrade"
        options={isPro ? {
          // Pro user: render a non-interactive-looking "Pro Member" badge.
          // The screen itself also bounces back to /dashboard on focus so
          // the paywall pricing table never renders for a paid user.
          title: 'Pro',
          tabBarIcon: ({ focused }) => (
            <Ionicons name="flash" size={22} color={focused ? COLORS.brand : COLORS.brand} />
          ),
          tabBarActiveTintColor: COLORS.brand,
          tabBarInactiveTintColor: COLORS.brand,
          tabBarButtonTestID: 'tab-pro-badge',
        } : {
          title: t.tabs.upgrade,
          tabBarIcon: ({ color }) => <Ionicons name="flash-outline" size={22} color={color} />,
          tabBarButtonTestID: 'tab-upgrade',
        }}
      />
    </Tabs>
  );
}
