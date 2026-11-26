import { Camera, Mic, Search, X } from 'lucide-react-native';
import type { Ref } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputInstance } from 'react-native';
import { theme } from '@/theme';
import { MAX_SEARCH_LENGTH } from './catalog-query';

/** Extends each icon slot back towards a comfortable target without adding visible space. */
const ACTION_HIT_SLOP = { top: 6, bottom: 6, left: 7, right: 7 } as const;

export interface SearchFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  /** The keyboard's search key. */
  onSubmit: () => void;
  onClear: () => void;
  /** Accessible name and placeholder. Defaults to "Search products". */
  label?: string;
  /** Focus changes, so a screen can offer device-local recent searches while it is open. */
  onFocus?: () => void;
  onBlur?: () => void;
  /** Shows a microphone at the right edge; pressing it starts a voice search. */
  onVoice?: () => void;
  /** Shows a camera at the right edge; pressing it opens image search. */
  onVisualSearch?: () => void;
  ref?: Ref<TextInputInstance>;
}

/**
 * The shop's search box: a labelled input with a search key on the keyboard and a clear
 * button (48dp) that appears once there is text. The caller debounces what it does with the text.
 */
export function SearchField({
  value,
  onChangeText,
  onSubmit,
  onClear,
  label = 'Search products',
  onFocus,
  onBlur,
  onVoice,
  onVisualSearch,
  ref,
}: SearchFieldProps) {
  return (
    <View style={styles.field}>
      <Search size={20} color={theme.colors.mutedForeground} accessible={false} />
      <TextInput
        ref={ref}
        accessibilityRole="search"
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={label}
        placeholderTextColor={theme.colors.mutedForeground}
        returnKeyType="search"
        inputMode="search"
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={MAX_SEARCH_LENGTH}
        selectionColor={theme.colors.primary}
        style={styles.input}
      />
      {value !== '' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={4}
          onPress={onClear}
          android_ripple={{ color: 'rgba(15, 23, 42, 0.12)', borderless: true }}
          style={styles.clear}
        >
          <X size={18} color={theme.colors.mutedForeground} accessible={false} />
        </Pressable>
      ) : null}
      {onVisualSearch === undefined && onVoice === undefined ? null : (
        // One trailing group: the camera sits immediately left of the microphone, a thumb's
        // width apart rather than a bar's. Their tap areas overlap by the hit slop, which the
        // pressables resolve in favour of whichever icon the finger is actually over.
        <View style={styles.actions} testID="search-actions">
          {onVoice === undefined ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Search by voice"
              accessibilityHint="Listens, then searches for what you say"
              hitSlop={ACTION_HIT_SLOP}
              onPress={onVoice}
              android_ripple={{ color: 'rgba(2, 132, 199, 0.16)', borderless: true }}
              style={styles.action}
            >
              <Mic size={20} color={theme.colors.primary} accessible={false} />
            </Pressable>
          )}
          {onVisualSearch === undefined ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Search by photo"
              accessibilityHint="Opens the camera to find a product from a picture"
              hitSlop={ACTION_HIT_SLOP}
              onPress={onVisualSearch}
              android_ripple={{ color: 'rgba(2, 132, 199, 0.16)', borderless: true }}
              style={styles.action}
            >
              <Camera size={20} color={theme.colors.primary} accessible={false} />
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    minHeight: theme.touchTarget,
    paddingLeft: theme.spacing[3],
    borderWidth: 1,
    borderColor: theme.colors.inputBorder,
    borderRadius: theme.radii.full,
    backgroundColor: theme.colors.surface,
  },
  input: {
    flex: 1,
    minHeight: theme.touchTarget,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: 0,
    color: theme.colors.foreground,
    fontSize: 16,
  },
  clear: {
    width: theme.touchTarget,
    height: theme.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /**
   * The trailing pair (camera, microphone) reads as one control: two 30dp slots with no gap
   * between them, so the two 20dp glyphs sit ~10dp apart instead of the ~36dp the old 48dp
   * buttons plus the field's gap produced. The hit slop gives each about a 44dp target.
   */
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: theme.spacing[1],
  },
  action: {
    width: 30,
    height: theme.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
