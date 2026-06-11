import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Platform, StyleSheet, View } from 'react-native';
import { COLORS } from '@/src/theme';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.brand,
        tabBarInactiveTintColor: COLORS.onSurfaceTertiary,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: Platform.OS === 'android' ? 'rgba(10,11,14,0.96)' : 'transparent',
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
            <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,11,14,0.96)' }]} />
          ),
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Portfolio',
          tabBarIcon: ({ color }) => <Ionicons name="grid-outline" size={22} color={color} />,
          tabBarButtonTestID: 'tab-dashboard',
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Scan',
          tabBarIcon: ({ color }) => <Ionicons name="scan-outline" size={24} color={color} />,
          tabBarButtonTestID: 'tab-scan',
        }}
      />
      <Tabs.Screen
        name="upgrade"
        options={{
          title: 'Upgrade',
          tabBarIcon: ({ color }) => <Ionicons name="flash-outline" size={22} color={color} />,
          tabBarButtonTestID: 'tab-upgrade',
        }}
      />
    </Tabs>
  );
}
