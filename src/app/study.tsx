import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { Empty, PrimaryButton, ProgressBar, Screen, fonts, useUiStyles } from '../components/ui';
import { api } from '../lib/api';
import { loadConfig } from '../lib/config';
import { applyReview, dueCards } from '../lib/db';
import { enqueue } from '../lib/outbox';
import { afterAnswer, progress } from '../lib/queue';
import { radius, spacing, type Palette } from '../theme';
import { useTheme } from '../theme-context';
import type { Card } from '../types';

type State = 'loading' | 'ready' | 'error';

export default function StudyScreen() {
  const ui = useUiStyles();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { width } = useWindowDimensions();
  const threshold = width * 0.3;

  const params = useLocalSearchParams<{ deck?: string; title?: string }>();
  const deckId = typeof params.deck === 'string' ? params.deck : '';
  const title = typeof params.title === 'string' ? params.title : 'Всё подряд';

  const [queue, setQueue] = useState<Card[]>([]);
  const [state, setState] = useState<State>('loading');
  const [error, setError] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [answered, setAnswered] = useState(0);
  const [knownCount, setKnownCount] = useState(0);
  const [unknownCount, setUnknownCount] = useState(0);
  const [toast, setToast] = useState('');

  const [shownAt, setShownAt] = useState(() => Date.now());
  const [fade] = useState(() => new Animated.Value(1));
  const [pan] = useState(() => new Animated.Value(0));

  const begin = useCallback(
    () =>
      dueCards(deckId, 20)
        .then((cards) => {
          setQueue(cards);
          setAnswered(0);
          setKnownCount(0);
          setUnknownCount(0);
          setRevealed(false);
          setShownAt(Date.now());
          setState('ready');
        })
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : 'Не получилось прочитать карточки');
          setState('error');
        }),
    [deckId],
  );

  useEffect(() => {
    void begin();
  }, [begin]);

  useEffect(() => () => void Speech.stop(), []);

  const current = queue[0];

  useEffect(() => {
    if (!current) return;
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [current, fade]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 1800);
    return () => clearTimeout(timer);
  }, [toast]);

  const reveal = () => {
    if (revealed || !current) return;
    setRevealed(true);
    void Haptics.selectionAsync();
  };

  const answer = useCallback(
    async (known: boolean) => {
      if (!current) return;
      const elapsed = Date.now() - shownAt;
      const card = current;

      void Speech.stop();
      void Haptics.impactAsync(
        known ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Rigid,
      );

      const eventId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      try {
        const schedule = await applyReview(card.id, known);
        api.review(loadConfig(), card.id, known, elapsed, schedule, eventId).catch(() => {
          void enqueue({
            card_id: card.id,
            known,
            elapsed_ms: elapsed,
            event_id: eventId,
            schedule,
          });
        });
      } catch {
        pan.setValue(0);
        setToast('ответ не сохранён, попробуй ещё раз');
        return;
      }

      const next = afterAnswer(queue, known);
      setQueue(next.queue);
      setAnswered((n) => n + 1);
      if (known) setKnownCount((n) => n + 1);
      else setUnknownCount((n) => n + 1);
      setRevealed(false);
      setToast(
        known
          ? next.requeued
            ? 'знаю'
            : 'знаю · увидимся позже'
          : 'вернётся через пару карточек',
      );
      setShownAt(Date.now());
    },
    [current, pan, queue, shownAt],
  );

  const fly = useCallback(
    (known: boolean) => {
      Animated.timing(pan, {
        toValue: known ? width : -width,
        duration: 190,
        useNativeDriver: true,
      }).start(() => {
        pan.setValue(0);
        void answer(known);
      });
    },
    [answer, pan, width],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          revealed && Math.abs(gesture.dx) > 10 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderGrant: () => pan.stopAnimation(),
        onPanResponderMove: (_event, gesture) => pan.setValue(gesture.dx),
        onPanResponderRelease: (_event, gesture) => {
          if (Math.abs(gesture.dx) >= threshold) {
            fly(gesture.dx > 0);
            return;
          }
          Animated.spring(pan, {
            toValue: 0,
            friction: 6,
            tension: 80,
            useNativeDriver: true,
          }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(pan, { toValue: 0, useNativeDriver: true }).start();
        },
      }),
    [fly, pan, revealed, threshold],
  );

  if (state === 'loading') {
    return (
      <Screen>
        <Empty title="Готовлю карточки…" />
      </Screen>
    );
  }

  if (state === 'error') {
    return (
      <Screen>
        <View style={styles.topBar}>
          <Back styles={styles} />
        </View>
        <View style={ui.center}>
          <Text style={ui.emptyTitle}>Не получилось открыть карточки</Text>
          <Text style={ui.muted}>{error}</Text>
          <Pressable style={styles.retry} onPress={() => void begin()}>
            <Text style={styles.retryLabel}>Ещё раз</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  if (!current) {
    return (
      <Screen>
        <View style={styles.topBar}>
          <Back styles={styles} />
        </View>
        <View style={ui.center}>
          <Text style={styles.doneMark}>✓</Text>
          <Text style={ui.emptyTitle}>{answered > 0 ? 'Подход закрыт' : 'На сегодня всё'}</Text>
          <Text style={ui.muted}>
            {answered > 0
              ? `знаю ${knownCount} · не знаю ${unknownCount}`
              : 'Все карточки на сегодня повторены. Возвращайся завтра.'}
          </Text>
          {answered > 0 ? (
            <View style={styles.doneActions}>
              <View style={styles.buttonRow}>
                <PrimaryButton label="Ещё подход" onPress={() => void begin()} />
              </View>
              <Pressable style={styles.secondary} onPress={() => router.back()}>
                <Text style={styles.secondaryLabel}>На главную</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </Screen>
    );
  }

  const done = progress(answered, queue.length);
  const panOpacity = pan.interpolate({
    inputRange: [-width, -threshold, 0, threshold, width],
    outputRange: [0.35, 1, 1, 1, 0.35],
    extrapolate: 'clamp',
  });
  const rotate = pan.interpolate({
    inputRange: [-width, 0, width],
    outputRange: ['-8deg', '0deg', '8deg'],
    extrapolate: 'clamp',
  });

  return (
    <Screen>
      <View style={styles.topBar}>
        <Back styles={styles} />
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.counter}>
          {answered}/{answered + queue.length}
        </Text>
        <Pressable
          onPress={() => router.push({ pathname: '/card', params: { id: current.id } })}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Редактировать карточку"
        >
          <Text style={styles.edit}>✎</Text>
        </Pressable>
      </View>

      <View style={styles.progressWrap}>
        <ProgressBar value={done} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.cardArea}>
        <Animated.View
          {...panResponder.panHandlers}
          style={[
            styles.card,
            {
              opacity: Animated.multiply(fade, panOpacity),
              transform: [
                { translateX: pan },
                {
                  translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }),
                },
                { rotate },
              ],
            },
          ]}
        >
          <Animated.View
            pointerEvents="none"
            style={[
              styles.stamp,
              styles.stampUnknown,
              {
                opacity: pan.interpolate({
                  inputRange: [-threshold, 0],
                  outputRange: [1, 0],
                  extrapolate: 'clamp',
                }),
              },
            ]}
          >
            <Text style={styles.stampUnknownLabel}>не знаю</Text>
          </Animated.View>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.stamp,
              styles.stampKnown,
              {
                opacity: pan.interpolate({
                  inputRange: [0, threshold],
                  outputRange: [0, 1],
                  extrapolate: 'clamp',
                }),
              },
            ]}
          >
            <Text style={styles.stampKnownLabel}>знаю</Text>
          </Animated.View>

          <Pressable onPress={reveal} style={styles.cardInner} accessibilityRole="button">
            <Text style={styles.front}>{current.front}</Text>

            {revealed ? (
              <>
                <View style={styles.divider} />
                <View style={styles.hanziRow}>
                  <Text style={styles.hanzi}>{current.back}</Text>
                  <Pressable
                    onPress={() =>
                      Speech.speak(current.back, { language: 'zh-CN', rate: 0.9 })
                    }
                    hitSlop={12}
                    accessibilityRole="button"
                    accessibilityLabel="Произнести"
                  >
                    <Text style={styles.speak}>🔊</Text>
                  </Pressable>
                </View>
                {current.pinyin ? <Text style={styles.pinyin}>{current.pinyin}</Text> : null}
                {current.note ? <Text style={styles.note}>{current.note}</Text> : null}
                <Text style={styles.boxMeta}>
                  уровень {current.box + 1} · {current.reps + current.lapses > 0 ? `повторов ${current.reps}` : 'новая'}
                </Text>
              </>
            ) : (
              <Text style={styles.hint}>нажми, чтобы увидеть ответ</Text>
            )}
          </Pressable>
        </Animated.View>

        <Text style={styles.toast}>{toast}</Text>
      </ScrollView>

      <View style={styles.actions}>
        <PrimaryButton
          label="Не знаю"
          variant="clay"
          disabled={!revealed}
          onPress={() => fly(false)}
        />
        <PrimaryButton label="Знаю" disabled={!revealed} onPress={() => fly(true)} />
      </View>
    </Screen>
  );
}

function Back({ styles }: { styles: ReturnType<typeof makeStyles> }) {
  return (
    <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button">
      <Text style={styles.back}>‹ Назад</Text>
    </Pressable>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(3),
    paddingHorizontal: spacing(5),
    paddingTop: spacing(3),
  },
  back: {
    color: colors.inkSoft,
    fontSize: 15,
    fontWeight: '600',
  },
  title: {
    flex: 1,
    color: colors.ink,
    fontSize: 16,
    fontWeight: '600',
  },
  edit: {
    color: colors.inkSoft,
    fontSize: 20,
  },
  counter: {
    color: colors.inkSoft,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
  },
  progressWrap: {
    paddingHorizontal: spacing(5),
    paddingTop: spacing(3),
  },
  cardArea: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing(5),
  },
  scroll: {
    flex: 1,
  },
  buttonRow: {
    flexDirection: 'row',
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    shadowColor: colors.ink,
    shadowOpacity: 0.06,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  cardInner: {
    minHeight: 320,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing(6),
    gap: spacing(2),
  },
  stamp: {
    position: 'absolute',
    top: spacing(3),
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(1),
    borderRadius: radius.pill,
    borderWidth: 2,
    zIndex: 1,
  },
  stampKnown: {
    right: spacing(3),
    borderColor: colors.jade,
    transform: [{ rotate: '8deg' }],
  },
  stampUnknown: {
    left: spacing(3),
    borderColor: colors.clay,
    transform: [{ rotate: '-8deg' }],
  },
  stampKnownLabel: {
    color: colors.jade,
    fontWeight: '700',
    fontSize: 14,
    letterSpacing: 1,
  },
  stampUnknownLabel: {
    color: colors.clay,
    fontWeight: '700',
    fontSize: 14,
    letterSpacing: 1,
  },
  front: {
    fontSize: 34,
    lineHeight: 44,
    textAlign: 'center',
    color: colors.ink,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    width: 72,
    backgroundColor: colors.line,
    marginVertical: spacing(3),
  },
  hanziRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(3),
  },
  hanzi: {
    fontFamily: fonts.hanzi,
    fontSize: 64,
    color: colors.jade,
    textAlign: 'center',
    flexShrink: 1,
  },
  speak: {
    fontSize: 26,
  },
  pinyin: {
    fontSize: 22,
    color: colors.gold,
    letterSpacing: 0.5,
  },
  note: {
    marginTop: spacing(2),
    fontSize: 14,
    lineHeight: 20,
    color: colors.inkSoft,
    textAlign: 'center',
  },
  boxMeta: {
    marginTop: spacing(3),
    fontSize: 12,
    color: colors.inkSoft,
    opacity: 0.7,
  },
  hint: {
    marginTop: spacing(3),
    fontSize: 14,
    color: colors.inkSoft,
  },
  toast: {
    marginTop: spacing(3),
    textAlign: 'center',
    fontSize: 13,
    color: colors.inkSoft,
    minHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing(3),
    paddingHorizontal: spacing(5),
    paddingBottom: spacing(5),
  },
  doneMark: {
    fontSize: 54,
    color: colors.jade,
  },
  doneActions: {
    width: '100%',
    gap: spacing(3),
    marginTop: spacing(4),
  },
  secondary: {
    alignItems: 'center',
    paddingVertical: spacing(3.5),
  },
  secondaryLabel: {
    color: colors.inkSoft,
    fontWeight: '600',
    fontSize: 16,
  },
  retry: {
    backgroundColor: colors.clay,
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(2.5),
    borderRadius: radius.pill,
  },
  retryLabel: {
    color: colors.onJade,
    fontWeight: '600',
  },
});
}
