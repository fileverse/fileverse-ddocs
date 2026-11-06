import Link, { LinkOptions } from '@tiptap/extension-link';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { parseHeadingLink } from '../../utils/heading-link';

export interface CustomLinkOptions extends LinkOptions {
  /**
   * Called when the user pastes a heading link URL whose target
   * heading does not exist in the current document — i.e. the link
   * belongs to a different dDoc.
   */
  onForeignHeadingLink?: (message: string) => void;
}

/**
 * Extends tiptap's Link with a paste-time hook that detects
 * heading links pointing at headings from other dDocs and dispatches
 * a warning. A dedicated ProseMirror `handlePaste` is used (instead
 * of piggybacking on `shouldAutoLink`) because `shouldAutoLink` is
 * also called by the autolink plugin on every transaction — which
 * would re-fire the warning on unrelated keystrokes like Enter.
 */
export const CustomLink = Link.extend<CustomLinkOptions>({
  addOptions() {
    return {
      ...(this.parent!() as LinkOptions),
      onForeignHeadingLink: undefined,
    };
  },

  addCommands() {
    const parent = this.parent!();
    return {
      ...parent,
      // As in Google Docs, a new link drops its text colour so it shows the
      // link colour; it can be recoloured afterwards.
      setLink: (attributes) => (props) =>
        parent.setLink!(attributes)(props) &&
        (props.tr.selection.empty ||
          props
            .chain()
            .setMark('textStyle', { color: null, 'data-original-color': null })
            .removeEmptyTextStyle()
            .run()),
    };
  },

  addProseMirrorPlugins() {
    const parentPlugins = this.parent?.() ?? [];
    const options = this.options;

    const foreignHeadingDetector = new Plugin({
      key: new PluginKey('foreignHeadingLinkDetector'),
      props: {
        handlePaste: (_view, event) => {
          const copiedData = event.clipboardData?.getData('text/plain')?.trim();
          if (!copiedData) return false;

          const parsed = parseHeadingLink(copiedData);
          if (parsed && !parsed.headingEl) {
            options.onForeignHeadingLink?.(
              'This heading link belongs to a different document.',
            );
          }

          // Never handle the paste — let the built-in Link pasteHandler
          // wrap the selection / insert the URL as it normally would.
          return false;
        },
      },
    });

    // Detector must run BEFORE the parent Link pasteHandler: when a
    // URL is pasted over a non-empty selection, the parent handler
    // returns `true` after wrapping the selection, which would
    // short-circuit any downstream `handlePaste` hooks. Returning
    // `false` from the detector lets the parent still run normally.
    return [foreignHeadingDetector, ...parentPlugins];
  },
});
