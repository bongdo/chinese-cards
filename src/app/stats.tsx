import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Empty, Screen, useUiStyles } from '../components/ui';
import { buildStats } from '../lib/stats';
import { radius, spacing, type Palette } from '../theme';
import { useTheme } from '../theme-context';
import type { Stats } from '../types';

export default function StatsScreen() {
  const ui = useUiStyles();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void (async () => {
        try {
          const data = await buildStats(7);
          if (alive) {
            setStats(data);
            setError('');
          }
        } catch (e) {
          if (alive) setError(e instanceof Error ? e.message : 'Не получилось посчитать статистику');
        }
      })();
      return () => {
        alive = false;
      };
    }, []),
  );

  const max = Math.max(1, ...(stats?.days.map((d) => d.known + d.unknown) ?? [0]));

  return (
    <Screen>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button">
          <Text style={styles.back}>‹ Назад</Text>
        </Pressable>
        <Text style={styles.title}>Статистика</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {!stats && !error ? <Empty title="Считаю…" /> : null}
        {error ? (
          <View style={styles.errorBox}>
            <Text style={ui.muted}>{error}</Text>
          </View>
        ) : null}

        {stats ? (
          <>
            <View style={styles.tiles}>
              <Tile value={String(stats.streak)} label="дней подряд" accent styles={styles} />
              <Tile value={String(stats.due_now)} label="к повторению" styles={styles} />
              <Tile value={String(stats.total)} label="карточек" styles={styles} />
              <Tile
                value={`${Math.round(stats.known_rate * 100)}%`}
                label="«знаю» за 7 дней"
                styles={styles}
              />
            </View>

            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Последние 7 дней</Text>
              <View style={styles.chart}>
                {stats.days.map((day) => (
                  <View key={day.date} style={styles.barCol}>
                    <View style={styles.barStack}>
                      <View
                        style={[
                          styles.bar,
                          {
                            height: `${(day.known / max) * 100}%`,
                            backgroundColor: colors.jade,
                          },
                        ]}
                      />
                      <View
                        style={[
                          styles.bar,
                          {
                            height: `${(day.unknown / max) * 100}%`,
                            backgroundColor: colors.clay,
                          },
                        ]}
                      />
                    </View>
                    <Text style={styles.barLabel}>{day.date.slice(8, 10)}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.legend}>зелёный — знаю, красный — не знаю</Text>
            </View>

            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Слабое место</Text>
              {stats.hardest.length === 0 ? (
                <Text style={ui.muted}>Пока пусто — ни одного провала.</Text>
              ) : (
                stats.hardest.map((card) => (
                  <View key={card.id} style={styles.hardRow}>
                    <Text style={styles.hardFront}>{card.front}</Text>
                    <Text style={styles.hardBack}>{card.back}</Text>
                    <Text style={styles.hardCount}>×{card.lapses}</Text>
                  </View>
                ))
              )}
            </View>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function Tile({
  value,
  label,
  accent,
  styles,
}: {
  value: string;
  label: string;
  accent?: boolean;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={[styles.tile, accent && styles.tileAccent]}>
      <Text style={[styles.tileValue, accent && styles.tileValueAccent]}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
  scroll: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(4),
    paddingHorizontal: spacing(5),
    paddingTop: spacing(3),
  },
  back: {
    color: colors.inkSoft,
    fontSize: 15,
    fontWeight: '600',
  },
  title: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: '700',
  },
  content: {
    padding: spacing(5),
    gap: spacing(4),
    paddingBottom: spacing(10),
  },
  tiles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing(3),
  },
  tile: {
    flexBasis: '46%',
    flexGrow: 1,
    backgroundColor: colors.paperDeep,
    borderRadius: radius.card,
    padding: spacing(4),
    gap: 2,
  },
  tileAccent: {
    backgroundColor: colors.jadeSoft,
  },
  tileValue: {
    fontSize: 30,
    fontWeight: '700',
    color: colors.ink,
  },
  tileValueAccent: {
    color: colors.jade,
  },
  tileLabel: {
    fontSize: 13,
    color: colors.inkSoft,
  },
  panel: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing(4),
    gap: spacing(3),
  },
  panelTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.ink,
  },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing(2),
    height: 120,
  },
  barCol: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing(1.5),
  },
  barStack: {
    width: '70%',
    flex: 1,
    justifyContent: 'flex-end',
  },
  bar: {
    width: '100%',
  },
  barLabel: {
    fontSize: 11,
    color: colors.inkSoft,
  },
  legend: {
    fontSize: 12,
    color: colors.inkSoft,
  },
  hardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(3),
  },
  hardFront: {
    flex: 1,
    fontSize: 15,
    color: colors.ink,
  },
  hardBack: {
    fontSize: 18,
    color: colors.jade,
  },
  hardCount: {
    fontSize: 13,
    color: colors.clay,
    fontVariant: ['tabular-nums'],
  },
  errorBox: {
    backgroundColor: colors.claySoft,
    borderRadius: radius.card,
    padding: spacing(4),
  },
});
}
