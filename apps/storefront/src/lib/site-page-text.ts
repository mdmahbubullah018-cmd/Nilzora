/*
 * The text of a page the store wrote in the admin workspace.
 *
 * It is plain text, never HTML: this parser turns it into a few block kinds and the page
 * renders each as an ordinary React element, so nothing the owner types can become markup or
 * script. The rules are the ones the editor explains:
 *
 *   - a blank line separates paragraphs;
 *   - a line starting with "# " is a heading, one starting with "## " a smaller heading;
 *   - lines starting with "- " are list items (a run of them is one list).
 */

export type PageBlock =
  | { kind: 'heading'; level: 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] };

export function parsePageText(body: string): PageBlock[] {
  const blocks: PageBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', text: paragraph.join('\n') });
    paragraph = [];
  };
  const flushList = () => {
    if (list.length > 0) blocks.push({ kind: 'list', items: list });
    list = [];
  };

  for (const raw of body.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (line === '') {
      flushParagraph();
      flushList();
    } else if (line.startsWith('## ') && line.slice(3).trim() !== '') {
      flushParagraph();
      flushList();
      blocks.push({ kind: 'heading', level: 3, text: line.slice(3).trim() });
    } else if (line.startsWith('# ') && line.slice(2).trim() !== '') {
      flushParagraph();
      flushList();
      blocks.push({ kind: 'heading', level: 2, text: line.slice(2).trim() });
    } else if (line.startsWith('- ') && line.slice(2).trim() !== '') {
      flushParagraph();
      list.push(line.slice(2).trim());
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}
