import type MarkdownIt from 'markdown-it';

/**
 * markdown-it plugin that turns GitHub/Obsidian-style alert blockquotes into
 * Notion-like callout blocks (requirements §16):
 *
 *   > [!NOTE]
 *   > これはメモです。
 *
 * becomes
 *
 *   <div class="callout callout-note">
 *     <div class="callout-icon">💡</div>
 *     <div class="callout-content"> ... </div>
 *   </div>
 */

interface CalloutKind {
  label: string;
  icon: string;
}

export const CALLOUT_KINDS: Record<string, CalloutKind> = {
  note: { label: 'Note', icon: '💡' },
  tip: { label: 'Tip', icon: '✅' },
  important: { label: 'Important', icon: '❗' },
  warning: { label: 'Warning', icon: '⚠️' },
  caution: { label: 'Caution', icon: '🔺' },
};

const MARKER_RE = /^\[!(\w+)\]\s*/i;

export default function calloutPlugin(md: MarkdownIt): void {
  md.core.ruler.after('block', 'notion_callouts', (state) => {
    const tokens = state.tokens;

    const makeHtmlBlock = (content: string) => {
      const token = new state.Token('html_block', '', 0);
      token.content = content;
      token.block = true;
      return token;
    };

    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'blockquote_open') {
        continue;
      }

      // The first inline token inside the blockquote carries the marker.
      const paragraphOpen = tokens[i + 1];
      const inline = tokens[i + 2];
      if (!paragraphOpen || paragraphOpen.type !== 'paragraph_open' || !inline || inline.type !== 'inline') {
        continue;
      }

      const match = inline.content.match(MARKER_RE);
      if (!match) {
        continue;
      }

      const kindKey = match[1].toLowerCase();
      const kind = CALLOUT_KINDS[kindKey];
      if (!kind) {
        continue;
      }

      // Find the matching blockquote_close (respecting nesting level).
      let depth = 1;
      let closeIndex = -1;
      for (let j = i + 1; j < tokens.length; j++) {
        if (tokens[j].type === 'blockquote_open') {
          depth++;
        } else if (tokens[j].type === 'blockquote_close') {
          depth--;
          if (depth === 0) {
            closeIndex = j;
            break;
          }
        }
      }
      if (closeIndex === -1) {
        continue;
      }

      // Convert the blockquote wrapper into a callout div.
      const open = tokens[i];
      open.tag = 'div';
      open.attrSet('class', `callout callout-${kindKey}`);
      tokens[closeIndex].tag = 'div';

      // Strip the "[!TYPE]" marker and a trailing soft break from the body.
      inline.content = inline.content.replace(MARKER_RE, '');
      if (inline.children && inline.children.length) {
        const first = inline.children[0];
        if (first.type === 'text') {
          first.content = first.content.replace(MARKER_RE, '');
          if (first.content === '' && inline.children[1] && inline.children[1].type === 'softbreak') {
            inline.children.splice(0, 2);
          } else if (first.content === '') {
            inline.children.splice(0, 1);
          }
        }
      }

      // Inject the icon + titled body wrapper around the existing children.
      const iconAndContentOpen = makeHtmlBlock(
        `<div class="callout-icon" aria-hidden="true">${kind.icon}</div>` +
          '<div class="callout-body">' +
          `<div class="callout-title">${kind.label}</div>` +
          '<div class="callout-content">',
      );
      const contentClose = makeHtmlBlock('</div></div>');

      tokens.splice(closeIndex, 0, contentClose);
      tokens.splice(i + 1, 0, iconAndContentOpen);
    }

    return false;
  });
}
