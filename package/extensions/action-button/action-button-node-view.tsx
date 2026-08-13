import { useEffect, useMemo, useRef, useState } from 'react';
import { NodeViewProps } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { NodeViewWrapper } from '@tiptap/react';
import { useEditingContext } from '../../hooks/use-editing-context';
import { debounce } from '../../utils/debounce';
import { LucideIcon, TextField } from '@fileverse/ui';

export const getActionButtonView =
  (onError?: (message: string) => void) =>
  ({ node, editor, getPos, deleteNode, ...props }: NodeViewProps) => {
    return (
      <ActionButtonNodeView
        node={node}
        editor={editor}
        deleteNode={deleteNode}
        onError={onError}
        getPos={getPos}
        {...props}
      />
    );
  };
// eslint-disable-next-line react-refresh/only-export-components
const ActionButtonNodeView = ({
  node,
  editor,
  getPos,
  deleteNode,
  onError,
}: NodeViewProps & { onError?: (message: string) => void }) => {
  const [inputValue, setInputValue] = useState<string>('');
  const { isPreviewMode } = useEditingContext();
  const twitterUrls = ['https://twitter.com', 'https://x.com'];

  const renderIcon = () => {
    switch (node.attrs.data) {
      case 'twitter':
        return <LucideIcon name="XSocial" size={'md'} />;
      case 'iframe-video':
        return <LucideIcon name="Youtube" size={'md'} />;
      case 'iframe-soundcloud':
        return <LucideIcon name="Soundcloud" size={'md'} />;
      default:
        return <LucideIcon name="Sparkles" size={'md'} />;
    }
  };

  const renderTitle = () => {
    switch (node.attrs.data) {
      case 'twitter':
        return 'Embed a Twitter tweet';
      case 'iframe-video':
        return 'Embed a video';
      case 'iframe-soundcloud':
        return 'Embed an audio';
      default:
        return 'Paste an Youtube or Twitter/X link to embed';
    }
  };

  const iframeRender = () => {
    if (!inputValue) {
      onError?.('Please enter a valid URL');
      return;
    }

    let formattedUrl = inputValue;

    if (inputValue.includes('<iframe')) {
      const matches = inputValue.match(/src="([^"]*)"/);
      if (matches && matches.length > 0) {
        formattedUrl = matches[1];
      }
    } else {
      switch (true) {
        case /youtu\.?be(?:\.com)?\/(?:.*v(?:\/|=)|(?:.*\/)?)([a-zA-Z0-9-_]+)/.test(
          inputValue,
        ): {
          const matches = inputValue.match(
            /youtu\.?be(?:\.com)?\/(?:.*v(?:\/|=)|(?:.*\/)?)([a-zA-Z0-9-_]+)/,
          );
          if (matches && matches.length > 0) {
            formattedUrl = `https://www.youtube.com/embed/${matches[1]}`;
          }
          break;
        }
        case /vimeo\.com\/([a-zA-Z0-9-_]+)/.test(inputValue): {
          const matches = inputValue.match(/vimeo\.com\/([a-zA-Z0-9-_]+)/);
          if (matches && matches.length > 0) {
            formattedUrl = `https://player.vimeo.com/video/${matches[1]}`;
          }
          break;
        }
        default: {
          onError?.('Please enter a valid URL');
          return;
        }
      }
    }

    const width = 640;
    const height = 360;

    const pos = getPos();

    if (pos !== undefined) {

      formattedUrl &&
        editor
          ?.chain()
          .command(({ tr }) => {
            // Select the action button itself so the insert replaces it
            // in place (no empty-wrapper intermediate, no magic offsets).
            tr.setSelection(NodeSelection.create(tr.doc, pos));
            return true;
          })
          .setIframe({ src: formattedUrl, width, height })
          .run();
    } else {
      deleteNode();
    }
  };

  const twitterRender = () => {
    if (!inputValue) {
      onError?.('Please enter a valid URL');
      return;
    }

    let filteredTweetId = inputValue;

    const isValidUrl = twitterUrls.some((url) => inputValue.includes(url));
    const matches = inputValue.match(/\/status\/([0-9]*)/);
    const isValidTweetId = matches && matches.length > 0;

    if (isValidUrl && isValidTweetId) {
      filteredTweetId = matches[1];
    } else {
      onError?.('Please enter a valid post URL');
      return;
    }

    const pos = getPos();
    if (pos !== undefined) {
      filteredTweetId &&
        editor
          ?.chain()
          .command(({ tr }) => {
            tr.setSelection(NodeSelection.create(tr.doc, pos));
            return true;
          })
          .setTweetEmbed({ tweetId: filteredTweetId })
          .run();
    } else {
      deleteNode();
    }
  };

  const soundcloudRender = () => {
    let sanitizedURL: string;
    const SOUNDCLOUD_REGEX =
      /(?:https?:\/\/)?(?:www\.)?soundcloud\.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+/;
    if (!inputValue) {
      onError?.('Please enter a valid URL');
      return;
    }
    if (SOUNDCLOUD_REGEX.test(inputValue)) {
      const matches = inputValue.match(
        /(soundcloud\.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+)/,
      );
      if (matches && matches.length > 0) {
        const trackUrl = `https://${matches[1]}`;
        sanitizedURL = `https://w.soundcloud.com/player/?url=${encodeURIComponent(
          trackUrl,
        )}`;
        const width = 670;
        const height = 166;

        const pos = getPos();

        if (pos !== undefined) {

          sanitizedURL &&
            editor
              ?.chain()
              .command(({ tr }) => {
                tr.setSelection(NodeSelection.create(tr.doc, pos));
                return true;
              })
              .setIframe({ src: sanitizedURL, width, height })
              .run();
        } else {
          deleteNode();
        }
      }
    } else {
      onError?.('Please enter a valid Soundcloud URL');
      return;
    }
  };

  const multiRender = () => {
    if (!inputValue) {
      onError?.('Please enter a valid URL');
      return;
    }

    let formattedUrl = inputValue;
    let mediaType = 'iframe';

    if (inputValue.includes('<iframe')) {
      const matches = inputValue.match(/src="([^"]*)"/);
      if (matches && matches.length > 0) {
        formattedUrl = matches[1];
      }
    } else {
      switch (true) {
        case /youtu\.?be(?:\.com)?\/(?:.*v(?:\/|=)|(?:.*\/)?)([a-zA-Z0-9-_]+)/.test(
          inputValue,
        ): {
          const matches = inputValue.match(
            /youtu\.?be(?:\.com)?\/(?:.*v(?:\/|=)|(?:.*\/)?)([a-zA-Z0-9-_]+)/,
          );
          if (matches && matches.length > 0) {
            formattedUrl = `https://www.youtube.com/embed/${matches[1]}`;
          }
          break;
        }
        case /vimeo\.com\/([a-zA-Z0-9-_]+)/.test(inputValue): {
          const matches = inputValue.match(/vimeo\.com\/([a-zA-Z0-9-_]+)/);
          if (matches && matches.length > 0) {
            formattedUrl = `https://player.vimeo.com/video/${matches[1]}`;
          }
          break;
        }
        case /(?:twitter|x)\.com\/(?:#!\/)?(\w+)\/status(es)?\/(\d+)/.test(
          inputValue,
        ): {
          const matches = inputValue.match(
            /(?:twitter|x)\.com\/(?:#!\/)?(\w+)\/status(es)?\/(\d+)/,
          );
          if (matches && matches.length > 0) {
            formattedUrl = matches[3]; // Extract the tweet ID
            mediaType = 'twitter';
          }
          break;
        }
        default: {
          onError?.('Please enter a valid URL');
          return;
        }
      }
    }

    const width = 640;
    const height = 360;

    const pos = getPos();
    if (pos !== undefined) {
      if (formattedUrl) {
        const chain = editor?.chain().command(({ tr }) => {
          tr.setSelection(NodeSelection.create(tr.doc, pos));
          return true;
        });
        if (mediaType === 'twitter') {
          chain?.setTweetEmbed({ tweetId: formattedUrl });
        } else {
          chain?.setIframe({ src: formattedUrl, width, height });
        }
        chain?.run();
      }
    } else {
      deleteNode();
    }
  };

  const handleSave = () => {
    switch (node.attrs.data) {
      case 'twitter':
        twitterRender();
        break;
      case 'iframe-video':
        iframeRender();
        break;
      case 'iframe-soundcloud':
        soundcloudRender();
        break;
      default:
        multiRender();
        break;
    }
  };

  // One stable debounce for the component's lifetime. The previous code
  // rebuilt the debounce on every render, so every keystroke armed its own
  // independent 1s timer — each firing handleSave with a PARTIAL URL
  // ("Please enter a valid URL" toast spam), and leaked timers kept firing
  // after the node view unmounted. The ref keeps the latest closure without
  // resetting the timer identity.
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;
  const debouncedHandleSave = useMemo(
    () => debounce(() => handleSaveRef.current(), 1000),
    [],
  );

  useEffect(() => {
    if (inputValue) {
      debouncedHandleSave();
    }
  }, [inputValue, debouncedHandleSave]);

  useEffect(
    () => () => debouncedHandleSave.cancel(),
    [debouncedHandleSave],
  );

  useEffect(() => {
    editor?.chain().focus();
  }, []);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Small delay to ensure the DOM is ready
    const timeoutId = setTimeout(() => {
      inputRef.current?.focus();
    }, 0);

    return () => clearTimeout(timeoutId);
  }, []); // Empty dependency array means this runs once on mount

  return (
    <NodeViewWrapper
      as="div"
      className="flex gap-2 group w-full relative justify-center items-start"
    >
      {!isPreviewMode && (
        <div className="relative w-full">
          <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none color-text-default">
            {renderIcon()}
          </div>
          <TextField
            ref={inputRef}
            value={inputValue}
            placeholder={renderTitle()}
            onChange={(e) => setInputValue(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            className="p-3 pl-10 w-full"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Backspace' && inputValue === '') {
                deleteNode();
              }
            }}
          />
        </div>
      )}
    </NodeViewWrapper>
  );
};
