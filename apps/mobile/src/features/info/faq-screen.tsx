import {
  FAQ_CATEGORY_LABELS,
  FAQ_ENTRIES,
  FAQ_SUMMARY,
  FAQ_TITLE,
  groupFaq,
  searchFaq,
  type FaqCategory,
} from '@nilzora/contracts';
import { useRouter } from 'expo-router';
import { ChevronDown, SearchX } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { EmptyState } from '@/components/empty-state';
import { Screen, STACK_EDGES } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { theme } from '@/theme';
import { INFO_HREFS } from './routes';

/*
 * The FAQ on a phone: a search field, a row of topics, then the questions grouped by topic.
 * Tapping a question expands its answer in place; searching expands the answers that matched,
 * so a search never needs a second tap. The questions and wording come from @nilzora/contracts,
 * the same source the website reads.
 */

const RIPPLE = { color: 'rgba(2, 132, 199, 0.14)' } as const;
const ALL = 'all' as const;
type CategoryFilter = FaqCategory | typeof ALL;

const CATEGORY_CHIPS: readonly { key: CategoryFilter; label: string }[] = [
  { key: ALL, label: 'All topics' },
  ...(Object.keys(FAQ_CATEGORY_LABELS) as FaqCategory[]).map((key) => ({
    key,
    label: FAQ_CATEGORY_LABELS[key],
  })),
];

export function FaqScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryFilter>(ALL);
  const [openId, setOpenId] = useState<string | null>(null);

  const typed = query.trim();
  const found = useMemo(
    () =>
      searchFaq(query, FAQ_ENTRIES).filter(
        (entry) => category === ALL || entry.category === category,
      ),
    [query, category],
  );
  const groups = useMemo(() => groupFaq(found), [found]);
  const searching = typed !== '' || category !== ALL;

  return (
    <Screen title={FAQ_TITLE} edges={STACK_EDGES}>
      <Text style={styles.summary}>{FAQ_SUMMARY}</Text>

      <TextField
        label="Search the questions"
        value={query}
        onChangeText={setQuery}
        placeholder="Delivery, refund, password…"
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        accessibilityLabel="Topics"
      >
        {CATEGORY_CHIPS.map((chip) => (
          <Chip
            key={chip.key}
            label={chip.label}
            selected={category === chip.key}
            onPress={() => {
              setCategory(category === chip.key && chip.key !== ALL ? ALL : chip.key);
            }}
          />
        ))}
      </ScrollView>

      <Text accessibilityLiveRegion="polite" style={styles.count}>
        {found.length === 0
          ? 'No questions match'
          : `${String(found.length)} ${found.length === 1 ? 'question' : 'questions'}${
              searching ? ' match' : ''
            }`}
      </Text>

      {groups.length === 0 ? (
        <Card style={styles.emptyCard}>
          <EmptyState
            icon={SearchX}
            title="Nothing matches that search"
            description="Try one or two words, or choose another topic. If the answer is not here, the store can answer it directly."
            action={{
              label: 'Open Help & support',
              onPress: () => {
                router.push(INFO_HREFS.support);
              },
            }}
          />
        </Card>
      ) : (
        <View style={styles.groups}>
          {groups.map((group) => (
            <View key={group.category} style={styles.group}>
              <Text accessibilityRole="header" style={styles.groupHeading}>
                {group.label}
              </Text>
              <Card>
                {group.entries.map((entry, index) => {
                  const expanded = typed !== '' || openId === entry.id;
                  return (
                    <View
                      key={entry.id}
                      style={index === group.entries.length - 1 ? null : styles.rowDivider}
                    >
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ expanded }}
                        accessibilityLabel={entry.question}
                        accessibilityHint={expanded ? 'Hides the answer' : 'Shows the answer'}
                        onPress={() => {
                          setOpenId(openId === entry.id ? null : entry.id);
                        }}
                        android_ripple={RIPPLE}
                        style={({ pressed }) => [
                          styles.question,
                          pressed ? styles.questionPressed : null,
                        ]}
                      >
                        <Text style={styles.questionText}>{entry.question}</Text>
                        <View style={[styles.chevron, expanded ? styles.chevronExpanded : null]}>
                          <ChevronDown
                            size={theme.icon.size.sm}
                            color={theme.colors.mutedForeground}
                            accessible={false}
                          />
                        </View>
                      </Pressable>
                      {expanded ? <Text style={styles.answer}>{entry.answer}</Text> : null}
                    </View>
                  );
                })}
              </Card>
            </View>
          ))}
        </View>
      )}

      <Text style={styles.footerNote}>
        Still stuck? Open Help & support from your account, or read the Privacy policy and the Terms
        of service.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  summary: { color: theme.colors.body, ...theme.text.lead },
  chips: { gap: theme.spacing[2], paddingRight: theme.spacing[2] },
  count: { color: theme.colors.mutedForeground, ...theme.text.caption },
  emptyCard: { paddingBottom: theme.spacing[2] },
  groups: { gap: theme.spacing[6] },
  group: { gap: theme.spacing[2] },
  groupHeading: { color: theme.colors.foreground, ...theme.text.subheading },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  question: {
    minHeight: theme.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  questionPressed: { backgroundColor: theme.colors.surfaceMuted },
  questionText: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: theme.fontWeights.medium,
  },
  chevron: { width: 20, alignItems: 'center' },
  chevronExpanded: { transform: [{ rotate: '180deg' }] },
  answer: {
    color: theme.colors.body,
    fontSize: 14,
    lineHeight: 21,
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[4],
  },
  footerNote: {
    color: theme.colors.mutedForeground,
    fontSize: 13,
    lineHeight: 19,
    paddingTop: theme.spacing[2],
  },
});
