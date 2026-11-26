/**
 * A stand-in for `expo-document-picker`. Each test says what the picker will hand back; the
 * module exports the same `getDocumentAsync` shape the real one does.
 */

interface PickedAsset {
  name: string;
  mimeType?: string | undefined;
  size?: number | undefined;
  uri: string;
}

type Outcome = { kind: 'cancel' } | { kind: 'assets'; asset: PickedAsset };

let outcome: Outcome = { kind: 'cancel' };

export const FakeDocumentPicker = {
  reset(): void {
    outcome = { kind: 'cancel' };
  },
  next(asset: PickedAsset): void {
    outcome = { kind: 'assets', asset };
  },
  cancel(): void {
    outcome = { kind: 'cancel' };
  },
  calls: [] as unknown[],
};

export const expoDocumentPickerMock = {
  getDocumentAsync: (options: unknown) => {
    FakeDocumentPicker.calls.push(options);
    if (outcome.kind === 'cancel') return Promise.resolve({ canceled: true, assets: null });
    return Promise.resolve({
      canceled: false,
      assets: [
        {
          name: outcome.asset.name,
          mimeType: outcome.asset.mimeType ?? null,
          size: outcome.asset.size,
          uri: outcome.asset.uri,
        },
      ],
    });
  },
};
