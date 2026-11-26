import { screen } from '@testing-library/react-native';
import { ReviewForm } from '@/features/reviews/review-form';
import { myReview, productId } from '@/features/reviews/test-fixtures';
import { createFakeApiClient } from '@/test-utils/api-fakes';
import { renderWithProviders } from '@/test-utils/render-with-providers';
import { FAKE_ACCESS_TOKEN } from '@/test-utils/session-fakes';
import {
  choose,
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

const REVIEW_ID = '44444444-4444-4444-8444-444444444444';
const IMAGE_ID = '55555555-5555-4555-8555-555555555555';
const originalBase = process.env.EXPO_PUBLIC_API_BASE_URL;

beforeEach(() => {
  FakeUploadTask.reset();
  launchImageLibraryAsync.mockReset();
  process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.test';
});
afterAll(() => {
  process.env.EXPO_PUBLIC_API_BASE_URL = originalBase;
});

function reviewImage(id = IMAGE_ID) {
  return { id, ...picture };
}

async function setup() {
  const api = createFakeApiClient();
  api.submitProductReview.mockResolvedValue({ reviewId: REVIEW_ID });
  api.myProductReview.mockResolvedValue(myReview({ eligible: true }));
  const view = await renderWithProviders(<ReviewForm productId={productId} />, { api });
  return { ...view, api };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function fillReview(user: Setup['user']) {
  await user.press(screen.getByRole('radio', { name: '5 stars out of 5' }));
  await user.type(screen.getByLabelText('Your review'), 'Soft cotton and the fit is right.');
}

async function addPhotos(user: Setup['user'], ...names: string[]) {
  choose(
    ...names.map((n) =>
      fakeAsset({ uri: `file:///cache/${n}`, fileName: n, width: 900, height: 900 }),
    ),
  );
  await user.press(screen.getByRole('button', { name: /^Add (more )?photos$/ }));
}

/** Gives the next upload task a server answer: the photo is stored. */
async function accept(id = IMAGE_ID) {
  await inAct(() => {
    lastTask().progress(200_000, 200_000);
    lastTask().answer(201, { image: reviewImage(id), images: [reviewImage(id)] });
  });
}

describe('review photos', () => {
  it('lists chosen photos with a remove button, and sends nothing yet', async () => {
    const { user } = await setup();

    await addPhotos(user, 'front.jpg', 'back.jpg');

    expect(await screen.findByLabelText(/^front.jpg/)).toBeOnTheScreen();
    expect(screen.getByLabelText(/^back.jpg/)).toBeOnTheScreen();
    expect(screen.getAllByLabelText(/Waiting to be sent/)).toHaveLength(2);
    expect(FakeUploadTask.all).toHaveLength(0);

    await user.press(screen.getByRole('button', { name: 'Remove front.jpg' }));
    expect(screen.queryByLabelText(/^front.jpg/)).not.toBeOnTheScreen();
  });

  it('keeps to four photos and refuses a duplicate', async () => {
    const { user } = await setup();
    await addPhotos(user, 'a.jpg', 'b.jpg', 'c.jpg', 'd.jpg');
    expect(launchImageLibraryAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ selectionLimit: 4 }),
    );

    expect(screen.getByRole('button', { name: 'Add more photos' })).toBeDisabled();

    await user.press(screen.getByRole('button', { name: 'Remove d.jpg' }));
    await addPhotos(user, 'a.jpg');
    expect(await screen.findByText(/already in your list/)).toBeOnTheScreen();
    expect(screen.getAllByLabelText(/^a.jpg/)).toHaveLength(1);
  });

  it('refuses a photo that is too small before sending anything', async () => {
    const { user } = await setup();
    choose(fakeAsset({ fileName: 'tiny.jpg', width: 200, height: 200 }));

    await user.press(screen.getByRole('button', { name: 'Add photos' }));

    expect(await screen.findByText(/too small/)).toBeOnTheScreen();
    expect(screen.queryByText('tiny.jpg')).not.toBeOnTheScreen();
  });

  it('saves the review first, then sends each photo to that review with real byte progress', async () => {
    const { user, api, queryClient } = await setup();
    const refresh = jest.spyOn(queryClient, 'invalidateQueries');
    await fillReview(user);
    await addPhotos(user, 'front.jpg', 'back.jpg');

    await user.press(screen.getByRole('button', { name: 'Post review' }));

    expect(api.submitProductReview).toHaveBeenCalledTimes(1);
    expect(api.submitProductReview.mock.calls[0]?.[1]).toBe(productId);
    // The saved review is not re-read (which would replace this form) while photos are going.
    expect(refresh).not.toHaveBeenCalled();
    // The first photo is on its way to the saved review, under the caller's own token.
    expect(lastTask().url).toBe(`https://api.example.test/api/v1/me/reviews/${REVIEW_ID}/images`);
    expect(lastTask().options.headers).toMatchObject({
      Authorization: `Bearer ${FAKE_ACCESS_TOKEN}`,
    });
    await inAct(() => {
      lastTask().progress(100_000, 200_000);
    });
    expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({ now: 50 });
    expect(FakeUploadTask.all).toHaveLength(1); // one at a time

    await accept();
    expect(FakeUploadTask.all).toHaveLength(2);
    expect(refresh).not.toHaveBeenCalled();
    await accept('66666666-6666-4666-8666-666666666666');

    // Only now, with every photo confirmed, is the saved review re-read.
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not say a photo is added until the server confirms it', async () => {
    const { user } = await setup();
    await fillReview(user);
    await addPhotos(user, 'front.jpg');
    await user.press(screen.getByRole('button', { name: 'Post review' }));

    await inAct(() => {
      lastTask().progress(200_000, 200_000);
    });

    expect(screen.getByText(/Checking and saving/)).toBeOnTheScreen();
    expect(screen.queryByLabelText(/Added to your review/)).not.toBeOnTheScreen();
  });

  it('keeps the saved review and retries only the failed photo, never posting the review twice', async () => {
    const { user, api } = await setup();
    await fillReview(user);
    await addPhotos(user, 'front.jpg', 'back.jpg');
    await user.press(screen.getByRole('button', { name: 'Post review' }));

    await accept(); // front.jpg stored
    await inAct(() => {
      lastTask().progress(1_000, 200_000);
      lastTask().fail(); // back.jpg breaks mid-transfer
    });

    expect(await screen.findByText(/Your review was saved/)).toBeOnTheScreen();
    expect(screen.getByLabelText(/Added to your review/)).toBeOnTheScreen();
    expect(screen.getByText(/Nothing was saved/)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Post review' })).not.toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Try the remaining photos again' }));
    // Only the failed photo goes again, to the same review.
    expect(FakeUploadTask.all).toHaveLength(3);
    expect(lastTask().url).toContain(`/me/reviews/${REVIEW_ID}/images`);
    await accept('77777777-7777-4777-8777-777777777777');

    expect(api.submitProductReview).toHaveBeenCalledTimes(1);
  });

  it('shows the API refusal for one photo without touching the others', async () => {
    const { user } = await setup();
    await fillReview(user);
    await addPhotos(user, 'front.jpg');
    await user.press(screen.getByRole('button', { name: 'Post review' }));

    await inAct(() => {
      lastTask().progress(200_000, 200_000);
      lastTask().answer(409, { error: { code: 'review_photos_locked', message: 'locked' } });
    });

    expect(await screen.findByText(/soon after a review is posted/)).toBeOnTheScreen();
    expect(screen.getByLabelText(/front.jpg. Not added/)).toBeOnTheScreen();
  });

  it("deletes a stored photo through the API, only from the caller's own review", async () => {
    const { user, api } = await setup();
    api.removeReviewImage.mockResolvedValue({ images: [] });
    await fillReview(user);
    await addPhotos(user, 'front.jpg', 'back.jpg');
    await user.press(screen.getByRole('button', { name: 'Post review' }));
    await accept(); // front stored
    await inAct(() => {
      lastTask().fail(); // back fails, so the form stays
    });

    await user.press(await screen.findByRole('button', { name: 'Delete front.jpg' }));

    expect(api.removeReviewImage).toHaveBeenCalledWith(FAKE_ACCESS_TOKEN, IMAGE_ID);
    expect(screen.queryByLabelText(/^front.jpg/)).not.toBeOnTheScreen();
  });

  it('posts a review with no photos exactly as before', async () => {
    const { user, api } = await setup();
    await fillReview(user);

    await user.press(screen.getByRole('button', { name: 'Post review' }));

    expect(api.submitProductReview).toHaveBeenCalledTimes(1);
    expect(FakeUploadTask.all).toHaveLength(0);
  });
});
