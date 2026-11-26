import { ApiError } from '@nilzora/api-client';
import { screen } from '@testing-library/react-native';
import { AvatarSection } from '@/features/profile/avatar-section';
import { createFakeApiClient } from '@/test-utils/api-fakes';
import { renderWithProviders } from '@/test-utils/render-with-providers';
import {
  createControllableManager,
  FAKE_ACCESS_TOKEN,
  signedInState,
} from '@/test-utils/session-fakes';
import {
  choose,
  chooseNothing,
  FakeUploadTask,
  fakeAsset,
  lastTask,
  launchImageLibraryAsync,
  picture,
  inAct,
} from '@/test-utils/upload-fakes';

jest.mock(
  'expo-file-system',
  () =>
    jest.requireActual<{ expoFileSystemMock: object }>('@/test-utils/upload-fakes')
      .expoFileSystemMock,
);
jest.mock(
  'expo-image-picker',
  () =>
    jest.requireActual<{ expoImagePickerMock: object }>('@/test-utils/upload-fakes')
      .expoImagePickerMock,
);
jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

const originalBase = process.env.EXPO_PUBLIC_API_BASE_URL;
beforeEach(() => {
  FakeUploadTask.reset();
  launchImageLibraryAsync.mockReset();
  process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.test';
});
afterAll(() => {
  process.env.EXPO_PUBLIC_API_BASE_URL = originalBase;
});

async function setup(currentUrl: string | null = null) {
  const manager = createControllableManager(signedInState());
  const api = createFakeApiClient();
  const view = await renderWithProviders(
    <AvatarSection name="Ayesha Rahman" currentUrl={currentUrl} manager={manager} />,
    { api, session: manager },
  );
  return { ...view, manager, api };
}

async function pickAndSave(user: Awaited<ReturnType<typeof setup>>['user']) {
  choose(fakeAsset());
  await user.press(screen.getByRole('button', { name: 'Choose a picture' }));
  await user.press(await screen.findByRole('button', { name: 'Save picture' }));
}

describe('AvatarSection', () => {
  it('starts from the initials with nothing to remove', async () => {
    await setup();

    expect(screen.getByRole('button', { name: 'Choose a picture' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Remove picture' })).not.toBeOnTheScreen();
    expect(screen.getByText('AR')).toBeOnTheScreen();
  });

  it('previews the choice and sends nothing until "Save picture"', async () => {
    const { user } = await setup();
    choose(fakeAsset({ fileName: 'holiday.jpg' }));

    await user.press(screen.getByRole('button', { name: 'Choose a picture' }));

    expect(await screen.findByLabelText('Preview of holiday.jpg')).toBeOnTheScreen();
    expect(screen.getByText('holiday.jpg is ready to save.')).toBeOnTheScreen();
    expect(FakeUploadTask.all).toHaveLength(0);
  });

  it('refuses a picture the API cannot take, before any byte is sent', async () => {
    const { user } = await setup();
    choose(fakeAsset({ fileName: 'move.gif', mimeType: 'image/gif' }));

    await user.press(screen.getByRole('button', { name: 'Choose a picture' }));

    expect(await screen.findByText(/Upload a JPEG, PNG or WebP picture/)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Save picture' })).not.toBeOnTheScreen();
    expect(FakeUploadTask.all).toHaveLength(0);
  });

  it('does nothing when the person backs out of the picker', async () => {
    const { user } = await setup();
    chooseNothing();

    await user.press(screen.getByRole('button', { name: 'Choose a picture' }));

    expect(screen.queryByRole('button', { name: 'Save picture' })).not.toBeOnTheScreen();
    expect(screen.queryByRole('alert')).not.toBeOnTheScreen();
  });

  it("uploads to the signed-in user's own endpoint with the real bytes, and only then saves", async () => {
    const { user, manager } = await setup();
    await pickAndSave(user);

    const task = lastTask();
    expect(task.url).toBe('https://api.example.test/api/v1/me/avatar');
    expect(task.options.headers).toMatchObject({ Authorization: `Bearer ${FAKE_ACCESS_TOKEN}` });

    await inAct(() => {
      task.progress(50_000, 200_000);
    });
    expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({ now: 25 });
    expect(screen.getByText(/25%/)).toBeOnTheScreen();

    // Every byte is out: the app now waits for the server instead of claiming success.
    await inAct(() => {
      task.progress(200_000, 200_000);
    });
    expect(screen.getByText(/Checking and saving/)).toBeOnTheScreen();
    expect(screen.queryByText('Picture saved.')).not.toBeOnTheScreen();
    expect(manager.setAvatar).not.toHaveBeenCalled();

    await inAct(() => {
      task.answer(200, { avatar: picture });
    });
    expect(await screen.findByText('Picture saved.')).toBeOnTheScreen();
    expect(manager.setAvatar).toHaveBeenCalledWith(picture);
  });

  it('ignores a second press while the first upload is running', async () => {
    const { user } = await setup();
    choose(fakeAsset());
    await user.press(screen.getByRole('button', { name: 'Choose a picture' }));
    const save = await screen.findByRole('button', { name: 'Save picture' });

    await user.press(save);
    await user.press(save);

    expect(FakeUploadTask.all).toHaveLength(1);
  });

  it('shows the API refusal in plain words and lets the person send again', async () => {
    const { user, manager } = await setup();
    await pickAndSave(user);

    await inAct(() => {
      lastTask().progress(200_000, 200_000);
      lastTask().answer(422, { error: { code: 'image_invalid', message: 'bad' } });
    });

    expect(await screen.findByText(/could not be used/)).toBeOnTheScreen();
    expect(manager.setAvatar).not.toHaveBeenCalled();
    await user.press(screen.getByRole('button', { name: 'Try again' }));
    expect(FakeUploadTask.all).toHaveLength(2);
  });

  it('offers a retry only when the connection broke before everything was sent', async () => {
    const { user, manager } = await setup();
    await pickAndSave(user);
    await inAct(() => {
      lastTask().progress(1_000, 200_000);
      lastTask().fail();
    });
    expect(await screen.findByText(/Nothing was saved/)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Try again' }));
    await inAct(() => {
      lastTask().progress(200_000, 200_000);
      lastTask().fail();
    });
    // It may have been saved: no automatic or one-tap retry that could duplicate it.
    expect(await screen.findByText(/before Nilzora confirmed/)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeOnTheScreen();
    expect(manager.setAvatar).not.toHaveBeenCalled();
  });

  it('cancels while bytes are going out and changes nothing', async () => {
    const { user, manager } = await setup();
    await pickAndSave(user);
    await inAct(() => {
      lastTask().progress(1_000, 200_000);
    });

    await user.press(screen.getByRole('button', { name: 'Cancel upload' }));

    expect(await screen.findByText(/Upload cancelled/)).toBeOnTheScreen();
    expect(manager.setAvatar).not.toHaveBeenCalled();
  });

  it('removes the picture through the API and goes back to the initials', async () => {
    const { user, manager, api } = await setup(picture.thumbUrl);
    api.removeMyAvatar.mockResolvedValue({ avatar: null });

    await user.press(screen.getByRole('button', { name: 'Remove picture' }));

    expect(api.removeMyAvatar).toHaveBeenCalledWith(FAKE_ACCESS_TOKEN);
    expect(await screen.findByText('Profile picture removed.')).toBeOnTheScreen();
    expect(manager.setAvatar).toHaveBeenCalledWith(null);
  });

  it('keeps the picture and says so when removing fails', async () => {
    const { user, manager, api } = await setup(picture.thumbUrl);
    api.removeMyAvatar.mockRejectedValue(new ApiError(500, 'internal_error', 'boom'));

    await user.press(screen.getByRole('button', { name: 'Remove picture' }));

    expect(await screen.findByRole('alert')).toBeOnTheScreen();
    expect(manager.setAvatar).not.toHaveBeenCalled();
  });
});
