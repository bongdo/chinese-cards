import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton, Screen, fonts, useUiStyles } from '../components/ui';
import { ApiError } from '../lib/api';
import { loadConfig } from '../lib/config';
import { dueSummary } from '../lib/db';
import { flush } from '../lib/outbox';
import { sync } from '../lib/sync';
import { radius, spacing, type Palette } from '../theme';
import { useTheme } from '../theme-context';

type LoadState = 'loading' | 'ready' | 'error';

export default function HomeScreen() {
  const ui = useUiStyles();
  const { colors, toggle } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [summary, setSummary] = useState({ total: 0, due: 0 });
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (mode: 'load' | 'refresh' = 'load') => {
    if (mode === 'refresh') setRefreshing(true);
    const config = await loadConfig();

    try {
      await flush(config);
      await sync(config);
      setSummary(await dueSummary());
      setState('ready');
      setError('');
    } catch (e) {
      const local = await dueSummary();
      if (local.total > 0) {
        setSummary(local);
        setState('ready');
      } else {
        const unauthorized = e instanceof ApiError && e.status === 401;
        setError(
          unauthorized
            ? 'Приложение устарело: закрой его полностью и открой снова'
            : e instanceof Error
              ? e.message
              : 'Не получилось загрузить карточки',
        );
        setState('error');
      }
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        setSummary(await dueSummary());
        await load();
      })();
    }, [load]),
  );

  return (
    <Screen>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load('refresh')}
            tintColor={colors.jade}
            colors={[colors.jade]}
          />
        }
      >
        <View style={styles.hero}>
          <Pressable
            onPress={toggle}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={colors.dark ? 'Светлая тема' : 'Тёмная тема'}
            style={styles.themeButton}
          >
            <Text style={styles.themeIcon}>{colors.dark ? '☀' : '☾'}</Text>
          </Pressable>
          <Text style={styles.hanzi}>汉语</Text>
          <Text style={styles.subtitle}>карточки · рус → 中文</Text>
        </View>

        <View style={styles.summary}>
          <Text style={styles.summaryNumber}>{summary.due}</Text>
          <Text style={styles.summaryLabel}>
            {summary.due === 0 ? 'всё повторено, можно отдыхать' : 'карточек ждут повторения'}
          </Text>
          <Text style={styles.summaryMeta}>всего {summary.total} карточек</Text>
        </View>

        {state === 'loading' ? <Text style={ui.muted}>Загружаю карточки…</Text> : null}

        {state === 'error' ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorTitle}>Сервер не отвечает</Text>
            <Text style={ui.muted}>{error}</Text>
            <Pressable onPress={() => void load()} style={styles.retry}>
              <Text style={styles.retryLabel}>Ещё раз</Text>
            </Pressable>
          </View>
        ) : null}

        {summary.due > 0 ? (
          <View style={styles.buttonRow}>
            <PrimaryButton
              label="Учить всё"
              hint={`${summary.due} карточек`}
              onPress={() => router.push({ pathname: '/study', params: { title: 'Всё подряд' } })}
            />
          </View>
        ) : null}

        <View style={styles.nav}>
          <Pressable style={styles.navItem} onPress={() => router.push('/cards')}>
            <Text style={styles.navLabel}>Карточки</Text>
          </Pressable>
          <Pressable style={styles.navItem} onPress={() => router.push('/stats')}>
            <Text style={styles.navLabel}>Статистика</Text>
          </Pressable>
        </View>
      </ScrollView>
    </Screen>
  );
}

function makeStyles(c: Palette) {
  return StyleSheet.create({
    scroll: { flex: 1 },
    content: { padding: spacing(5), paddingBottom: spacing(10), gap: spacing(3) },
    hero: { alignItems: 'center', paddingTop: spacing(2), paddingBottom: spacing(3) },
    themeButton: { position: 'absolute', right: 0, top: 0, padding: spacing(2) },
    themeIcon: { fontSize: 22, color: c.inkSoft },
    hanzi: { fontFamily: fonts.hanzi, fontSize: 64, color: c.ink, letterSpacing: 6 },
    subtitle: {
      color: c.inkSoft,
      fontSize: 14,
      letterSpacing: 1.5,
      textTransform: 'uppercase',
    },
    summary: { backgroundColor: c.jadeSoft, borderRadius: radius.card, padding: spacing(5), gap: spacing(1) },
    summaryNumber: { fontSize: 40, fontWeight: '700', color: c.jade },
    summaryLabel: { fontSize: 16, color: c.ink },
    summaryMeta: { fontSize: 13, color: c.inkSoft },
    errorBox: { backgroundColor: c.claySoft, borderRadius: radius.card, padding: spacing(5), gap: spacing(3) },
    errorTitle: { fontSize: 18, fontWeight: '600', color: c.clay },
    retry: {
      alignSelf: 'flex-start',
      backgroundColor: c.clay,
      paddingHorizontal: spacing(4),
      paddingVertical: spacing(2.5),
      borderRadius: radius.pill,
    },
    retryLabel: { color: c.onJade, fontWeight: '600' },
    buttonRow: { flexDirection: 'row' },
    nav: { flexDirection: 'row', gap: spacing(3), marginTop: spacing(4) },
    navItem: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: spacing(3.5),
      borderRadius: radius.button,
      borderWidth: 1,
      borderColor: c.line,
    },
    navLabel: { color: c.inkSoft, fontWeight: '600', fontSize: 15 },
  });
}
