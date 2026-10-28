import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Screen, useUiStyles } from '../components/ui';
import { allCards, cachedCount } from '../lib/db';
import { loadConfig } from '../lib/config';
import { sync } from '../lib/sync';
import { radius, spacing, type Palette } from '../theme';
import { useTheme } from '../theme-context';
import type { Card } from '../types';

export default function CardsScreen() {
  const ui = useUiStyles();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [query, setQuery] = useState('');
  const queryRef = useRef('');
  const [cards, setCards] = useState<Card[]>([]);
  const [total, setTotal] = useState(0);

  const load = useCallback(async (search: string) => {
    setCards(await allCards(search));
    setTotal(await cachedCount());
  }, []);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void (async () => {
        await load(queryRef.current);
        const config = await loadConfig();
        await sync(config).catch(() => {});
        if (alive) await load(queryRef.current);
      })();
      return () => {
        alive = false;
      };
    }, [load]),
  );

  return (
    <Screen>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button">
          <Text style={styles.back}>‹ Назад</Text>
        </Pressable>
        <Text style={styles.title}>Карточки</Text>
        <Text style={styles.counter}>{total}</Text>
      </View>

      <View style={styles.searchWrap}>
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={(text) => {
            setQuery(text);
            queryRef.current = text;
            void load(text);
          }}
          placeholder="Поиск по русскому, 汉字, пиньиню"
          placeholderTextColor={colors.inkSoft}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <FlatList
        data={cards}
        keyExtractor={(card) => card.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <Text style={ui.muted}>
            {total === 0
              ? 'Локальная база пуста: открой главный экран с сетью, карточки подтянутся.'
              : 'Ничего не найдено.'}
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() => router.push({ pathname: '/card', params: { id: item.id } })}
            accessibilityRole="button"
            accessibilityLabel={`${item.front}, ${item.back}`}
          >
            <View style={styles.rowMain}>
              <Text style={styles.front}>{item.front}</Text>
              <Text style={styles.deck}>{item.deck.split('/').pop()}</Text>
            </View>
            <View style={styles.rowSide}>
              <Text style={styles.back2}>{item.back}</Text>
              {item.pinyin ? <Text style={styles.pinyin}>{item.pinyin}</Text> : null}
            </View>
          </Pressable>
        )}
      />
    </Screen>
  );
}

function makeStyles(c: Palette) {
  return StyleSheet.create({
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing(4),
      paddingHorizontal: spacing(5),
      paddingTop: spacing(3),
    },
    back: { color: c.inkSoft, fontSize: 15, fontWeight: '600' },
    title: { flex: 1, color: c.ink, fontSize: 20, fontWeight: '700' },
    counter: { color: c.inkSoft, fontSize: 14 },
    searchWrap: { paddingHorizontal: spacing(5), paddingTop: spacing(3) },
    search: {
      backgroundColor: c.paperDeep,
      borderRadius: radius.button,
      paddingHorizontal: spacing(4),
      paddingVertical: spacing(3),
      fontSize: 15,
      color: c.ink,
    },
    list: { padding: spacing(5), gap: spacing(2) },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing(3),
      paddingVertical: spacing(3),
      paddingHorizontal: spacing(4),
      borderRadius: radius.card,
      backgroundColor: c.paperDeep,
    },
    rowPressed: { opacity: 0.75 },
    rowMain: { flex: 1, gap: 2 },
    front: { fontSize: 16, color: c.ink },
    deck: { fontSize: 11, color: c.inkSoft, opacity: 0.7 },
    rowSide: { alignItems: 'flex-end', gap: 2 },
    back2: { fontSize: 22, color: c.jade },
    pinyin: { fontSize: 12, color: c.gold },
  });
}
