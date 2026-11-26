import type { ProductVideo } from '@nilzora/contracts';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { CircleAlert, Play } from 'lucide-react-native';
import { useEffect } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { theme } from '@/theme';

/*
 * A product video as one page of the gallery. Off screen it is a poster (the video's title on
 * the brand's dark tile, with a play mark), so no player exists for pages nobody is looking at.
 * The page in view gets a native player (expo-video) with the platform's own controls: play,
 * seek, full screen. Nothing autoplays; leaving the page pauses it. Loading shows a spinner and
 * a file the phone cannot play says so in place, with a retry.
 */

export function GalleryVideoPage({
  video,
  active,
  number,
  style,
}: {
  video: ProductVideo;
  /** The page currently in view: only it holds a player. */
  active: boolean;
  /** 1-based among the product's videos, for the spoken name. */
  number: number;
  style: StyleProp<ViewStyle>;
}) {
  const label = video.title ?? `Product video ${String(number)}`;
  if (!active) {
    return (
      <View style={[styles.poster, style]} accessible accessibilityLabel={`${label}, video`}>
        <View style={styles.playMark}>
          <Play size={26} color={theme.colors.primary} fill={theme.colors.primary} />
        </View>
        <Text style={styles.posterTitle} numberOfLines={2}>
          {label}
        </Text>
        <Text style={styles.posterTag}>VIDEO</Text>
      </View>
    );
  }
  return <ActiveVideo video={video} label={label} style={style} />;
}

function ActiveVideo({
  video,
  label,
  style,
}: {
  video: ProductVideo;
  label: string;
  style: StyleProp<ViewStyle>;
}) {
  const player = useVideoPlayer(video.url, (created) => {
    created.loop = false;
  });
  const { status } = useEvent(player, 'statusChange', { status: player.status });

  // Leaving the screen (or the page) stops the sound with it.
  useEffect(
    () => () => {
      try {
        player.pause();
      } catch {
        // The player may already be released with the page.
      }
    },
    [player],
  );

  return (
    <View style={[styles.stage, style]}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        nativeControls
        contentFit="contain"
        accessibilityLabel={label}
      />
      {status === 'loading' ? (
        <View pointerEvents="none" style={styles.overlay}>
          <ActivityIndicator color="#FFFFFF" size="large" accessibilityLabel="Loading the video" />
        </View>
      ) : null}
      {status === 'error' ? (
        <View style={[styles.overlay, styles.errorOverlay]} accessibilityLiveRegion="polite">
          <CircleAlert size={28} color="#FFFFFF" />
          <Text style={styles.errorText}>This video could not be played right now.</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Try the video again"
            onPress={() => {
              player.replace(video.url);
            }}
            style={({ pressed }) => [styles.retry, pressed && styles.retryPressed]}
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  poster: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[6],
    backgroundColor: theme.colors.navy,
    borderRadius: theme.radii.card,
    overflow: 'hidden',
  },
  playMark: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    paddingLeft: 4,
  },
  posterTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  posterTag: { color: theme.colors.sky, fontSize: 11, fontWeight: '700', letterSpacing: 1.4 },
  stage: { backgroundColor: '#000000', borderRadius: theme.radii.card, overflow: 'hidden' },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[3],
  },
  errorOverlay: { backgroundColor: 'rgba(0,0,0,0.8)', padding: theme.spacing[6] },
  errorText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600', textAlign: 'center' },
  retry: {
    minHeight: 44,
    paddingHorizontal: theme.spacing[5],
    borderRadius: 999,
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  retryPressed: { opacity: 0.85 },
  retryText: { color: theme.colors.foreground, fontSize: 14, fontWeight: '700' },
});
