import { act, screen, userEvent, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { SearchField } from '@/features/catalog/search-field';
import { page, productId, summary } from '../features/catalog/test-fixtures';
import { createFakeApiClient, type FakeApiClient } from '../test-utils/api-fakes';
import { renderWithProviders, resetAsyncStorage } from '../test-utils/render-with-providers';
import {
  isVoiceSearchSupported,
  setNativeSpeechForTests,
  type NativeSpeech,
} from '@/voice/native-speech';
import { STOP_TIMEOUT_MS } from '@/voice/use-voice-search';
import { interpretVoiceQuery } from '@/voice/voice-intent';
import { VoiceSearchModal } from '@/voice/voice-search-modal';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

const mockGetPermission = jest.fn();
const mockRequestPermission = jest.fn();
jest.mock('expo-audio', () => ({
  getRecordingPermissionsAsync: () => mockGetPermission() as unknown,
  requestRecordingPermissionsAsync: () => mockRequestPermission() as unknown,
}));

type Listener = (payload: never) => void;

/** A stand-in for the Android recognizer: records what the app asked and lets a test speak. */
function fakeRecognizer() {
  const listeners = new Map<string, Set<Listener>>();
  const calls: string[] = [];
  const module: NativeSpeech = {
    isAvailable: () => true,
    start: (locale, forceLanguage) => {
      // `:forced` marks an attempt that named one language, so tests can tell a first listen
      // (which lets the platform identify the language) from an automatic second attempt.
      calls.push(`start:${locale}${forceLanguage === true ? ':forced' : ''}`);
      return Promise.resolve();
    },
    stop: () => {
      calls.push('stop');
      return Promise.resolve();
    },
    cancel: () => {
      calls.push('cancel');
      return Promise.resolve();
    },
    addListener: (event, listener) => {
      const set = listeners.get(event) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(event, set);
      return { remove: () => set.delete(listener) };
    },
  };
  async function emit(event: string, payload: object) {
    await act(() => {
      for (const listener of listeners.get(event) ?? []) listener(payload as never);
      return Promise.resolve();
    });
  }
  return { module, calls, emit };
}

/** The window needs the API provider now that it previews how many products the words find. */
async function open(
  onConfirm = jest.fn(),
  onClose = jest.fn(),
  api: FakeApiClient = createFakeApiClient(),
) {
  const view = await renderWithProviders(
    <VoiceSearchModal visible onClose={onClose} onConfirm={onConfirm} />,
    { api },
  );
  return { onConfirm, onClose, ...view };
}

/** Waits for the preview's debounce and its answer, then returns it. */
const previewSettled = (label: 'Results' | 'No results') =>
  waitFor(() => expect(screen.getByLabelText(`Voice search: ${label}`)).toBeOnTheScreen());

beforeEach(async () => {
  mockGetPermission.mockResolvedValue({ granted: true, canAskAgain: true });
  mockRequestPermission.mockResolvedValue({ granted: true, canAskAgain: true });
  await resetAsyncStorage();
});
afterEach(() => {
  setNativeSpeechForTests(undefined);
  jest.clearAllMocks();
});

describe('voice search window', () => {
  it('listens at once, shows the words as they come, and searches once with the final text', async () => {
    const speech = fakeRecognizer();
    setNativeSpeechForTests(speech.module);
    const { onConfirm } = await open();

    expect(await screen.findByText(/Listening/)).toBeOnTheScreen();
    expect(speech.calls).toContain('start:en-US');
    // The permission prompt is only raised when the microphone is not already allowed.
    expect(mockRequestPermission).not.toHaveBeenCalled();

    await speech.emit('onPartial', { text: 'blue pan' });
    expect(screen.getByDisplayValue('blue pan')).toBeOnTheScreen();
    await speech.emit('onResult', { text: ' blue panjabi ' });
    expect(screen.getByText('Check what we heard')).toBeOnTheScreen();

    const user = userEvent.setup();
    const search = screen.getByRole('button', { name: 'Search' });
    await user.press(search);
    await user.press(search);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('blue panjabi');
  });

  it('asks for the microphone only when needed, and says so when it is refused for good', async () => {
    const speech = fakeRecognizer();
    setNativeSpeechForTests(speech.module);
    mockGetPermission.mockResolvedValue({ granted: false, canAskAgain: true });
    mockRequestPermission.mockResolvedValue({ granted: false, canAskAgain: false });
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    await open();

    expect(await screen.findByText(/Microphone access is turned off/)).toBeOnTheScreen();
    expect(speech.calls.some((call) => call.startsWith('start'))).toBe(false);
    const user = userEvent.setup();
    await user.press(screen.getByRole('button', { name: 'Open settings' }));
    expect(openSettings).toHaveBeenCalled();
  });

  it('explains silence, lets the customer try again, and keeps Search off until there is text', async () => {
    const speech = fakeRecognizer();
    setNativeSpeechForTests(speech.module);
    await open();
    await screen.findByText(/Listening/);

    await speech.emit('onError', { code: 'no_speech' });
    expect(screen.getByText(/We did not hear anything/)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();

    const user = userEvent.setup();
    await user.press(screen.getByRole('button', { name: 'Try again' }));
    expect(speech.calls.filter((call) => call.startsWith('start'))).toHaveLength(2);
  });

  it('names a network failure and an unsupported language instead of failing silently', async () => {
    const speech = fakeRecognizer();
    setNativeSpeechForTests(speech.module);
    await open();
    await screen.findByText(/Listening/);

    await speech.emit('onError', { code: 'network' });
    expect(screen.getByText(/needs an internet connection/)).toBeOnTheScreen();

    const user = userEvent.setup();
    await user.press(screen.getByRole('button', { name: 'Try again' }));
    // A phone without the model for the language it listened in: one automatic attempt in the
    // other language, and only then the message.
    await speech.emit('onError', { code: 'language' });
    expect(speech.calls).toContain('start:bn-BD:forced');
    await speech.emit('onError', { code: 'language' });
    expect(screen.getByText(/not available for voice input/)).toBeOnTheScreen();
  });

  it('listens again in the other language when it hears speech but matches no words', async () => {
    const speech = fakeRecognizer();
    setNativeSpeechForTests(speech.module);
    await open();
    await screen.findByText(/Listening/);
    expect(speech.calls).toEqual(['start:en-US']);

    // The engine reported hearing speech, then found nothing: a Bangla request heard by an
    // English attempt sounds exactly like this. The window listens again in Bangla by itself,
    // without asking the customer to change a setting.
    await speech.emit('onState', { state: 'hearing' });
    await speech.emit('onError', { code: 'no_speech' });
    expect(speech.calls).toContain('start:bn-BD:forced');
    expect(screen.queryByText(/We did not hear anything/)).not.toBeOnTheScreen();

    // That second attempt is the last one: a further failure is reported, not retried again.
    await speech.emit('onState', { state: 'hearing' });
    await speech.emit('onError', { code: 'no_speech' });
    expect(screen.getByText(/We did not hear anything/)).toBeOnTheScreen();
    expect(speech.calls.filter((call) => call.startsWith('start'))).toHaveLength(2);
  });

  it('keeps the language the engine identified for the request it heard', async () => {
    const speech = fakeRecognizer();
    setNativeSpeechForTests(speech.module);
    await open();
    await screen.findByText(/Listening/);

    // Android 14 and later name the language before the final text arrives.
    await speech.emit('onLanguage', { language: 'bn-IN' });
    await speech.emit('onResult', { text: 'কালো টি-শার্ট', language: 'bn-IN' });
    expect(screen.getByText('Check what we heard')).toBeOnTheScreen();
    // Bangla speech stays Bangla, and the chip names Bangla; the words searched are the same
    // ones the same sentence produces when it is typed.
    expect(screen.getByLabelText('Heard as Bangla')).toBeOnTheScreen();
    expect(screen.getByDisplayValue('black t-shirt')).toBeOnTheScreen();
  });

  it('offers no language picker, and turns a Banglish request into the words to search', async () => {
    const speech = fakeRecognizer();
    setNativeSpeechForTests(speech.module);
    await open();
    await screen.findByText(/Listening/);

    // The language comes from the phone; there is nothing to choose.
    expect(screen.queryByRole('button', { name: 'বাংলা' })).not.toBeOnTheScreen();
    expect(screen.queryByText('Language')).not.toBeOnTheScreen();

    // "Ami ekta black t-shirt chai": the request words are dropped and what is left is the
    // search — the English product word kept exactly as the customer said it.
    await speech.emit('onPartial', { text: 'Ami ekta black t-shirt chai' });
    expect(screen.getByDisplayValue('black t-shirt')).toBeOnTheScreen();
    expect(screen.getByText(/You said: Ami ekta black t-shirt chai/)).toBeOnTheScreen();
    // And the window says which way they spoke: romanised Bangla is shown as Bangla, and the
    // word "Banglish" is never shown to the customer anywhere in the window.
    expect(screen.getByText('বাংলা')).toBeOnTheScreen();
    expect(screen.queryByText(/banglish/i)).not.toBeOnTheScreen();
    expect(screen.getByText('English or Bangla')).toBeOnTheScreen();
  });

  it('stops listening when the customer edits the words, and keeps what they typed', async () => {
    const speech = fakeRecognizer();
    setNativeSpeechForTests(speech.module);
    await open();
    await screen.findByText(/Listening/);
    await speech.emit('onPartial', { text: 'red sh' });

    const user = userEvent.setup();
    const field = screen.getByLabelText('What we heard. You can edit it.');
    await user.clear(field);
    await user.type(field, 'red shirt');

    expect(speech.calls).toContain('cancel');
    // A late partial result never overwrites what was typed.
    await speech.emit('onPartial', { text: 'red shoes' });
    expect(screen.getByDisplayValue('red shirt')).toBeOnTheScreen();
  });

  it('releases the microphone when the window closes', async () => {
    const speech = fakeRecognizer();
    setNativeSpeechForTests(speech.module);
    const view = await open();
    await screen.findByText(/Listening/);
    speech.calls.length = 0;

    await view.rerender(
      <VoiceSearchModal visible={false} onClose={jest.fn()} onConfirm={jest.fn()} />,
    );
    expect(speech.calls).toContain('cancel');
  });
});

describe('how many products the words find', () => {
  it('says how many matched, asking the catalogue once for the settled words', async () => {
    const speech = fakeRecognizer();
    setNativeSpeechForTests(speech.module);
    const api = createFakeApiClient();
    api.listProducts.mockResolvedValue(
      page([summary({ id: productId(1), slug: 'black-shirt', name: 'Black shirt' })]),
    );
    await open(jest.fn(), jest.fn(), api);
    await screen.findByText(/Listening/);

    await speech.emit('onResult', { text: 'black shirt' });
    await previewSettled('Results');

    expect(screen.getByText('Results found')).toBeOnTheScreen();
    expect(screen.getByText('1 product found')).toBeOnTheScreen();
    // One request for the settled words, not one per partial result.
    expect(api.listProducts).toHaveBeenCalledTimes(1);
    expect(api.listProducts.mock.calls[0]?.[0]).toMatchObject({ q: 'black shirt', page: 1 });
  });

  it('says nothing was found instead of pretending, and still lets the customer search', async () => {
    const speech = fakeRecognizer();
    setNativeSpeechForTests(speech.module);
    const api = createFakeApiClient();
    api.listProducts.mockResolvedValue(page([]));
    const onConfirm = jest.fn();
    await open(onConfirm, jest.fn(), api);
    await screen.findByText(/Listening/);

    await speech.emit('onResult', { text: 'purple unicorn' });
    await previewSettled('No results');

    expect(screen.getByText('No products found')).toBeOnTheScreen();
    expect(screen.getByText(/Nothing matched those words/)).toBeOnTheScreen();

    const user = userEvent.setup();
    await user.press(screen.getByRole('button', { name: 'Search anyway' }));
    expect(onConfirm).toHaveBeenCalledWith('purple unicorn');
  });
});

describe('stopping', () => {
  it('shows the words heard so far when the recognizer never answers after Stop', async () => {
    jest.useFakeTimers();
    try {
      const speech = fakeRecognizer();
      setNativeSpeechForTests(speech.module);
      await open();
      await act(() => {
        jest.advanceTimersByTime(0);
      });
      await speech.emit('onPartial', { text: 'blue panjabi' });

      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      await user.press(screen.getByRole('button', { name: 'Stop' }));
      await act(() => {
        jest.advanceTimersByTime(STOP_TIMEOUT_MS + 50);
      });

      // The words heard so far are shown instead of a spinner that never ends.
      expect(screen.getByText('Check what we heard')).toBeOnTheScreen();
      expect(screen.getByDisplayValue('blue panjabi')).toBeOnTheScreen();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('one query for every way of asking', () => {
  it('searches the same words for English, Bangla, Banglish and mixed speech', () => {
    const english = interpretVoiceQuery('Show me black t-shirts');
    const bangla = interpretVoiceQuery('আমাকে কালো টি-শার্ট দেখাও');
    const banglish = interpretVoiceQuery('Amake kalo t-shirt dekhao');
    const mixed = interpretVoiceQuery('Black t-shirt দেখাও');

    for (const intent of [english, bangla, banglish, mixed]) {
      // The catalogue search is case-insensitive, so what matters is that all four ask for the
      // same words; the customer's own capitalisation is kept as they said it.
      expect(intent.query.toLowerCase()).toBe('black t-shirt');
    }
    // The customer's own words are kept for the window, and the language is named.
    expect(bangla.heard).toBe('আমাকে কালো টি-শার্ট দেখাও');
    expect(bangla.language).toBe('bangla');
    expect(banglish.language).toBe('banglish');
    expect(mixed.language).toBe('mixed');
    expect(english.language).toBe('english');
  });

  it('keeps product names, sizes and colours exactly as the catalogue spells them', () => {
    // A product name is not a word to translate.
    expect(interpretVoiceQuery('show me panjabi').query).toBe('panjabi');
    expect(interpretVoiceQuery('আমাকে পাঞ্জাবি দেখাও').query).toBe('panjabi');
    expect(interpretVoiceQuery('amake panjabi dekhao').query).toBe('panjabi');
    // Sizes and numbers survive untouched.
    expect(interpretVoiceQuery('black tshirt xl chai').query).toBe('black t-shirt xl');
    // An unknown word is searched for exactly as it was said.
    expect(interpretVoiceQuery('amake fuchsia hoodie dao').query).toBe('fuchsia hoodie');
  });

  it('covers the garments people name in Banglish and Bangla', () => {
    const cases: [string, string][] = [
      ['amake ekta genji dekhao', 't-shirt'],
      ['আমাকে একটা গেঞ্জি দেখাও', 't-shirt'],
      ['amar ekta jama dorkar', 'shirt'],
      ['amake kalo pant chai', 'black pant'],
      ['amake chosma dekhao', 'glasses'],
      ['আমাকে কালো জুতা দেখাও', 'black shoe'],
      ['amake lal saree dekhao', 'red saree'],
    ];
    for (const [spoken, expected] of cases) {
      expect(interpretVoiceQuery(spoken).query).toBe(expected);
    }
  });
});

describe('microphone in the search field', () => {
  it('is offered only when the phone supports voice search', async () => {
    const props = { value: '', onChangeText: jest.fn(), onSubmit: jest.fn(), onClear: jest.fn() };
    setNativeSpeechForTests(null);
    expect(isVoiceSearchSupported()).toBe(false);
    await renderWithProviders(<SearchField {...props} />);
    expect(screen.queryByRole('button', { name: 'Search by voice' })).not.toBeOnTheScreen();

    const onVoice = jest.fn();
    await renderWithProviders(<SearchField {...props} onVoice={onVoice} />);
    const user = userEvent.setup();
    await user.press(screen.getByRole('button', { name: 'Search by voice' }));
    expect(onVoice).toHaveBeenCalledTimes(1);
  });
});
