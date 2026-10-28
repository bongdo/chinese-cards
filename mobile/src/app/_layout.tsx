import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Updates from 'expo-updates';
import { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider as AppThemeProvider, useTheme } from '../theme-context';

export default function RootLayout() {
  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;
    void (async () => {
      try {
        const check = await Updates.checkForUpdateAsync();
        if (!check.isAvailable) return;
        await Updates.fetchUpdateAsync();
        await Updates.reloadAsync();
      } catch {
        return;
      }
    })();
  }, []);

  return (
    <SafeAreaProvider>
      <AppThemeProvider>
        <Shell />
      </AppThemeProvider>
    </SafeAreaProvider>
  );
}

function Shell() {
  const { colors } = useTheme();

  const navigationTheme = useMemo(() => {
    const base = colors.dark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        background: colors.paper,
        card: colors.paperDeep,
        text: colors.ink,
        border: colors.line,
        primary: colors.jade,
        notification: colors.clay,
      },
    };
  }, [colors]);

  return (
    <ThemeProvider value={navigationTheme}>
      <StatusBar style={colors.dark ? 'light' : 'dark'} />
      <View style={{ flex: 1, backgroundColor: colors.paper }}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.paper },
            animation: 'fade',
          }}
        />
      </View>
    </ThemeProvider>
  );
}
