import React, { useCallback, useEffect, useState } from 'react';
import { TextFormatingPopup, useEditorToolbar } from './editor-utils';
import { Editor } from '@tiptap/react';
import { IEditorTool } from '../hooks/use-visibility';
import {
  LucideIcon,
  TextField,
  Drawer,
  DrawerTrigger,
  DynamicModal,
  Skeleton,
} from '@fileverse/ui';
import ToolbarButton from '../common/toolbar-button';
import { AnimatePresence } from 'framer-motion';
import { fadeInTransition, slideUpTransition } from './motion-div';
import {
  FontDescriptor,
  IpfsImageFetchPayload,
  IpfsImageUploadResponse,
} from '../types';
import { parseHeadingLink } from '../utils/heading-link';
import { useMobileToolbarStore } from '../stores/mobile-toolbar-store';
import { dismissNativeSelection } from '../utils/dismiss-native-selection';

const MobileToolbar = ({
  editor,
  onError,
  isKeyboardVisible,
  isNavbarVisible,
  setIsNavbarVisible,
  ipfsImageUploadFn,
  isLoading,
  ipfsImageFetchFn,
  fetchV1ImageFn,
  fonts,
}: {
  editor: Editor | null;
  onError?: (errorString: string) => void;
  isKeyboardVisible: boolean;
  isNavbarVisible: boolean;
  setIsNavbarVisible: React.Dispatch<React.SetStateAction<boolean>>;
  ipfsImageUploadFn?: (file: File) => Promise<IpfsImageUploadResponse>;
  isLoading: boolean;
  ipfsImageFetchFn?: (
    _data: IpfsImageFetchPayload,
  ) => Promise<{ url: string; file: File }>;
  fetchV1ImageFn?: (url: string) => Promise<ArrayBuffer | undefined>;
  fonts?: FontDescriptor[];
}) => {
  const { toolVisibility, setToolVisibility, bottomToolbar } = useEditorToolbar(
    {
      editor: editor,
      onError,
      ipfsImageUploadFn,
      ipfsImageFetchFn,
      fetchV1ImageFn,
    },
  );
  const [url, setUrl] = useState('');
  const [linkText, setLinkText] = useState('');
  const [isTextValid, setIsTextValid] = useState(true);
  const [isUrlValid, setIsUrlValid] = useState(true);

  const saveLink = useCallback(() => {
    if (!editor) return;
    if (
      (url === null || url === '') &&
      (linkText === '' || linkText === null)
    ) {
      setToolVisibility(IEditorTool.NONE);
      return;
    }

    let finalUrl = url;
    if (
      finalUrl &&
      !finalUrl.startsWith('http://') &&
      !finalUrl.startsWith('https://')
    ) {
      finalUrl = 'https://' + finalUrl;
    }

    const urlPattern =
      /^(https?:\/\/)?([\w-]+(\.[\w-]+)+\.?(:\d+)?(\/\S*)?|\w+@[\w.-]+\.\w+)\s*$/i;
    if (finalUrl && !urlPattern.test(finalUrl)) {
      setIsUrlValid(false);
      if (onError) onError('Invalid URL');
      return;
    }

    finalUrl = finalUrl.trim();

    const { from, to } = editor.state.selection;
    const isSelected = editor.state.doc.textBetween(from, to).length > 0;

    if (isSelected) {
      editor
        .chain()
        .focus()
        .deleteSelection()
        .insertContent({
          type: 'text',
          text: linkText,
          marks: finalUrl ? [{ type: 'link', attrs: { href: finalUrl } }] : [],
        })
        .run();
    } else if (linkText) {
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'text',
          text: linkText,
          marks: finalUrl ? [{ type: 'link', attrs: { href: finalUrl } }] : [],
        })
        .run();
    }

    setIsUrlValid(true);
    setIsTextValid(true);
    setToolVisibility(IEditorTool.NONE);
    const parsed = parseHeadingLink(url);
    if (parsed && !parsed.headingEl) {
      onError?.('This heading link belongs to a different document.');
    }
  }, [editor, linkText, onError, setToolVisibility, url]);

  const getSelectedLink = useCallback(() => {
    if (!editor) return { text: '', url: '' };
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to);
    const linkMark = editor.getAttributes('link');
    return {
      text: selectedText || linkMark.text || '',
      url: linkMark.href || '',
    };
  }, [editor]);

  useEffect(() => {
    if (!editor) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (toolVisibility !== IEditorTool.LINK_POPUP) {
          setToolVisibility(IEditorTool.LINK_POPUP);
        } else {
          setToolVisibility(IEditorTool.NONE);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [editor, setToolVisibility, toolVisibility]);

  useEffect(() => {
    if (isKeyboardVisible) {
      setToolVisibility(IEditorTool.NONE);
    }
  }, [isKeyboardVisible, setToolVisibility]);

  // While a sheet/modal owns the screen: hide the bubble menu and drop the
  // native selection UI (OS edit menu + handles) that would float above it.
  const setMobileToolbarOpen = useMobileToolbarStore(
    (s) => s.setMobileToolbarOpen,
  );
  useEffect(() => {
    const isOpen = toolVisibility !== IEditorTool.NONE;
    setMobileToolbarOpen(isOpen);
    if (isOpen) dismissNativeSelection(editor);
    return () => setMobileToolbarOpen(false);
  }, [toolVisibility, editor, setMobileToolbarOpen]);

  useEffect(() => {
    if (toolVisibility === IEditorTool.LINK_POPUP) {
      const { text, url } = getSelectedLink();
      setLinkText(text);
      setUrl(url);
    }
  }, [toolVisibility, editor, getSelectedLink]);

  const handleNavbarVisibilityToggle = useCallback(
    () => setIsNavbarVisible((prev) => !prev),
    [setIsNavbarVisible],
  );

  return (
    <Drawer>
      <div className="flex w-full justify-between sm:justify-evenly items-center select-none">
        {bottomToolbar.map((tool, _index) => {
          if (tool) {
            return (
              <div key={tool.title} className="flex items-center">
                {tool.title === 'Text formating' ? (
                  <DrawerTrigger asChild>
                    <AnimatePresence>
                      {isLoading
                        ? fadeInTransition(
                            <Skeleton
                              className={`w-[36px] h-[36px] rounded-sm`}
                            />,
                            'mobile' + tool.title + 'skeleton',
                          )
                        : slideUpTransition(
                            <ToolbarButton
                              onClick={tool.onClick}
                              isActive={tool.isActive}
                              icon={tool.icon}
                            />,
                            tool.title + 'mobile',
                          )}
                    </AnimatePresence>
                  </DrawerTrigger>
                ) : tool.title === 'Text color' ? (
                  <DrawerTrigger asChild>
                    {isLoading
                      ? fadeInTransition(
                          <Skeleton
                            className={`w-[36px] h-[36px] rounded-sm`}
                          />,
                          'mobile' + tool.title,
                        )
                      : slideUpTransition(
                          <ToolbarButton
                            onClick={tool.onClick}
                            icon={tool.icon}
                            isActive={false}
                          />,
                          'text-color-button',
                        )}
                  </DrawerTrigger>
                ) : isLoading ? (
                  fadeInTransition(
                    <Skeleton className={`w-[36px] h-[36px] rounded-sm`} />,
                    'skeleton' + tool.title,
                  )
                ) : (
                  slideUpTransition(
                    <ToolbarButton
                      onClick={tool.onClick}
                      icon={tool.icon}
                      isActive={false}
                    />,
                    'mobile-button' + tool.title,
                  )
                )}
              </div>
            );
          } else {
            return (
              <div
                key={_index}
                className="w-[1px] h-4 vertical-divider mx-2"
              ></div>
            );
          }
        })}
        <div className="w-[1px] h-4 vertical-divider mx-2"></div>
        <div className="w-9 h-9 flex justify-center items-center">
          <LucideIcon
            size={'md'}
            name={isNavbarVisible ? 'ChevronUp' : 'ChevronDown'}
            onClick={handleNavbarVisibilityToggle}
          />
        </div>
      </div>
      <TextFormatingPopup
        editor={editor}
        isOpen={toolVisibility === IEditorTool.TEXT_FORMATING}
        setIsOpen={(open) => !open && setToolVisibility(IEditorTool.NONE)}
        setToolVisibility={setToolVisibility}
        fonts={fonts}
      />
      <DynamicModal
        open={toolVisibility === IEditorTool.LINK_POPUP}
        onOpenChange={(open) => !open && setToolVisibility(IEditorTool.NONE)}
        title="Link"
        content={
          <div className="flex flex-col gap-4 w-full h-full text-base">
            <TextField
              label="Text"
              placeholder="Link text"
              className="w-full text-base"
              defaultValue={getSelectedLink().text}
              onChange={(e) => {
                e.preventDefault();
                setLinkText(e.target.value);
              }}
              isValid={isTextValid}
              message={isTextValid ? '' : 'Invalid text'}
            />
            <TextField
              label="Link"
              placeholder="Paste URL"
              className="w-full text-base"
              defaultValue={getSelectedLink().url}
              autoFocus
              onChange={(e) => {
                e.preventDefault();
                setUrl(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  saveLink();
                }
              }}
              isValid={isUrlValid}
              message={isUrlValid ? '' : 'Invalid URL'}
            />
          </div>
        }
        primaryAction={{
          label: 'Save',
          onClick: () => saveLink(),
          isLoading: false,
          className: 'w-full md:w-auto min-w-[80px]',
        }}
        secondaryAction={{
          label: 'Cancel',
          variant: 'secondary',
          onClick: () => setToolVisibility(IEditorTool.NONE),
          className: 'w-full md:w-auto min-w-[80px]',
        }}
      />
    </Drawer>
  );
};

const MemoizedMobileToolbar = React.memo(MobileToolbar);
MemoizedMobileToolbar.displayName = 'MobileToolbar';

export default MemoizedMobileToolbar;
