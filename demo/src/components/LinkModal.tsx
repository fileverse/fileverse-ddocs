import { useEffect, useState } from 'react';
import { DynamicModal, TextField } from '@fileverse/ui';
import type { Editor } from '@tiptap/react';
import { applyLinkWithText } from '../../../package/utils/apply-link-with-text';

// Mirrors the package's mobile-toolbar link modal (mobile-toolbar.tsx:257):
// Text + URL fields, validation, selection-aware save.
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  getEditor: () => Editor | null | undefined;
  onError?: (msg: string) => void;
};

const URL_PATTERN =
  /^(https?:\/\/)?([\w-]+(\.[\w-]+)+\.?(:\d+)?(\/\S*)?|\w+@[\w.-]+\.\w+)\s*$/i;

export const LinkModal = ({ open, onOpenChange, getEditor, onError }: Props) => {
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [isUrlValid, setIsUrlValid] = useState(true);

  // Prefill from the current selection / existing link mark on open.
  useEffect(() => {
    if (!open) return;
    const editor = getEditor();
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to);
    const linkMark = editor.getAttributes('link');
    setText(selectedText || '');
    setUrl(linkMark.href || '');
    setIsUrlValid(true);
  }, [open, getEditor]);

  const save = () => {
    const editor = getEditor();
    if (!editor || (!url && !text)) {
      onOpenChange(false);
      return;
    }

    let finalUrl = url;
    if (finalUrl && !/^https?:\/\//.test(finalUrl)) {
      finalUrl = 'https://' + finalUrl;
    }
    if (finalUrl && !URL_PATTERN.test(finalUrl)) {
      setIsUrlValid(false);
      onError?.('Invalid URL');
      return;
    }
    finalUrl = finalUrl.trim();

    applyLinkWithText(editor, text || finalUrl, finalUrl);
    onOpenChange(false);
  };

  return (
    <DynamicModal
      open={open}
      onOpenChange={(o: boolean) => !o && onOpenChange(false)}
      title="Link"
      content={
        <div className="flex flex-col gap-4 w-full h-full text-base">
          <TextField
            label="Text"
            placeholder="Link text"
            className="w-full text-base"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <TextField
            label="Link"
            placeholder="Paste URL"
            className="w-full text-base"
            value={url}
            autoFocus
            onChange={(e) => {
              setUrl(e.target.value);
              setIsUrlValid(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                save();
              }
            }}
            isValid={isUrlValid}
            message={isUrlValid ? '' : 'Invalid URL'}
          />
        </div>
      }
      primaryAction={{
        label: 'Save',
        onClick: save,
        isLoading: false,
        className: 'w-full md:w-auto min-w-[80px]',
      }}
      secondaryAction={{
        label: 'Cancel',
        variant: 'secondary',
        onClick: () => onOpenChange(false),
        className: 'w-full md:w-auto min-w-[80px]',
      }}
    />
  );
};
