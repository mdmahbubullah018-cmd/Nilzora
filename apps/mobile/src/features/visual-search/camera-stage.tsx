import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library/legacy';
import {
  Images,
  QrCode,
  RefreshCcw,
  ScanLine,
  X,
  Zap,
  ZapOff,
} from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/button';
import { theme } from '@/theme';
import { AlbumPanel, type AlbumTab } from './album-panel';
import type { ImageHistoryEntry } from './search-history';

/*
 * The camera
 * ----------
 * Full screen, dark, and nothing between the shutter and the search: the customer taps the
 * camera in a search bar, this opens, and a captured picture goes straight to the crop. The
 * only controls that earn their place are the ones Daraz's camera has — back, scan, torch,
 * album, shutter, flip — because every extra control costs a thumb's reach.
 *
 * The preview runs behind the album panel rather than being replaced by it, so expanding the
 * panel never stops the camera and the shutter stays visible above it.
 */

const BARCODE_TYPES = [
  'qr',
  'ean13',
  'ean8',
  'upc_a',
  'upc_e',
  'code128',
  'code39',
  'itf14',
  'codabar',
] as const;

export interface CameraStageProps {
  onCaptured: (picture: { uri: string; width: number; height: number }) => void;
  onClose: () => void;
  /** The system photo picker — the full album, in the platform's own UI. */
  onOpenPicker: () => void;
  /** A picture chosen from the album strip or the history tab. */
  onPickUri: (uri: string) => void;
  onCode: (value: string) => void;
  history: readonly ImageHistoryEntry[];
  onClearHistory: () => void;
}

type Mode = 'photo' | 'scan';

export function CameraStage({
  onCaptured,
  onClose,
  onOpenPicker,
  onPickUri,
  onCode,
  history,
  onClearHistory,
}: CameraStageProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<Mode>('photo');
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [torch, setTorch] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<AlbumTab>('album');
  const [expanded, setExpanded] = useState(false);
  const [album, setAlbum] = useState<readonly string[]>([]);
  const [albumNotice, setAlbumNotice] = useState<string | null>(null);
  const cameraRef = useRef<CameraView>(null);
  const scannable = useRef(true);

  useEffect(() => {
    if (permission !== null && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [permission, requestPermission]);

  const loadAlbum = useCallback(async (ask: boolean) => {
    try {
      let granted = await MediaLibrary.getPermissionsAsync();
      if (!granted.granted && ask && granted.canAskAgain) {
        granted = await MediaLibrary.requestPermissionsAsync();
      }
      if (!granted.granted) {
        setAlbumNotice('Allow photo access to pick from your album.');
        return;
      }
      const page = await MediaLibrary.getAssetsAsync({
        first: 24,
        mediaType: 'photo',
        sortBy: 'creationTime',
      });
      setAlbum(page.assets.map((asset) => asset.uri));
      setAlbumNotice(page.assets.length === 0 ? 'No pictures in the album yet.' : null);
    } catch {
      setAlbumNotice('The album could not be read on this phone.');
    }
  }, []);

  useEffect(() => {
    // Deferred to the next tick: the album is read after the first frame is on screen, so the
    // camera preview is never waiting on the media library.
    const timer = setTimeout(() => {
      void loadAlbum(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [loadAlbum]);

  const onBarcode = useCallback(
    (result: BarcodeScanningResult) => {
      // One code per visit: the scanner fires on every frame while the code is in view.
      if (!scannable.current) return;
      const value = result.data?.trim();
      if (value === undefined || value === '') return;
      scannable.current = false;
      onCode(value);
    },
    [onCode],
  );

  const capture = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const picture = await cameraRef.current?.takePictureAsync({ quality: 0.9, exif: false });
      if (picture !== undefined) {
        onCaptured({ uri: picture.uri, width: picture.width, height: picture.height });
      }
    } catch {
      Alert.alert('The photo could not be taken', 'Try again.');
    } finally {
      setBusy(false);
    }
  }, [busy, onCaptured]);

  if (permission === null) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={theme.brand.onSolid} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.centered} edges={['top', 'bottom']}>
        <Text style={styles.permissionTitle}>Camera access is off</Text>
        <Text style={styles.permissionBody}>
          Nilzora needs the camera to look at a product. You can allow it here, or search with a
          picture you already have.
        </Text>
        {permission.canAskAgain ? (
          <Button label="Allow camera" onPress={() => void requestPermission()} />
        ) : null}
        <Button label="Choose from gallery" variant="secondary" onPress={onOpenPicker} />
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
          <Text style={styles.permissionLink}>Close</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const galleryThumb = album[0] ?? history[0]?.uri ?? null;

  return (
    <View style={styles.root}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
        enableTorch={torch}
        onCameraReady={() => setReady(true)}
        {...(mode === 'scan'
          ? {
              barcodeScannerSettings: { barcodeTypes: [...BARCODE_TYPES] },
              onBarcodeScanned: onBarcode,
            }
          : {})}
      />
      <View pointerEvents="none" style={styles.topScrim} />

      <SafeAreaView edges={['top']} style={styles.topBarWrap}>
        <View style={styles.topBar}>
          <IconBubble icon={<X size={22} color={theme.brand.onSolid} />} label="Close" onPress={onClose} />
          <View style={styles.spacer} />
          <IconBubble
            icon={
              mode === 'scan' ? (
                <ScanLine size={20} color={theme.brand.onSolid} />
              ) : (
                <QrCode size={20} color={theme.brand.onSolid} />
              )
            }
            label={mode === 'scan' ? 'Stop scanning codes' : 'Scan a QR code or barcode'}
            active={mode === 'scan'}
            onPress={() => {
              scannable.current = true;
              setMode(mode === 'scan' ? 'photo' : 'scan');
            }}
          />
          <IconBubble
            icon={torch ? <Zap size={20} color={theme.brand.onSolid} /> : <ZapOff size={20} color={theme.brand.onSolid} />}
            label={torch ? 'Turn the light off' : 'Turn the light on'}
            active={torch}
            onPress={() => setTorch((current) => !current)}
          />
        </View>
      </SafeAreaView>

      <View style={styles.reticleWrap} pointerEvents="none">
        <View style={[styles.reticle, mode === 'scan' ? styles.reticleScan : null]}>
          <View style={[styles.corner, styles.cornerTopLeft]} />
          <View style={[styles.corner, styles.cornerTopRight]} />
          <View style={[styles.corner, styles.cornerBottomLeft]} />
          <View style={[styles.corner, styles.cornerBottomRight]} />
        </View>
        <Text style={styles.hint}>
          {mode === 'scan'
            ? 'Hold a product label or QR code inside the frame'
            : 'Point at a product and fill the frame'}
        </Text>
      </View>

      <View style={styles.controls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose from the gallery"
          onPress={onOpenPicker}
          style={styles.sideControl}
        >
          {galleryThumb === null ? (
            <Images size={24} color={theme.brand.onSolid} accessible={false} />
          ) : (
            <View style={styles.galleryThumbFrame}>
              <Thumb uri={galleryThumb} />
            </View>
          )}
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Take the photo"
          accessibilityState={{ busy }}
          disabled={busy || !ready}
          onPress={() => void capture()}
          style={({ pressed }) => [
            styles.shutter,
            pressed ? styles.shutterPressed : null,
            ready ? null : styles.shutterDisabled,
          ]}
        >
          <View style={styles.shutterRing}>
            {busy ? (
              <ActivityIndicator color={theme.brand.primary} />
            ) : (
              <View style={styles.shutterCore} />
            )}
          </View>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Switch between the front and back camera"
          onPress={() => setFacing((current) => (current === 'back' ? 'front' : 'back'))}
          style={styles.sideControl}
        >
          <RefreshCcw size={22} color={theme.brand.onSolid} accessible={false} />
        </Pressable>
      </View>

      <AlbumPanel
        tab={tab}
        onTab={(next) => {
          setTab(next);
          if (next === 'album' && album.length === 0) void loadAlbum(true);
        }}
        expanded={expanded}
        onExpanded={setExpanded}
        album={album}
        history={history}
        albumNotice={albumNotice}
        onRequestAlbum={() => void loadAlbum(true)}
        onPick={onPickUri}
        onOpenPicker={onOpenPicker}
        onClearHistory={onClearHistory}
      />
    </View>
  );
}

function IconBubble({
  icon,
  label,
  onPress,
  active = false,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      hitSlop={6}
      style={[styles.bubble, active ? styles.bubbleActive : null]}
    >
      {icon}
    </Pressable>
  );
}

function Thumb({ uri }: { uri: string }) {
  return <Image source={{ uri }} style={styles.galleryThumb} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[3],
    padding: theme.spacing[6],
    backgroundColor: theme.colors.navy,
  },
  permissionTitle: {
    color: theme.brand.onSolid,
    fontSize: 20,
    fontWeight: theme.fontWeights.semibold,
    textAlign: 'center',
  },
  permissionBody: {
    color: theme.brand.muted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 320,
  },
  permissionLink: { color: theme.brand.sky, fontSize: 14, fontWeight: theme.fontWeights.semibold },
  topScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 140,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
  },
  topBarWrap: { position: 'absolute', top: 0, left: 0, right: 0 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
  },
  spacer: { flex: 1 },
  bubble: {
    width: theme.touchTarget,
    height: theme.touchTarget,
    borderRadius: theme.touchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.42)',
  },
  bubbleActive: { backgroundColor: theme.brand.primary },
  reticleWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.spacing[4] },
  reticle: { width: '72%', aspectRatio: 1, maxWidth: 320, maxHeight: 320 },
  reticleScan: { aspectRatio: 1.15, maxWidth: 300 },
  corner: { position: 'absolute', width: 28, height: 28, borderColor: 'rgba(255,255,255,0.9)' },
  cornerTopLeft: { left: 0, top: 0, borderLeftWidth: 3, borderTopWidth: 3, borderTopLeftRadius: 14 },
  cornerTopRight: { right: 0, top: 0, borderRightWidth: 3, borderTopWidth: 3, borderTopRightRadius: 14 },
  cornerBottomLeft: { left: 0, bottom: 0, borderLeftWidth: 3, borderBottomWidth: 3, borderBottomLeftRadius: 14 },
  cornerBottomRight: { right: 0, bottom: 0, borderRightWidth: 3, borderBottomWidth: 3, borderBottomRightRadius: 14 },
  hint: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: theme.spacing[6],
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing[6],
    paddingVertical: theme.spacing[4],
  },
  sideControl: {
    width: theme.touchTarget,
    height: theme.touchTarget,
    borderRadius: theme.touchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.42)',
  },
  galleryThumbFrame: {
    width: theme.touchTarget - 8,
    height: theme.touchTarget - 8,
    borderRadius: theme.radii.input,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  galleryThumb: { width: '100%', height: '100%' },
  shutter: { alignItems: 'center', justifyContent: 'center' },
  shutterPressed: { opacity: 0.8 },
  shutterDisabled: { opacity: 0.5 },
  shutterRing: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterCore: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: theme.brand.onSolid,
  },
});
