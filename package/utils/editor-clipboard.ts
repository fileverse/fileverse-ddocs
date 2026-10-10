import type { Editor } from '@tiptap/react';
import { toast } from '@fileverse/ui';

export type ClipboardAction =
  | 'copy'
  | 'cut'
  | 'paste'
  | 'pasteWithoutFormatting';

/** Keep clipboard actions on the editor's native serialization/paste paths. */
export async function runClipboardAction(
  editor: Editor,
  action: ClipboardAction,
  onError?: (message: string) => void,
): Promise<void> {
  if (editor.isDestroyed || (action !== 'copy' && !editor.isEditable)) return;
  const { doc, selection } = editor.state;
  if ((action === 'copy' || action === 'cut') && selection.empty) return;
  const unchanged = () =>
    !editor.isDestroyed &&
    editor.isEditable &&
    editor.state.doc.eq(doc) &&
    editor.state.selection.eq(selection);

  try {
    editor.view.focus();
    if (action === 'copy' || action === 'cut') {
      // Native copy/cut also handles browser clipboard restrictions and runs
      // ProseMirror's copy/cut handlers, including transformCopied.
      if (document.execCommand?.(action)) return;
      const { dom, text } = editor.view.serializeForClipboard(
        selection.content(),
      );
      if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([dom.innerHTML], { type: 'text/html' }),
            'text/plain': new Blob([text], { type: 'text/plain' }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(text);
      }
      // Never delete a different selection if the document changed while the
      // browser was asking for clipboard permission.
      if (action === 'cut' && unchanged()) editor.commands.deleteSelection();
      return;
    }

    let text = '';
    let html = '';
    if (action === 'paste' && navigator.clipboard?.read) {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (item.types.includes('text/plain')) {
          text = await (await item.getType('text/plain')).text();
        }
        if (item.types.includes('text/html')) {
          html = await (await item.getType('text/html')).text();
        }
        if (text || html) break;
      }
      if (!text && !html) throw new Error('No text on clipboard');
    } else {
      text = await navigator.clipboard.readText();
    }
    if (!unchanged()) return;
    editor.view.focus();
    if (action === 'pasteWithoutFormatting') {
      // With no clipboardData, markdown/link paste handlers defer to the
      // native plain-text parser (which also preserves line breaks).
      editor.view.pasteText(text);
    } else {
      const data = new DataTransfer();
      data.setData('text/plain', text);
      if (html) data.setData('text/html', html);
      const event = new ClipboardEvent('paste', { clipboardData: data });
      if (html) editor.view.pasteHTML(html, event);
      else editor.view.pasteText(text, event);
    }
  } catch {
    const message =
      action === 'copy' || action === 'cut'
        ? 'Couldn’t copy to the clipboard. Try the keyboard shortcut instead.'
        : 'Couldn’t paste from the clipboard. Allow clipboard access or use the keyboard shortcut.';
    if (onError) onError(message);
    else toast({ title: message, variant: 'error' });
  }
}
