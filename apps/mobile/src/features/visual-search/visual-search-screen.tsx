import type { ImageSearchSort } from '@nilzora/contracts';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Image, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useApi } from '@/api/api-context';
import { theme } from '@/theme';
import { CameraStage } from './camera-stage';
import { CropStage } from './crop-stage';
import { ResultsStage } from './results-stage';
import { useImageHistory } from './use-image-history';
import {
  preparePhoto,
  resolveScanCode,
  useVisualSearch,
  type PreparedPhoto,
} from './visual-search-model';

/*
 * Search by photo
 * ---------------
 * Three steps and no landing page: the camera (opened straight from a search bar), the crop
 * that decides exactly what is compared, and the results. A customer who came from a product's
 * "Find similar" starts at the results with that product's own picture, which is the same
 * search without an upload.
 *
 * The picture never leaves this app until "Search" is pressed, and the API never stores it.
 */

type Step = 'camera' | 'crop' | 'results';

interface Captured {
  uri: string;
  width: number;
  height: number;
}

export interface VisualSearchScreenProps {
  /** A product whose own picture seeds the search ("Find similar"). */
  initialProductId?: string | undefined;
  initialProductName?: string | undefined;
}

export function VisualSearchScreen({
  initialProductId,
  initialProductName,
}: VisualSearchScreenProps) {
  const router = useRouter();
  const api = useApi();
  const visual = useVisualSearch();
  const history = useImageHistory();
  const { width } = useWindowDimensions();

  const [step, setStep] = useState<Step>(initialProductId === undefined ? 'camera' : 'results');
  const [sort, setSort] = useState<ImageSearchSort>('best_match');
  const [captured, setCaptured] = useState<Captured | null>(null);
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const startedRef = useRef(false);

  const seeded = initialProductId !== undefined && photo === null;

  // "Find similar" opens straight into the results, with no picture of our own to show.
  useEffect(() => {
    if (startedRef.current || initialProductId === undefined) return;
    startedRef.current = true;
    void visual.findSimilar(initialProductId, { sort: 'best_match' });
  }, [initialProductId, visual]);

  const { remember } = history;
  const columns = width >= 700 ? 3 : 2;
  const cardWidth = Math.floor(
    (Math.min(width, 900) - theme.spacing[4] * 2 - theme.spacing[3] * (columns - 1)) / columns,
  );

  const runSearch = useCallback(
    async (next: PreparedPhoto, options: { sort?: ImageSearchSort; page?: number } = {}) => {
      setPhoto(next);
      setPreview(next.uri);
      setStep('results');
      remember({ uri: next.uri, at: Date.now() });
      await visual.search(next, options);
    },
    [remember, visual],
  );

  const startCrop = useCallback((picture: Captured) => {
    setCaptured(picture);
    setStep('crop');
  }, []);

  const pickFromGallery = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Photo access is blocked',
        'Allow photo access in your phone settings to search with a picture from the gallery.',
      );
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      exif: false,
    });
    const asset = picked.canceled ? undefined : picked.assets[0];
    if (asset === undefined) return;
    startCrop({ uri: asset.uri, width: asset.width, height: asset.height });
  }, [startCrop]);

  const pickUri = useCallback(
    (uri: string) => {
      Image.getSize(
        uri,
        (imageWidth, imageHeight) => startCrop({ uri, width: imageWidth, height: imageHeight }),
        () => Alert.alert('That picture could not be opened', 'Try another one.'),
      );
    },
    [startCrop],
  );

  const backToCamera = useCallback(() => {
    setCaptured(null);
    setPhoto(null);
    setPreview(null);
    visual.reset();
    setStep('camera');
  }, [visual]);

  const changeSort = useCallback(
    (next: ImageSearchSort) => {
      setSort(next);
      if (photo !== null) void visual.search(photo, { sort: next });
      else if (initialProductId !== undefined) {
        void visual.findSimilar(initialProductId, { sort: next });
      }
    },
    [initialProductId, photo, visual],
  );

  const changePage = useCallback(
    (page: number) => {
      if (photo !== null) void visual.search(photo, { sort, page });
      else if (initialProductId !== undefined) {
        void visual.findSimilar(initialProductId, { sort, page });
      }
    },
    [initialProductId, photo, sort, visual],
  );

  return (
    <View style={styles.root}>
      <StatusBar style={step === 'results' ? 'dark' : 'light'} />

      {step === 'camera' ? (
        <CameraStage
          onCaptured={startCrop}
          onClose={() => router.back()}
          onOpenPicker={() => void pickFromGallery()}
          onPickUri={pickUri}
          onCode={(value) => {
            void (async () => {
              const answer = await resolveScanCode(api, value);
              if (answer.kind === 'product') {
                router.push(`/product/${answer.slug}`);
                return;
              }
              if (answer.kind === 'search') {
                router.push({ pathname: '/search', params: { q: answer.query } });
                return;
              }
              Alert.alert(
                'That code is not one of our labels',
                'Try a photo of the product instead.',
              );
            })();
          }}
          history={history.entries}
          onClearHistory={() => {
            for (const entry of history.entries) history.forget(entry.uri);
          }}
        />
      ) : null}

      {step === 'crop' && captured !== null ? (
        <CropStage
          photo={captured}
          onBack={() => {
            setCaptured(null);
            setStep('camera');
          }}
          onConfirm={async (gesture, frameSize) => {
            try {
              const prepared = await preparePhoto({
                uri: captured.uri,
                image: { width: captured.width, height: captured.height },
                frameSize,
                gesture,
              });
              setCaptured(null);
              await runSearch(prepared, { sort: 'best_match' });
            } catch {
              Alert.alert('That photo could not be prepared', 'Try taking another one.');
              setCaptured(null);
              setStep('camera');
            }
          }}
        />
      ) : null}

      {step === 'results' ? (
        <ResultsStage
          status={
            visual.state.status === 'ready'
              ? 'ready'
              : visual.state.status === 'error'
                ? 'error'
                : 'searching'
          }
          result={visual.state.result}
          error={visual.state.error}
          retryable={visual.state.retryable}
          preview={preview}
          seeded={seeded}
          seedName={seeded ? initialProductName : undefined}
          sort={sort}
          cardWidth={cardWidth}
          onSort={changeSort}
          onPage={changePage}
          onRetake={backToCamera}
          onClose={() => router.back()}
          onRetry={() => {
            if (photo !== null) void visual.search(photo, { sort });
            else if (initialProductId !== undefined) {
              void visual.findSimilar(initialProductId, { sort });
            }
          }}
          onBrowse={() => router.replace('/search')}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.navy },
});
