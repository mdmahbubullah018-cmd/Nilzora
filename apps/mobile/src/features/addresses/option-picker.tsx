import { Check, ChevronDown, X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '@/theme';

/** Options whose name contains `query` (ignoring case and surrounding spaces). */
export function filterOptions(options: readonly string[], query: string): string[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...options];
  return options.filter((option) => option.toLowerCase().includes(needle));
}

export interface OptionPickerProps {
  /** Field label, also the picker's title. */
  label: string;
  value: string;
  options: readonly string[];
  onChange: (next: string) => void;
  /** Shown while nothing is chosen. */
  placeholder: string;
  error?: string;
  /** Disables the field; `disabledHint` says why. */
  disabled?: boolean;
  disabledHint?: string;
  /** Adds a search box to the list. */
  searchable?: boolean;
}

/**
 * A select field that opens a full-screen list: one tap to choose, a search box for long
 * lists (the 64 districts), and the Android back button closes it. The field reads as
 * "<label>, <value>" to a screen reader and announces its error like a text field does.
 */
export function OptionPicker({
  label,
  value,
  options,
  onChange,
  placeholder,
  error,
  disabled = false,
  disabledHint,
  searchable = false,
}: OptionPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const shown = useMemo(() => filterOptions(options, query), [options, query]);
  const hint = error ?? (disabled ? disabledHint : 'Opens a list to choose from');

  function close() {
    setOpen(false);
    setQuery('');
  }

  function choose(option: string) {
    onChange(option);
    close();
  }

  function renderOption({ item }: ListRenderItemInfo<string>) {
    const selected = item === value;
    return (
      <Pressable
        accessibilityRole="radio"
        accessibilityLabel={item}
        accessibilityState={{ checked: selected }}
        onPress={() => {
          choose(item);
        }}
        style={({ pressed }) => [styles.option, pressed ? styles.optionPressed : null]}
      >
        <Text style={[styles.optionText, selected ? styles.optionTextSelected : null]}>{item}</Text>
        {selected ? <Check size={20} color={theme.colors.link} accessible={false} /> : null}
      </Pressable>
    );
  }

  const shownValue = value === '' ? (disabled && disabledHint ? disabledHint : placeholder) : value;

  return (
    <View style={styles.field}>
      {/* Hidden from screen readers: the field itself announces the label. */}
      <Text aria-hidden style={styles.label}>
        {label}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: value === '' ? 'Not chosen' : value }}
        accessibilityHint={hint}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => {
          setOpen(true);
        }}
        style={({ pressed }) => [
          styles.input,
          error ? styles.inputError : null,
          disabled ? styles.inputDisabled : null,
          pressed ? styles.inputPressed : null,
        ]}
      >
        <Text
          numberOfLines={1}
          style={[styles.inputText, value === '' ? styles.placeholder : null]}
        >
          {shownValue}
        </Text>
        <ChevronDown size={20} color={theme.colors.mutedForeground} accessible={false} />
      </Pressable>
      {error ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      ) : null}

      <Modal visible={open} animationType="slide" statusBarTranslucent onRequestClose={close}>
        <SafeAreaView edges={['top', 'bottom']} style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text accessibilityRole="header" style={styles.sheetTitle}>
              {label}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Close ${label} list`}
              onPress={close}
              hitSlop={4}
              style={({ pressed }) => [styles.close, pressed ? styles.optionPressed : null]}
            >
              <X size={22} color={theme.colors.foreground} accessible={false} />
            </Pressable>
          </View>
          {searchable ? (
            <View style={styles.searchWrap}>
              <TextInput
                accessibilityLabel={`Search ${label.toLowerCase()}`}
                value={query}
                onChangeText={setQuery}
                placeholder={`Search ${label.toLowerCase()}`}
                placeholderTextColor={theme.colors.mutedForeground}
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
                returnKeyType="search"
                style={styles.search}
              />
            </View>
          ) : null}
          <FlatList
            data={shown}
            keyExtractor={(item) => item}
            renderItem={renderOption}
            accessibilityRole="radiogroup"
            keyboardShouldPersistTaps="handled"
            initialNumToRender={16}
            ListEmptyComponent={
              <Text style={styles.empty}>
                {searchable
                  ? `No ${label.toLowerCase()} matches "${query.trim()}".`
                  : 'Nothing to choose.'}
              </Text>
            }
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: theme.spacing[1] + 2 },
  label: { color: theme.colors.foreground, fontSize: 14, fontWeight: theme.fontWeights.medium },
  input: {
    minHeight: theme.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
    borderWidth: 1,
    borderColor: theme.colors.inputBorder,
    borderRadius: theme.radii.md,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing[3],
  },
  inputError: { borderColor: theme.colors.fieldError, borderWidth: 2 },
  inputDisabled: { backgroundColor: theme.colors.surfaceMuted },
  inputPressed: { backgroundColor: theme.colors.surfaceMuted },
  inputText: { flex: 1, color: theme.colors.foreground, fontSize: 16 },
  placeholder: { color: theme.colors.mutedForeground },
  error: { color: theme.colors.fieldError, fontSize: 13, lineHeight: 18 },
  sheet: { flex: 1, backgroundColor: theme.colors.surface },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: theme.spacing[5],
    paddingRight: theme.spacing[3],
    minHeight: 56,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  sheetTitle: {
    color: theme.colors.foreground,
    fontSize: 18,
    fontWeight: theme.fontWeights.semibold,
  },
  close: {
    width: theme.touchTarget,
    height: theme.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radii.full,
  },
  searchWrap: { padding: theme.spacing[4], paddingBottom: theme.spacing[2] },
  search: {
    minHeight: theme.touchTarget,
    borderWidth: 1,
    borderColor: theme.colors.inputBorder,
    borderRadius: theme.radii.md,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing[3],
    color: theme.colors.foreground,
    fontSize: 16,
  },
  option: {
    minHeight: theme.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing[5],
    paddingVertical: theme.spacing[2],
  },
  optionPressed: { backgroundColor: theme.colors.surfaceMuted },
  optionText: { flex: 1, color: theme.colors.foreground, fontSize: 16 },
  optionTextSelected: { color: theme.colors.link, fontWeight: theme.fontWeights.semibold },
  empty: {
    padding: theme.spacing[6],
    textAlign: 'center',
    color: theme.colors.mutedForeground,
    fontSize: 14,
  },
});
