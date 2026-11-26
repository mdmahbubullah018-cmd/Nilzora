import { describe, expect, it } from 'vitest';
import { parsePageText } from './site-page-text';

describe('parsePageText', () => {
  it('turns blank-line separated text into paragraphs, keeping single line breaks', () => {
    expect(parsePageText('First line\nsecond line\n\nNext paragraph')).toEqual([
      { kind: 'paragraph', text: 'First line\nsecond line' },
      { kind: 'paragraph', text: 'Next paragraph' },
    ]);
  });

  it('reads "# " and "## " lines as headings and "- " runs as one list', () => {
    expect(
      parsePageText('# Delivery\n\n## Dhaka\nInside the city.\n- Same day\n- Next day\n\n- Alone'),
    ).toEqual([
      { kind: 'heading', level: 2, text: 'Delivery' },
      { kind: 'heading', level: 3, text: 'Dhaka' },
      { kind: 'paragraph', text: 'Inside the city.' },
      { kind: 'list', items: ['Same day', 'Next day'] },
      { kind: 'list', items: ['Alone'] },
    ]);
  });

  it('keeps markup as text, never interpreting it', () => {
    const blocks = parsePageText('<script>alert(1)</script>\n\n<b>bold</b> & more');

    expect(blocks).toEqual([
      { kind: 'paragraph', text: '<script>alert(1)</script>' },
      { kind: 'paragraph', text: '<b>bold</b> & more' },
    ]);
  });

  it('treats markers without text, and other leading characters, as ordinary text', () => {
    expect(parsePageText('#\n#hashtag\n-\n-dash\n* star')).toEqual([
      { kind: 'paragraph', text: '#\n#hashtag\n-\n-dash\n* star' },
    ]);
  });

  it('accepts Windows line endings and returns nothing for empty text', () => {
    expect(parsePageText('# Title\r\n\r\nBody')).toEqual([
      { kind: 'heading', level: 2, text: 'Title' },
      { kind: 'paragraph', text: 'Body' },
    ]);
    expect(parsePageText('  \n\n ')).toEqual([]);
  });
});
