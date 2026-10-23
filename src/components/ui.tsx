import { useMemo, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { radius, spacing, type Palette } from '../theme';
import { useTheme } from '../theme-context';

export const fonts = {
  hanzi: Platform.select({ ios: 'Songti SC', android: 'serif', default: 'serif' }),
} as const;

export function useUiStyles() {
  const { colors } = useTheme();
  return useMemo(() => makeStyles(colors), [colors]);
}

export function Screen({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <SafeAreaView
      style={[{ flex: 1, backgroundColor: colors.paper }, style]}
      edges={['top', 'left', 'right']}
    >
      {children}
    </SafeAreaView>
  );
}

export function PrimaryButton({
  label,
  hint,
  onPress,
  variant = 'jade',
  disabled,
}: {
  label: string;
  hint?: string;
  onPress: () => void;
  variant?: 'jade' | 'clay';
  disabled?: boolean;
}) {
  const styles = useUiStyles();
  const jade = variant === 'jade';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hint ? `${label}, ${hint}` : label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        jade ? styles.buttonJade : styles.buttonClay,
        pressed && styles.buttonPressed,
        disabled && styles.buttonDisabled,
      ]}
    >
      <Text style={[styles.buttonLabel, jade ? styles.labelJade : styles.labelClay]}>{label}</Text>
      {hint ? (
        <Text style={[styles.buttonHint, jade ? styles.labelJade : styles.labelClay]}>{hint}</Text>
      ) : null}
    </Pressable>
  );
}

export function Pill({ text, tone = 'neutral' }: { text: string; tone?: 'neutral' | 'jade' | 'clay' }) {
  const styles = useUiStyles();
  const { colors } = useTheme();
  const background =
    tone === 'jade' ? colors.jadeSoft : tone === 'clay' ? colors.claySoft : colors.paperDeep;
  const foreground =
    tone === 'jade' ? colors.jade : tone === 'clay' ? colors.clay : colors.inkSoft;
  return (
    <View style={[styles.pill, { backgroundColor: background }]}>
      <Text style={[styles.pillText, { color: foreground }]}>{text}</Text>
    </View>
  );
}

export function ProgressBar({ value }: { value: number }) {
  const styles = useUiStyles();
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${clamped * 100}%` }]} />
    </View>
  );
}

export function Loading({ label = 'Загружаю…' }: { label?: string }) {
  const styles = useUiStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.jade} />
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

export function Empty({ title, text }: { title: string; text?: string }) {
  const styles = useUiStyles();
  return (
    <View style={styles.center}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {text ? <Text style={styles.muted}>{text}</Text> : null}
    </View>
  );
}

function makeStyles(c: Palette) {
  return StyleSheet.create({
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing(3),
      padding: spacing(6),
    },
    muted: { color: c.inkSoft, fontSize: 15, textAlign: 'center', lineHeight: 22 },
    emptyTitle: { color: c.ink, fontSize: 22, fontWeight: '600', textAlign: 'center' },
    button: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing(4),
      paddingHorizontal: spacing(4),
      borderRadius: radius.button,
      gap: 2,
    },
    buttonJade: { backgroundColor: c.jade },
    buttonClay: { backgroundColor: c.claySoft, borderWidth: 1, borderColor: c.clay },
    buttonPressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
    buttonDisabled: { opacity: 0.4 },
    buttonLabel: { fontSize: 18, fontWeight: '600' },
    buttonHint: { fontSize: 12, opacity: 0.75 },
    labelJade: { color: c.onJade },
    labelClay: { color: c.clay },
    pill: {
      paddingHorizontal: spacing(2.5),
      paddingVertical: spacing(1),
      borderRadius: radius.pill,
      backgroundColor: c.paperDeep,
    },
    pillText: { fontSize: 13, fontWeight: '600', color: c.inkSoft },
    progressTrack: { height: 6, borderRadius: radius.pill, backgroundColor: c.paperDeep, overflow: 'hidden' },
    progressFill: { height: '100%', borderRadius: radius.pill, backgroundColor: c.jade },
  });
}
