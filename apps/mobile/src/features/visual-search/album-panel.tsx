import { Clock3, Images } from 'lucide-react-native';
import { useCallback, useMemo } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  runOnUI,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { theme } from '@/theme';
import type { ImageHistoryEntry } from './search-history';

/*
 * The camera's album
 * ------------------
 * Daraz's photo search keeps the device's own pictures one swipe away from the shutter, and
 * that is the point of this panel: a customer who already has the product in their gallery
 * never has to leave the camera. "Album" is the phone's pictures (read-only, permission
 * gated); "History" is the photographs this app searched with, which lives on the device.
 *
 * The panel is a plain animated view rather than a modal sheet so the preview behind it keeps
 * running and the shutter never disappears: the shutter row sits above the panel in the column.
 */

export type AlbumTab = 'album' | 'history';

export interface AlbumPanelProps {
  tab: AlbumTab;
  onTab: (tab: AlbumTab) => void;
  expanded: boolean;
  onExpanded: (expanded: boolean) => void;
  /** The phone's recent pictures, newest first. Empty until access is granted. */
  album: readonly string[];
  /** Searched-with pictures for this device, newest first. */
  history: readonly ImageHistoryEntry[];
  /** Why the album is empty, when it is: no permission, or nothing to show. */
  albumNotice: string | null;
  onRequestAlbum: () => void;
  onPick: (uri: string) => void;
  onOpenPicker: () => void;
  onClearHistory: () => void;
}

const STRIP_SIZE = 64;
const GRID_COLUMNS = 3;

/**
 * Reanimated's shared values are mutable by design, but only inside worklets; the React
 * compiler's immutability rule cannot see through a gesture callback, so the writes live in a
 * module-level worklet where both the compiler and Reanimated agree on what is happening.
 */
function drive(value: { value: number }, next: number, duration?: number): void {
  'worklet';
  value.value = duration === undefined ? next : withTiming(next, { duration });
}

export function AlbumPanel({
  tab,
  onTab,
  expanded,
  onExpanded,
  album,
  history,
  albumNotice,
  onRequestAlbum,
  onPick,
  onOpenPicker,
  onClearHistory,
}: AlbumPanelProps) {
  const { height, width } = useWindowDimensions();
  const expandedHeight = Math.min(Math.max(height * 0.42, 248), 420);
  const gridSize = useMemo(() => {
    const available = Math.min(width, 520) - theme.spacing[4] * 2;
    return Math.floor((available - theme.spacing[2] * (GRID_COLUMNS - 1)) / GRID_COLUMNS);
  }, [width]);
  const progress = useSharedValue(expanded ? 1 : 0);
  const dragStart = useSharedValue(0);
  /** Grabber, tab row and one row of thumbnails: what the panel shows when it is resting. */
  const collapsedHeight = STRIP_SIZE + theme.spacing[2] * 2 + 44 + theme.spacing[4];
  const travel = Math.max(expandedHeight - collapsedHeight, 1);

  // The height follows `expanded`, and the drag only previews the move until it is released.
  const panelStyle = useAnimatedStyle(() => ({
    height: collapsedHeight + travel * progress.value,
  }));

  const toggle = useCallback(() => {
    const next = !expanded;
    runOnUI(drive)(progress, next ? 1 : 0, 220);
    onExpanded(next);
  }, [expanded, onExpanded, progress]);

  const drag = Gesture.Pan()
    // A small vertical slop keeps a tap on the grabber a tap, not a one-pixel drag.
    .activeOffsetY([-10, 10])
    .onStart(() => {
      dragStart.value = progress.value;
    })
    .onUpdate((event) => {
      const next = dragStart.value - event.translationY / travel;
      drive(progress, Math.min(1, Math.max(0, next)));
    })
    .onEnd((event) => {
      const projected = progress.value - event.velocityY / (travel * 3);
      const next = projected > 0.5;
      drive(progress, next ? 1 : 0, 200);
      // A bare call would make Reanimated wrap the prop in a remote function for the UI thread;
      // if the screen closes while the finger is still down that wrapper is gone and the UI
      // runtime throws. runOnJS queues the update on the JS thread instead.
      if (next !== expanded) runOnJS(onExpanded)(next);
    });

  const items = tab === 'album' ? album : history.map((entry) => entry.uri);
  const timeOf = useCallback(
    (uri: string) => history.find((entry) => entry.uri === uri)?.at ?? null,
    [history],
  );

  return (
    <Animated.View style={[styles.panel, panelStyle]}>
      <GestureDetector gesture={drag}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Collapse the album' : 'Expand the album'}
          onPress={toggle}
          style={styles.grabberArea}
        >
          <View style={styles.grabber} />
        </Pressable>
      </GestureDetector>

      <View style={styles.tabRow}>
        <Tab label="Album" active={tab === 'album'} onPress={() => onTab('album')} />
        <Tab label="History" active={tab === 'history'} onPress={() => onTab('history')} />
        <View style={styles.tabSpacer} />
        {tab === 'history' && history.length > 0 ? (
          <Pressable accessibilityRole="button" onPress={onClearHistory} hitSlop={8}>
            <Text style={styles.clear}>Clear</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open the phone gallery"
          onPress={onOpenPicker}
          hitSlop={8}
          style={styles.openGallery}
        >
          <Images size={18} color={theme.colors.primary} accessible={false} />
        </Pressable>
      </View>

      {items.length === 0 ? (
        <View style={styles.emptyRow}>
          <Text style={styles.emptyText}>
            {tab === 'history'
              ? 'Photos you search with appear here.'
              : (albumNotice ?? 'No pictures to show yet.')}
          </Text>
          {tab === 'album' && albumNotice !== null ? (
            <Pressable accessibilityRole="button" onPress={onRequestAlbum} hitSlop={8}>
              <Text style={styles.clear}>Allow access</Text>
            </Pressable>
          ) : null}
        </View>
      ) : expanded ? (
        <ScrollView
          contentContainerStyle={styles.grid}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
        >
          {items.map((uri) => (
            <Thumb
              key={uri}
              uri={uri}
              size={gridSize}
              at={() => timeOf(uri)}
              onPress={() => onPick(uri)}
            />
          ))}
        </ScrollView>
      ) : (
        <ScrollView
          horizontal
          contentContainerStyle={styles.strip}
          showsHorizontalScrollIndicator={false}
        >
          {items.map((uri) => (
            <Thumb
              key={uri}
              uri={uri}
              size={STRIP_SIZE}
              at={() => timeOf(uri)}
              onPress={() => onPick(uri)}
            />
          ))}
        </ScrollView>
      )}
    </Animated.View>
  );
}

function Tab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.tab, active ? styles.tabActive : null]}
    >
      <Text style={[styles.tabLabel, active ? styles.tabLabelActive : null]}>{label}</Text>
    </Pressable>
  );
}

function Thumb({
  uri,
  size,
  at,
  onPress,
}: {
  uri: string;
  size: number;
  at: () => number | null;
  onPress: () => void;
}) {
  const when = at();
  const label =
    when === null
      ? 'Search with this photo'
      : `Search with the photo from ${new Date(when).toLocaleString(undefined, {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })}`;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
      <Image source={{ uri }} style={[styles.thumb, { width: size, height: size }]} />
      {when === null ? null : (
        <View style={styles.thumbBadge}>
          <Clock3 size={10} color={theme.brand.onSolid} accessible={false} />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: {
    overflow: 'hidden',
    borderTopLeftRadius: theme.radii.sheet,
    borderTopRightRadius: theme.radii.sheet,
    backgroundColor: theme.glass.surfaceRaised,
  },
  grabberArea: { alignItems: 'center', paddingVertical: theme.spacing[2] },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: theme.brand.muted },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[2],
  },
  tab: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.radii.full,
  },
  tabActive: { backgroundColor: theme.brand.primary },
  tabLabel: {
    color: theme.colors.mutedForeground,
    fontSize: 13,
    fontWeight: theme.fontWeights.semibold,
  },
  tabLabelActive: { color: theme.brand.onSolid },
  tabSpacer: { flex: 1 },
  clear: { color: theme.colors.primary, fontSize: 13, fontWeight: theme.fontWeights.semibold },
  openGallery: { padding: theme.spacing[1] },
  strip: {
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[4],
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[5],
  },
  thumb: { borderRadius: theme.radii.input, backgroundColor: theme.colors.surfaceMuted },
  thumbBadge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
  },
  emptyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[4],
  },
  emptyText: { flex: 1, color: theme.colors.mutedForeground, fontSize: 13, lineHeight: 18 },
});
