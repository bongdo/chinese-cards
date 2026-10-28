import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { PrimaryButton, Screen, useUiStyles } from '../components/ui';
import { getCard, removeCard, saveCard } from '../lib/db';
import { loadConfig } from '../lib/config';
import { sync } from '../lib/sync';
import { radius, spacing, type Palette } from '../theme';
import { useTheme } from '../theme-context';

export default function CardScreen() {
  const ui = useUiStyles();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const params = useLocalSearchParams<{ id?: string }>();
  const cardId = typeof params.id === 'string' ? params.id : '';

  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [pinyin, setPinyin] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void getCard(cardId).then((card) => {
      if (!card) {
        setError('Карточка не найдена в локальной базе');
      } else {
        setFront(card.front);
        setBack(card.back);
        setPinyin(card.pinyin ?? '');
        setNote(card.note ?? '');
      }
      setLoaded(true);
    });
  }, [cardId]);

  const save = async () => {
    if (!front.trim() || !back.trim()) {
      setError('Вопрос и ответ не могут быть пустыми');
      return;
    }
    await saveCard(cardId, {
      front: front.trim(),
      back: back.trim(),
      pinyin: pinyin.trim(),
      note: note.trim(),
    });
    void sync(loadConfig()).catch(() => {});
    router.back();
  };

  const remove = () => {
    Alert.alert('Удалить карточку?', 'Локально исчезнет сразу, с сервера тоже после синхронизации.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await removeCard(cardId);
            void sync(loadConfig()).catch(() => {});
            router.back();
          })();
        },
      },
    ]);
  };

  return (
    <Screen>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button">
          <Text style={styles.back}>‹ Назад</Text>
        </Pressable>
        <Text style={styles.title}>Карточка</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {!loaded ? <Text style={ui.muted}>Читаю локальную базу…</Text> : null}

        {loaded ? (
          <>
            <Field label="Вопрос" value={front} onChange={setFront} styles={styles} />
            <Field label="Ответ" value={back} onChange={setBack} styles={styles} />
            <Field label="Пиньинь" value={pinyin} onChange={setPinyin} styles={styles} />
            <Field label="Заметка" value={note} onChange={setNote} styles={styles} multiline />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <View style={styles.row}>
              <PrimaryButton label="Сохранить" onPress={() => void save()} />
            </View>
            <Pressable style={styles.delete} onPress={remove} accessibilityRole="button">
              <Text style={styles.deleteLabel}>Удалить карточку</Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function Field({
  label,
  value,
  onChange,
  styles,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  styles: ReturnType<typeof makeStyles>;
  multiline?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.inputMultiline]}
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
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
    title: { color: c.ink, fontSize: 20, fontWeight: '700' },
    scroll: { flex: 1 },
    content: { padding: spacing(5), gap: spacing(3), paddingBottom: spacing(10) },
    field: { gap: spacing(1.5) },
    label: { fontSize: 13, fontWeight: '600', color: c.inkSoft, textTransform: 'uppercase' },
    input: {
      backgroundColor: c.paperDeep,
      borderRadius: radius.button,
      paddingHorizontal: spacing(4),
      paddingVertical: spacing(3),
      fontSize: 17,
      color: c.ink,
    },
    inputMultiline: { minHeight: 90, textAlignVertical: 'top' },
    error: { color: c.clay, fontSize: 14 },
    row: { flexDirection: 'row', marginTop: spacing(2) },
    delete: { alignItems: 'center', paddingVertical: spacing(4) },
    deleteLabel: { color: c.clay, fontWeight: '600', fontSize: 15 },
  });
}
