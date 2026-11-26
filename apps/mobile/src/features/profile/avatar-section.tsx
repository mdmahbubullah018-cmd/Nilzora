import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { SessionManager } from '@/auth/session-manager';
import { Avatar } from '@/components/avatar';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Notice } from '@/components/notice';
import { UploadProgress } from '@/components/upload-progress';
import { useAuthorizedApi } from '@/query';
import { theme } from '@/theme';
import { AVATAR_MAX_BYTES, AVATAR_MIN_SIZE } from '@nilzora/contracts';
import { pickImages, type PickedImage } from '@/uploads/pick-images';
import { sendAvatar } from '@/uploads/send-pictures';
import { describeUploadError, useNativeUpload } from '@/uploads/use-upload';

/*
 * The customer's profile picture. Choosing a picture only previews it; nothing is sent until
 * "Save picture". While it is sent the bar shows the bytes the phone has really sent, then the
 * app waits for Nilzora to check and save it, and the new picture replaces the old one only
 * after that answer arrives. The picture belongs to whoever is signed in: the app names no
 * account anywhere in the request.
 */

export interface AvatarSectionProps {
  name: string;
  currentUrl: string | null;
  /** The picture Google supplied; shown until the customer uploads their own. */
  googleUrl?: string | null;
  manager: SessionManager;
}

export function AvatarSection({
  name,
  currentUrl,
  googleUrl = null,
  manager,
}: AvatarSectionProps) {
  const run = useAuthorizedApi();
  const upload = useNativeUpload();
  const [chosen, setChosen] = useState<PickedImage | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeFailure, setRemoveFailure] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);

  const locked = upload.busy || removing;

  async function choose() {
    if (locked) return;
    setProblem(null);
    setRemoved(false);
    setRemoveFailure(null);
    const result = await pickImages({
      limit: 1,
      minSide: AVATAR_MIN_SIZE,
      maxBytes: AVATAR_MAX_BYTES,
    });
    if (result.kind === 'cancelled') return;
    if (result.kind === 'error') {
      setProblem(result.message);
      return;
    }
    const first = result.images[0];
    if (!first) {
      setProblem(result.rejected[0] ?? 'This picture could not be used.');
      return;
    }
    upload.reset();
    setChosen(first);
  }

  async function save() {
    const image = chosen;
    if (!image || locked) return;
    const answer = await upload.start(image.fileName, (controls) =>
      sendAvatar(manager, image, controls),
    );
    // Only the server's answer changes what the screen shows as the picture.
    if (answer !== null) {
      manager.setAvatar(answer.avatar);
      setChosen(null);
    }
  }

  async function remove() {
    if (locked) return;
    setRemoving(true);
    setRemoveFailure(null);
    setRemoved(false);
    try {
      const answer = await run((api, accessToken) => api.removeMyAvatar(accessToken));
      manager.setAvatar(answer.avatar);
      setChosen(null);
      upload.reset();
      setRemoved(true);
    } catch (error) {
      setRemoveFailure(describeUploadError(error).message);
    } finally {
      setRemoving(false);
    }
  }

  function discard() {
    if (locked) return;
    setChosen(null);
    upload.reset();
  }

  return (
    <Card style={styles.card}>
      <Text accessibilityRole="header" style={styles.title}>
        Profile picture
      </Text>
      <View style={styles.row}>
        {chosen ? (
          <Image
            source={{ uri: chosen.uri }}
            accessibilityLabel={`Preview of ${chosen.fileName}`}
            accessibilityIgnoresInvertColors
            style={styles.preview}
          />
        ) : (
          <Avatar name={name} size="xl" pictureUrl={currentUrl ?? googleUrl} />
        )}
        <Text style={styles.hint}>
          {chosen
            ? `${chosen.fileName} is ready to save.`
            : currentUrl === null && googleUrl !== null
              ? 'This picture comes from your Google account. Choose another to replace it.'
              : 'JPEG, PNG or WebP, up to 3 MB, at least 128 pixels on each side.'}
        </Text>
      </View>

      {problem ? <Notice tone="danger">{problem}</Notice> : null}
      {removeFailure ? <Notice tone="danger">{removeFailure}</Notice> : null}
      {removed ? <Notice tone="success">Profile picture removed.</Notice> : null}

      <UploadProgress
        state={upload.state}
        onCancel={upload.cancel}
        {...(chosen ? { onRetry: () => void save() } : {})}
      />

      <View style={styles.actions}>
        {chosen ? (
          <>
            <Button
              label="Save picture"
              loading={upload.busy}
              onPress={() => void save()}
              accessibilityHint="Uploads the chosen picture as your profile picture"
            />
            <Button
              label="Choose a different picture"
              variant="secondary"
              onPress={() => void choose()}
              disabled={locked}
            />
            <Button label="Discard" variant="link" onPress={discard} disabled={locked} />
          </>
        ) : (
          <>
            <Button
              label={currentUrl ? 'Change picture' : 'Choose a picture'}
              variant="secondary"
              onPress={() => void choose()}
              disabled={locked}
            />
            {currentUrl ? (
              <Button
                label="Remove picture"
                variant="danger"
                loading={removing}
                disabled={locked}
                onPress={() => void remove()}
                accessibilityHint="Goes back to showing your initials"
              />
            ) : null}
          </>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: theme.spacing[5], gap: theme.spacing[4] },
  title: { color: theme.colors.foreground, ...theme.text.heading, fontSize: 17 },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[4] },
  preview: { width: 96, height: 96, borderRadius: 48 },
  hint: { flex: 1, color: theme.colors.mutedForeground, ...theme.text.caption },
  actions: { gap: theme.spacing[3] },
});
