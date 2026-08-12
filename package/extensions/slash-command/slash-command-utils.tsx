/* eslint-disable @typescript-eslint/no-explicit-any */

import { LucideIcon } from '@fileverse/ui';
import { startImageUpload } from '../../utils/upload-images';
import { IMG_UPLOAD_SETTINGS } from '../../components/editor-utils';
import { validateImageExtension } from '../../utils/check-image-type';
import { CommandProps } from './types';
import { insertCommands } from '../../utils/insert-commands';
import { IpfsImageUploadResponse } from '../../types';

export const getSuggestionItems = ({
  query,
  onError,
  ipfsImageUploadFn,
  editor,
}: {
  query: string;
  onError?: (errorString: string) => void;
  ipfsImageUploadFn?: (file: File) => Promise<IpfsImageUploadResponse>;
  isConnected?: boolean;
  editor?: any;
  enableCollaboration?: boolean;
  disableInlineComment?: boolean;
}) => {
  const modelContext = (window as any).__MODEL_CONTEXT__;
  const isAIAgentEnabled =
    modelContext?.isAIAgentEnabled && modelContext?.activeModel;

  // Check for active AI Writer node
  let hasActiveAIWriter = false;
  if (editor && editor.state && editor.state.doc) {
    editor.state.doc.descendants((node: any) => {
      if (node.type.name === 'aiWriter') {
        hasActiveAIWriter = true;
        return false;
      }
      return true;
    });
  }
  const canCreateAIWriter = !hasActiveAIWriter && isAIAgentEnabled;

  const items = [
    {
      title: 'AI Writer',
      description: 'Generate text with AI assistance.',
      searchTerms: ['ai', 'generate', 'writer', 'assistant', 'text'],
      icon: <LucideIcon name="Sparkles" size={'md'} />,
      image: '',
      command: ({ editor, range }: CommandProps) => {
        if (!canCreateAIWriter) {
          if (onError) {
            onError('Only one AI Writer can be active at a time.');
          }
          return;
        }
        editor.chain().focus().deleteRange(range).run();
        if (editor.commands.insertAIWriter) {
          editor.commands.insertAIWriter({
            prompt: '',
            content: '',
            tone: 'neutral',
          });
        } else {
          console.warn('AIWriter extension is not available');
          if (onError) {
            onError(
              'AIWriter is not available. Make sure the extension is properly configured.',
            );
          }
        }
      },
      isDisabled: !canCreateAIWriter,
    },
    {
      title: 'Text',
      description: 'Just start typing with plain text.',
      searchTerms: ['p', 'paragraph'],
      icon: <LucideIcon name="Text" size={'md'} />,
      image: '',
      command: ({ editor, range }: CommandProps) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .toggleNode('paragraph', 'paragraph')
          .run();
      },
    },
    {
      title: 'To-do List',
      description: 'Track tasks with a to-do list.',
      searchTerms: ['todo', 'task', 'list', 'check', 'checkbox'],
      icon: <LucideIcon name="ListChecks" size={'md'} />,
      image: '',
      command: ({ editor, range }: CommandProps) =>
        insertCommands.todoList(editor, range),
    },
    {
      title: 'Heading 1',
      description: 'Big section heading.',
      searchTerms: ['title', 'big', 'large'],
      icon: <LucideIcon name="Heading1" size={'md'} />,
      image: '',
      command: ({ editor, range }: CommandProps) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setNode('heading', { level: 1 })
          .run();
      },
    },
    {
      title: 'Heading 2',
      description: 'Medium section heading.',
      searchTerms: ['subtitle', 'medium'],
      icon: <LucideIcon name="Heading2" size={'md'} />,
      image: '',
      command: ({ editor, range }: CommandProps) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setNode('heading', { level: 2 })
          .run();
      },
    },
    {
      title: 'Heading 3',
      description: 'Small section heading.',
      searchTerms: ['subtitle', 'small'],
      icon: <LucideIcon name="Heading3" size={'md'} />,
      image: '',
      command: ({ editor, range }: CommandProps) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setNode('heading', { level: 3 })
          .run();
      },
    },
    {
      title: 'Bullet List',
      description: 'Create a simple bullet list.',
      searchTerms: ['unordered', 'point'],
      icon: <LucideIcon name="List" size={'md'} />,
      image: '',
      command: ({ editor, range }: CommandProps) =>
        insertCommands.bulletList(editor, range),
    },
    {
      title: 'Numbered List',
      description: 'Create a list with numbering.',
      searchTerms: ['ordered'],
      icon: <LucideIcon name="ListOrdered" size={'md'} />,
      image: '',
      command: ({ editor, range }: CommandProps) =>
        insertCommands.numberedList(editor, range),
    },
    {
      title: 'Callout',
      description: 'Make writing stand out',
      searchTerms: ['callout', 'note', 'highlight', 'box'],
      icon: <LucideIcon name="Callout" size={'md'} />,
      image: '',
      command: ({ editor, range }: CommandProps) =>
        insertCommands.callout(editor, range),
    },
    {
      title: 'Page breaker',
      description:
        'Insert page break that will split your document into pages.',
      searchTerms: ['pagebreak', 'break', 'line', 'page'],
      icon: <LucideIcon name="PageBreak" size={'md'} />,
      image: '',
      command: ({ editor, range }: CommandProps) =>
        insertCommands.pageBreak(editor, range),
    },
    {
      title: 'Divider',
      description: 'Visually divide content.',
      searchTerms: ['hr', 'divider', 'break', 'line', 'delimiter'],
      icon: <LucideIcon name="Minus" size={'md'} />,
      image: '',
      command: ({ editor, range }: CommandProps) =>
        insertCommands.divider(editor, range),
    },
    {
      title: 'Quote',
      description: 'Capture a quote.',
      searchTerms: ['blockquote'],
      icon: <LucideIcon name="TextQuote" size={'md'} />,
      image: '',
      command: ({ editor, range }: CommandProps) =>
        insertCommands.quote(editor, range),
    },
    {
      title: 'Code',
      description: 'Capture a code snippet.',
      searchTerms: ['codeblock'],
      icon: <LucideIcon name="Code" size={'md'} />,
      image: '',
      command: ({ editor, range }: CommandProps) =>
        insertCommands.codeBlock(editor, range),
    },
    {
      title: 'Mermaid Diagram',
      description: 'Author a diagram in Mermaid syntax.',
      searchTerms: ['mermaid', 'diagram', 'flowchart', 'sequence', 'gantt'],
      icon: <LucideIcon name="GitGraph" size={'md'} />,
      image: '',
      command: ({ editor, range }: CommandProps) =>
        insertCommands.mermaid(editor, range),
    },
    {
      title: 'Plain text',
      description: 'Create a plain text block',
      searchTerms: ['plaintext', 'txt', 'plain', 'text'],
      icon: <LucideIcon name="NotepadText" size={'md'} />,
      image: '',
      command: ({ editor, range }: CommandProps) =>
        insertCommands.plainText(editor, range),
    },
    {
      title: 'Table',
      description: 'Create a table.',
      searchTerms: ['table'],
      icon: <LucideIcon name="Table" size={'md'} />,
      image: '',
      command: ({ editor, range }: CommandProps) =>
        insertCommands.table(editor, range),
    },
    {
      title: 'Image',
      description: 'Upload an image from your computer.',
      searchTerms: ['photo', 'picture', 'media'],
      icon: <LucideIcon name="ImageUp" size={'md'} />,
      image: '',
      command: ({ editor, range }: CommandProps) => {
        editor.chain().focus().deleteRange(range).run();
        // upload image
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/png, image/jpeg, image/gif, image/svg+xml';
        input.onchange = async () => {
          if (input.files?.length) {
            const file = input.files[0];
            if (!validateImageExtension(file, onError)) {
              return;
            }
            const size = file.size;
            const imgConfig = ipfsImageUploadFn
              ? IMG_UPLOAD_SETTINGS.Extended
              : IMG_UPLOAD_SETTINGS.Base;
            if (size > imgConfig.maxSize) {
              if (onError && typeof onError === 'function') {
                onError(imgConfig.errorMsg);
              }
              return;
            }
            const pos = editor.view.state.selection.from;
            startImageUpload(file, editor.view, pos, ipfsImageUploadFn);
          }
        };
        input.click();
      },
    },
    {
      title: 'Video Embed',
      description: 'Embed a video from YouTube, Vimeo, etc.',
      searchTerms: ['iframe', 'embed', 'video', 'youtube'],
      icon: <LucideIcon name="Youtube" size={'md'} />,
      image: '',
      command: ({ editor, range }: CommandProps) =>
        insertCommands.video(editor, range),
    },
    {
      title: 'X',
      description: 'Embed a X post.',
      searchTerms: ['X', 'embed', 'twitter', 'tweet'],
      icon: <LucideIcon name="XSocial" size={'md'} />,
      image: '',
      command: ({ editor, range }: CommandProps) =>
        insertCommands.tweet(editor, range),
    },
    {
      title: 'Soundcloud Embed',
      description: 'Embed an audio from Soundcloud.',
      searchTerms: ['audio', 'music', 'soundcloud', 'sc', 'embed'],
      icon: <LucideIcon name="Soundcloud" size={'md'} />,
      image: '',
      command: ({ editor, range }: CommandProps) =>
        insertCommands.soundcloud(editor, range),
    },
    {
      title: '2 Columns',
      description: 'Create 2 columns of block',
      searchTerms: ['col', 'column', '2', 'layout'],
      icon: <LucideIcon name="Columns2" size={'md'} />,
      image: '',
      command: ({ editor }: CommandProps) => insertCommands.columns2(editor),
    },
    {
      title: '3 Columns',
      description: 'Create 3 columns of block',
      searchTerms: ['col', 'column', '3', 'layout'],
      icon: <LucideIcon name="Columns3" size={'md'} />,
      image: '',
      command: ({ editor }: CommandProps) => insertCommands.columns3(editor),
    },
  ];
  return items.filter((item) => {
    if (item.title === 'AI Writer' && item.isDisabled) {
      return false;
    }
    if (typeof query === 'string' && query.length > 0) {
      const search = query.toLowerCase();
      return (
        item.title.toLowerCase().includes(search) ||
        item.description.toLowerCase().includes(search) ||
        (item.searchTerms &&
          item.searchTerms.some((term: string) => term.includes(search)))
      );
    }
    return true;
  });
};

export const updateScrollView = (container: HTMLElement, item: HTMLElement) => {
  const containerHeight = container.offsetHeight;
  const itemHeight = item ? item.offsetHeight : 0;

  const top = item.offsetTop;
  const bottom = top + itemHeight;

  if (top < container.scrollTop) {
    container.scrollTop -= container.scrollTop - top + 5;
  } else if (bottom > containerHeight + container.scrollTop) {
    container.scrollTop += bottom - containerHeight - container.scrollTop + 5;
  }
};
