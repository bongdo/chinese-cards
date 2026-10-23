import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Appearance } from 'react-native';

import { palettes, type Palette } from './theme';

const KEY = 'chinese.theme';

type Theme = {
  colors: Palette;
  toggle: () => void;
};

const ThemeContext = createContext<Theme>({ colors: palettes.light, toggle: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<'light' | 'dark'>(() =>
    Appearance.getColorScheme() === 'dark' ? 'dark' : 'light',
  );

  useEffect(() => {
    void AsyncStorage.getItem(KEY).then((saved) => {
      if (saved === 'light' || saved === 'dark') setMode(saved);
    });
  }, []);

  const value = useMemo<Theme>(
    () => ({
      colors: palettes[mode],
      toggle: () =>
        setMode((previous) => {
          const next = previous === 'light' ? 'dark' : 'light';
          void AsyncStorage.setItem(KEY, next);
          return next;
        }),
    }),
    [mode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
