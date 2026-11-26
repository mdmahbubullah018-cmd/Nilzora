import type { ChatMessage } from '@nilzora/contracts';
import { CHAT_REACTIONS } from '@nilzora/contracts';
import { Copy, CornerUpLeft, FileText, Flag, ImageIcon } from 'lucide-react-native';
import { type ReactNode, useContext, useMemo } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { theme } from '@/theme';
import { attachmentKindOf } from './media-sheet';
import {
  computeMenuLayout,
  isReactable,
  isReplyable,
  isReportable,
  reactionBarGrid,
  REACTION_TARGET,
  visibleBody,
  type Rect,
} from './message-model';

/*
 * The long-press menu
 * -------------------
 * Pressing and holding a message opens two small pieces of UI right beside it, over a dimmed
 * thread: a row of the eight reactions the product supports, and a short list of what else can be
 * done with that message. Both are positioned from the message's own place on screen and kept
 * inside the safe area, so neither can ever sit half off the screen. A tap outside, or the system
 * back gesture, closes it.
 */

/** What the menu is open for: the message and where its bubble is in the window. */
export interface MenuTarget {
  message: ChatMessage;
  anchor: Rect;
  mine: boolean;
}

const BAR_PADDING = 4;
const ROW_HEIGHT = 48;
const LIST_PADDING = 4;
const LIST_WIDTH = 224;
const SCREEN_MARGIN = 12;
// Two lines of the refusal text plus its margins: the estimate must not undershoot or the list
// would run past the bottom of the screen.
const FAILURE_HEIGHT = 56;
const NO_INSETS = { top: 0, bottom: 0, left: 0, right: 0 };

interface ActionRow {
  key: string;
  label: string;
  icon: ReactNode;
  destructive?: boolean;
  onPress: () => void;
}

export function MessageActionOverlay({
  target,
  myEmoji,
  reacting,
  failure,
  onReact,
  onReply,
  onCopy,
  onReport,
  onViewPicture,
  onOpenFile,
  onClose,
}: {
  target: MenuTarget | null;
  /** The customer's own reaction on this message, which is drawn highlighted. */
  myEmoji: string | null;
  /** True while a reaction is being saved; the bar ignores taps until it settles. */
  reacting: boolean;
  /** Why the last reaction was refused, shown under the bar instead of in an alert. */
  failure: string | null;
  onReact: (message: ChatMessage, emoji: string) => void;
  onReply: (message: ChatMessage) => void;
  onCopy: (text: string) => void;
  onReport: (message: ChatMessage) => void;
  onViewPicture: (message: ChatMessage) => void;
  onOpenFile: (message: ChatMessage) => void;
  onClose: () => void;
}) {
  const window = useWindowDimensions();
  // Read the context directly: a screen rendered without a provider just has no insets.
  const insets = useContext(SafeAreaInsetsContext) ?? NO_INSETS;

  const rows = useMemo<ActionRow[]>(() => {
    if (target === null) return [];
    const { message } = target;
    const list: ActionRow[] = [];
    if (isReplyable(message)) {
      list.push({
        key: 'reply',
        label: 'Reply',
        icon: <CornerUpLeft size={18} color={theme.colors.foreground} />,
        onPress: () => onReply(message),
      });
    }
    const text = visibleBody(message);
    if (text !== null) {
      list.push({
        key: 'copy',
        label: 'Copy',
        icon: <Copy size={18} color={theme.colors.foreground} />,
        onPress: () => onCopy(text),
      });
    }
    const kinds = message.attachments.map(attachmentKindOf);
    if (kinds.includes('image')) {
      list.push({
        key: 'picture',
        label: 'View picture',
        icon: <ImageIcon size={18} color={theme.colors.foreground} />,
        onPress: () => onViewPicture(message),
      });
    }
    if (kinds.includes('document') || kinds.includes('audio')) {
      list.push({
        key: 'file',
        label: kinds.includes('document') ? 'Open file' : 'Open voice message',
        icon: <FileText size={18} color={theme.colors.foreground} />,
        onPress: () => onOpenFile(message),
      });
    }
    if (isReportable(message)) {
      list.push({
        key: 'report',
        label: 'Report',
        icon: <Flag size={18} color={theme.notice.danger.icon} />,
        destructive: true,
        onPress: () => onReport(message),
      });
    }
    return list;
  }, [onCopy, onOpenFile, onReply, onReport, onViewPicture, target]);

  if (target === null) return null;

  const showBar = isReactable(target.message);
  const available = window.width - insets.left - insets.right - SCREEN_MARGIN * 2;
  // Every reaction keeps its full 44 dp square: a narrow phone wraps the bar into a grid
  // (360 dp: 4 x 2) instead of shrinking the buttons; a wide one keeps a single row.
  const grid = reactionBarGrid({
    count: CHAT_REACTIONS.length,
    available,
    padding: BAR_PADDING,
  });
  const barWidth = grid.width;
  const barHeight = showBar ? grid.height : 0;
  const listHeight =
    rows.length * ROW_HEIGHT + LIST_PADDING * 2 + (failure === null ? 0 : FAILURE_HEIGHT);
  const listWidth = Math.min(LIST_WIDTH, available);
  const layout = computeMenuLayout({
    anchor: target.anchor,
    window: { width: window.width, height: window.height },
    insets,
    mine: target.mine,
    bar: { width: barWidth, height: barHeight },
    list: { width: listWidth, height: listHeight },
    margin: SCREEN_MARGIN,
  });

  return (
    <Modal transparent visible animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.root} testID="message-menu">
        <Pressable
          accessible={false}
          importantForAccessibility="no"
          onPress={onClose}
          style={styles.backdrop}
          testID="message-menu-backdrop"
        />

        {showBar ? (
          <View
            accessibilityRole="toolbar"
            accessibilityLabel="Reactions"
            style={[
              styles.bar,
              { left: layout.bar.x, top: layout.bar.y, width: barWidth, height: barHeight },
              grid.rows > 1 ? styles.barGrid : null,
            ]}
            testID="reaction-bar"
          >
            {CHAT_REACTIONS.map((reaction) => {
              const selected = myEmoji === reaction.emoji;
              return (
                <Pressable
                  key={reaction.emoji}
                  accessibilityRole="button"
                  accessibilityLabel={selected ? `${reaction.label}, remove` : reaction.label}
                  accessibilityState={{ selected, disabled: reacting }}
                  disabled={reacting}
                  onPress={() => onReact(target.message, reaction.emoji)}
                  style={({ pressed }) => [
                    styles.reaction,
                    { width: grid.item },
                    selected ? styles.reactionOn : null,
                    pressed ? styles.reactionPressed : null,
                    reacting && !selected ? styles.reactionBusy : null,
                  ]}
                >
                  <Text style={styles.reactionGlyph}>{reaction.emoji}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {rows.length === 0 ? null : (
          <View
            accessibilityRole="menu"
            accessibilityLabel="Message actions"
            style={[
              styles.list,
              {
                left: layout.list.x,
                top: layout.list.y,
                width: listWidth,
                maxHeight: layout.list.height,
              },
            ]}
            testID="message-actions"
          >
            {/* Scrolls only when the screen is too short to show the bar and every row. */}
            <ScrollView
              bounces={false}
              showsVerticalScrollIndicator={false}
              style={{ maxHeight: Math.max(0, layout.list.height - LIST_PADDING * 2) }}
            >
              {failure === null ? null : (
                <View
                  accessible
                  accessibilityLiveRegion="polite"
                  accessibilityRole="alert"
                  style={styles.failure}
                >
                  <Text style={styles.failureText}>{failure}</Text>
                </View>
              )}
              {rows.map((row) => (
                <Pressable
                  key={row.key}
                  accessibilityRole="menuitem"
                  accessibilityLabel={row.label}
                  onPress={row.onPress}
                  style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
                >
                  {row.icon}
                  <Text style={[styles.rowLabel, row.destructive ? styles.rowLabelDanger : null]}>
                    {row.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  bar: {
    position: 'absolute',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignContent: 'center',
    alignItems: 'center',
    padding: BAR_PADDING,
    borderRadius: theme.radii.full,
    backgroundColor: theme.colors.surface,
    ...theme.shadow.floating,
  },
  barGrid: { borderRadius: theme.radii.card },
  reaction: {
    height: REACTION_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radii.full,
  },
  reactionOn: { backgroundColor: theme.colors.infoSurface },
  reactionPressed: { backgroundColor: theme.colors.surfaceMuted },
  reactionBusy: { opacity: 0.45 },
  reactionGlyph: { fontSize: 24 },
  failure: {
    minHeight: FAILURE_HEIGHT,
    justifyContent: 'center',
    marginHorizontal: theme.spacing[2],
    marginBottom: 2,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.radii.sm,
    backgroundColor: theme.notice.danger.surface,
  },
  failureText: { ...theme.text.micro, color: theme.notice.danger.foreground },
  list: {
    position: 'absolute',
    paddingVertical: LIST_PADDING,
    borderRadius: theme.radii.card,
    backgroundColor: theme.colors.surface,
    ...theme.shadow.floating,
  },
  row: {
    minHeight: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  rowPressed: { backgroundColor: theme.colors.surfaceMuted },
  rowLabel: { ...theme.text.body, color: theme.colors.foreground },
  rowLabelDanger: { color: theme.notice.danger.foreground },
});
