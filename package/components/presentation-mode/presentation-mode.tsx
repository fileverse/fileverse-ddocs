import {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  CSSProperties,
} from 'react';
import { Editor, EditorContent } from '@tiptap/react';
import {
  AnimatedLoader,
  DynamicDropdownV2,
  IconButton,
  Label,
  Tooltip,
} from '@fileverse/ui';
import { EditingProvider } from '../../hooks/use-editing-context';
import { buildSlidesFromDoc } from '../../utils/doc-to-slides';
import { handlePrint } from '../../utils/handle-print';
import { PreviewPanel } from './preview-panel';
import { cn } from '@fileverse/ui';
import { motion, useAnimationControls } from 'framer-motion';
import copy from 'copy-to-clipboard';
import { useResponsive } from '../../utils/responsive';
import { IpfsImageFetchPayload, DdocProps, ThemeKey } from '../../types';
import { dedupeResolvedExtensions } from '../../utils/helpers';
import {
  getResponsiveThemeTextColor,
  getThemeStyle,
} from '../../utils/document-styling';

interface PresentationModeProps {
  editor: Editor;
  onClose: () => void;
  isFullscreen: boolean;
  setIsFullscreen: React.Dispatch<React.SetStateAction<boolean>>;
  onError?: (error: string) => void;
  setCommentDrawerOpen:
    | React.Dispatch<React.SetStateAction<boolean>>
    | undefined;
  sharedSlidesLink?: string;
  isPreviewMode: boolean;
  documentName: string;
  onSlidesShare?: () => void;
  slides: string[];
  setSlides: React.Dispatch<React.SetStateAction<string[]>>;
  renderThemeToggle?: () => JSX.Element;
  isContentLoading: boolean;
  ipfsImageFetchFn?: (
    _data: IpfsImageFetchPayload,
  ) => Promise<{ url: string; file: File }>;
  documentStyling?: DdocProps['documentStyling'];
  fetchV1ImageFn?: (url: string) => Promise<ArrayBuffer | undefined>;
  theme?: ThemeKey;
}

/**
 * Font scaling multiplies the presentation stylesheet's sizes via the
 * `--slide-font-scale` custom property, so every element keeps its relative
 * proportions instead of each one needing its own override.
 */
const FONT_SCALE_MIN = 0.6;
const FONT_SCALE_MAX = 1.8;
const FONT_SCALE_STEP = 0.1;

const clampFontScale = (scale: number) =>
  Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, Number(scale.toFixed(2))));

const SlideNumber = ({
  current,
  total,
  isFullscreen,
}: {
  current: number;
  total: number;
  isFullscreen: boolean;
}) => {
  if (!total) return null;

  return (
    <div
      className={cn(
        'absolute z-40 select-none pointer-events-none text-helper-text-sm',
        isFullscreen
          ? 'bottom-6 right-8 color-utility-overlay color-text-inverse rounded-full px-3 py-1'
          : 'bottom-4 right-6 color-text-secondary',
      )}
    >
      {current} / {total}
    </div>
  );
};

const SlideContent = ({
  content,
  editor,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  isFullscreen,
  documentStyling,
  theme = 'light',
}: {
  content: string;
  editor: Editor;
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: () => void;
  isFullscreen: boolean;
  documentStyling?: DdocProps['documentStyling'];
  theme?: ThemeKey;
}) => {
  const isSoloImage = (html: string): boolean => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const img = doc.querySelector('img.slide-image');
    // Check if there's exactly one image with class 'slide-image' and it's the only content
    return !!img && doc.body.children.length === 1;
  };

  useEffect(() => {
    setTimeout(() => {
      if (!editor.view?.dom) return;
      editor.commands.setContent(content);

      if (isSoloImage(content)) {
        // Add a class to the editor root for solo image slides
        editor.view.dom.classList.add('solo-slide-image');
      } else {
        editor.view.dom.classList.remove('solo-slide-image');
      }
    });
  }, [content]);

  const themeCanvasBackground = getThemeStyle(
    documentStyling?.canvasBackground,
    theme,
  );
  const finalTextColor = getResponsiveThemeTextColor(
    documentStyling?.textColor,
    theme,
  );

  // Create canvas styles for presentation mode (no background)
  const editorStyles = {
    ...(themeCanvasBackground && {
      backgroundColor: themeCanvasBackground,
    }),
    ...(finalTextColor && { color: finalTextColor }),
    ...(documentStyling?.fontFamily && {
      fontFamily: documentStyling.fontFamily,
    }),
  };

  return (
    <EditorContent
      editor={editor}
      // `w-full h-full` matches the markup the fullscreen path used before the
      // two render paths were unified. Without it the container is a flex item
      // that shrinks to its content.
      className={cn('presentation-mode', {
        'fullscreen w-full h-full': isFullscreen,
      })}
      style={editorStyles}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    />
  );
};

export const PresentationMode = ({
  editor,
  onClose,
  isFullscreen,
  setIsFullscreen,
  onError,
  setCommentDrawerOpen,
  sharedSlidesLink,
  isPreviewMode,
  documentName,
  onSlidesShare,
  slides,
  setSlides,
  renderThemeToggle,
  isContentLoading,
  ipfsImageFetchFn,
  documentStyling,
  fetchV1ImageFn,
  theme = 'light',
}: PresentationModeProps) => {
  const [showLinkCopied, setShowLinkCopied] = useState(false);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const { isNativeMobile } = useResponsive();
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const minSwipeDistance = 50;
  // Direction is only read when the slide-change animation fires, so a ref
  // keeps it out of the render cycle and out of the effect's dependencies.
  const slideDirectionRef = useRef<'forward' | 'backward'>('forward');
  const [fontScale, setFontScale] = useState(1);
  const slideAnimation = useAnimationControls();
  const containerRef = useRef<HTMLDivElement>(null);

  // The document editor stays mounted behind this overlay and keeps DOM focus,
  // so every keystroke meant for navigation was also being typed into the
  // document. Surrender focus once the deck opens.
  useEffect(() => {
    editor.commands.blur();
    (document.activeElement as HTMLElement | null)?.blur();
  }, [editor]);

  const adjustFontScale = useCallback((delta: number) => {
    setFontScale((previous) => clampFontScale(previous + delta));
  }, []);

  // Replays the enter transition on each slide change without remounting the
  // editor that renders the slide.
  useEffect(() => {
    slideAnimation.set({
      opacity: 0,
      x: slideDirectionRef.current === 'forward' ? 50 : -50,
    });
    slideAnimation.start({
      opacity: 1,
      x: 0,
      transition: { duration: 0.2 },
    });
  }, [currentSlide, slideAnimation]);

  const themeCanvasBackground = getThemeStyle(
    documentStyling?.canvasBackground,
    theme,
  );

  const presentationEditor = useMemo(() => {
    return new Editor({
      extensions: dedupeResolvedExtensions(
        editor.extensionManager.extensions,
      ).filter(
        (b) =>
          ![
            'collaboration',
            'aiAutocomplete',
            // The presentation editor reuses the source editor's extension
            // instances. In a shared/viewer context the editor is in suggestion
            // mode, where suggestionTracking's filterTransaction blocks every
            // doc-changing transaction — including the setContent that loads
            // each slide, which would leave every slide blank. The presentation
            // editor only renders slides read-only, so it never needs tracking.
            'suggestionTracking',
          ].includes(b.name),
      ),
      // Slides are a read-only view of the document. Left editable, the
      // navigation shortcuts double as text input — pressing `f` to go
      // fullscreen also types an "f" into the slide.
      editable: false,
    });
  }, [isPreviewMode]);
  const handlePresentationMode = useCallback(async () => {
    if (!editor) return;
    if (!editor.view?.dom) return;
    if (!isPreviewMode) {
      const editorElement = editor.view.dom;
      const isEditorEmpty = editorElement.querySelector('.is-editor-empty');

      if (isEditorEmpty) {
        onClose();
        // You'll need to pass an onError prop to show the toast
        onError?.('Cannot enter presentation mode with empty content');
        return;
      }
    }

    setIsLoading(true);

    try {
      // Slides are derived straight from the document nodes. The previous
      // doc -> Markdown -> HTML route silently dropped everything Markdown
      // cannot express, most visibly multi-column blocks and font sizes.
      const slideArray = await buildSlidesFromDoc(editor, {
        ipfsImageFetchFn,
        fetchV1ImageFn,
        fontScale,
      });

      setSlides(slideArray);
    } catch (error) {
      // Without this the loader spins forever and the failure is invisible.
      console.error('Failed to build slides from document', error);
      onError?.('Could not build slides from this document');
    } finally {
      setIsLoading(false);
    }
  }, [isPreviewMode, editor.state.doc]);
  // Add check for empty editor
  useEffect(() => {
    handlePresentationMode();
  }, [editor.state.doc]);

  // Add this function to handle fullscreen mode
  const toggleFullscreen = useCallback(() => {
    if (isNativeMobile) {
      // For iOS/mobile, just toggle the state without using native fullscreen
      setIsFullscreen((prev) => !prev);
    } else {
      // For desktop browsers, try native fullscreen with fallbacks
      if (!document.fullscreenElement) {
        // Try standard fullscreen API first
        if (document.documentElement.requestFullscreen) {
          document.documentElement
            .requestFullscreen()
            .then(() => setIsFullscreen(true))
            .catch(() => {
              // Fallback if standard fullscreen fails
              setIsFullscreen(true);
            });
        } else {
          // If standard fullscreen API not available, just update state
          setIsFullscreen(true);
        }
      } else {
        // Exit fullscreen with fallbacks
        if (document.exitFullscreen) {
          document
            .exitFullscreen()
            .then(() => setIsFullscreen(false))
            .catch(() => {
              setIsFullscreen(false);
            });
        } else {
          // If standard exit fullscreen not available, just update state
          setIsFullscreen(false);
        }
      }
    }
  }, [isNativeMobile]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Yield to a comment box or similar field *inside* the deck, but not to
      // the document editor sitting behind the overlay — keystrokes there are
      // navigation, not typing.
      const target = e.target as HTMLElement | null;
      const isTextEntry =
        target?.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '');

      if (isTextEntry && target && containerRef.current?.contains(target)) {
        return;
      }

      if (
        e.key === 'ArrowRight' ||
        e.key === 'ArrowDown' ||
        e.code === 'Space'
      ) {
        e.preventDefault();
        e.stopPropagation();
        slideDirectionRef.current = 'forward';
        setCurrentSlide((prev) => Math.min(prev + 1, slides.length - 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        slideDirectionRef.current = 'backward';
        setCurrentSlide((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Escape') {
        !isPreviewMode && onClose();
      } else if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen();
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        adjustFontScale(FONT_SCALE_STEP);
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        adjustFontScale(-FONT_SCALE_STEP);
      } else if (e.key === '0') {
        e.preventDefault();
        setFontScale(1);
      }
    },
    [slides.length, onClose, toggleFullscreen, adjustFontScale],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [slides.length, currentSlide]);

  // Update the fullscreen change event listener
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!isNativeMobile && !document.fullscreenElement) {
        setIsFullscreen(false);
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [isNativeMobile]);

  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = useCallback(() => {
    if (!touchStart || !touchEnd) return;

    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    if (isLeftSwipe) {
      slideDirectionRef.current = 'forward';
      setCurrentSlide((prev) => Math.min(prev + 1, slides.length - 1));
    }
    if (isRightSwipe) {
      slideDirectionRef.current = 'backward';
      setCurrentSlide((prev) => Math.max(prev - 1, 0));
    }
  }, [touchStart, touchEnd, slides.length, minSwipeDistance]);

  const handleCopyLink = () => {
    if (sharedSlidesLink) {
      copy(sharedSlidesLink);
      setShowLinkCopied(true);
      onSlidesShare?.();

      const timeoutId = setTimeout(() => {
        setShowLinkCopied(false);
      }, 2000);

      return () => clearTimeout(timeoutId);
    }
  };

  if (isLoading || isContentLoading) {
    return (
      <div className="fixed inset-0 color-bg-default flex flex-col items-center justify-center w-screen h-screen z-50">
        <div className="flex flex-col items-center gap-4">
          <AnimatedLoader
            text={isPreviewMode ? 'Loading slides...' : 'Building slides...'}
          />
        </div>
      </div>
    );
  }

  if (slides.length === 0 || !presentationEditor) return null;

  return (
    <div
      ref={containerRef}
      className={cn(
        'fixed inset-0 color-bg-secondary flex z-50',
        isNativeMobile ? 'flex-col' : 'flex-col xl:flex-row',
        'items-center justify-center w-screen h-screen',
      )}
    >
      {!isFullscreen && (
        <PreviewPanel
          slides={slides}
          currentSlide={currentSlide}
          setCurrentSlide={setCurrentSlide}
          documentStyling={documentStyling}
          theme={theme}
        />
      )}
      {/* Main Content */}
      <div
        className={cn(
          'flex-1 h-full flex flex-col items-center justify-center',
          {
            'w-full': isFullscreen,
          },
        )}
      >
        {!isFullscreen && (
          <div className="absolute top-0 px-4 py-2 border-b color-border-default right-0 flex gap-2 color-bg-default w-full justify-between z-50">
            {isPreviewMode ? (
              <div className="flex items-center">
                <p className="max-w-[300px] truncate md:max-w-full w-full">
                  {documentName}
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <IconButton
                  variant="ghost"
                  onClick={onClose}
                  icon="ChevronLeft"
                  size="md"
                />
                <Label className="hidden xl:block text-body-sm-bold color-text-default">
                  Back to Editor
                </Label>
              </div>
            )}
            <div className="flex justify-center items-center gap-2">
              {renderThemeToggle?.()}
              <div className="hidden md:flex items-center">
                <Tooltip text="Decrease text size (-)" sideOffset={10}>
                  <IconButton
                    variant="ghost"
                    icon="AArrowDown"
                    size="md"
                    disabled={fontScale <= FONT_SCALE_MIN}
                    onClick={() => adjustFontScale(-FONT_SCALE_STEP)}
                  />
                </Tooltip>
                <Tooltip text="Reset text size (0)" sideOffset={10}>
                  <button
                    onClick={() => setFontScale(1)}
                    className="text-helper-text-sm color-text-secondary min-w-[3rem] px-1 py-1 rounded hover:color-bg-default-hover"
                  >
                    {Math.round(fontScale * 100)}%
                  </button>
                </Tooltip>
                <Tooltip text="Increase text size (+)" sideOffset={10}>
                  <IconButton
                    variant="ghost"
                    icon="AArrowUp"
                    size="md"
                    disabled={fontScale >= FONT_SCALE_MAX}
                    onClick={() => adjustFontScale(FONT_SCALE_STEP)}
                  />
                </Tooltip>
              </div>
              {!isPreviewMode && (
                <Tooltip text="Download" sideOffset={10}>
                  <IconButton
                    variant="ghost"
                    onClick={() => handlePrint(slides)}
                    icon="FilePdf"
                    size="md"
                  />
                </Tooltip>
              )}
              <Tooltip text="Comments" sideOffset={10}>
                <IconButton
                  variant="ghost"
                  icon="MessageSquareText"
                  size="md"
                  onClick={() => setCommentDrawerOpen?.((prev) => !prev)}
                />
              </Tooltip>
              {!isPreviewMode && (
                <Tooltip
                  text={
                    sharedSlidesLink ? 'Copy to Share' : 'Link is preparing...'
                  }
                  sideOffset={10}
                >
                  <IconButton
                    variant="ghost"
                    icon="Link"
                    disabled={!sharedSlidesLink}
                    className="disabled:!bg-transparent disabled:pointer-events-none"
                    size="md"
                    onClick={handleCopyLink}
                  />
                  {showLinkCopied && (
                    <DynamicDropdownV2
                      key="link-copied"
                      align="center"
                      sideOffset={15}
                      controlled={true}
                      isOpen={showLinkCopied}
                      onClose={() => setShowLinkCopied?.(false)}
                      content={
                        <div className="flex items-start gap-3 bg-black color-text-inverse rounded shadow-elevation-3 p-2 text-helper-text-sm">
                          Link copied
                        </div>
                      }
                    />
                  )}
                </Tooltip>
              )}
              <Tooltip text="Press F to toggle fullscreen" sideOffset={10}>
                <IconButton
                  variant="ghost"
                  onClick={toggleFullscreen}
                  icon={isFullscreen ? 'Minimize2' : 'Play'}
                  size="md"
                />
              </Tooltip>
            </div>
          </div>
        )}

        <div
          className={cn(
            'w-full flex items-center justify-center',
            isFullscreen ? 'h-screen p-0' : 'h-[75vh] p-8',
          )}
        >
          <div
            className={cn(
              'w-full rounded-lg overflow-hidden relative',
              !themeCanvasBackground && 'color-bg-default',
              isFullscreen
                ? 'h-full max-w-none flex items-start justify-center'
                : 'px-8 md:px-0 scale-[0.35] md:scale-[0.75] xl:scale-100 min-w-[1080px] max-w-[1080px] aspect-video py-[48px]',
            )}
            style={{
              transformOrigin: 'center',
              ...(themeCanvasBackground && {
                backgroundColor: themeCanvasBackground,
              }),
            }}
          >
            <EditingProvider isPreviewMode={true} isPresentationMode={true}>
              {/*
                Both windowed and fullscreen render through the editor. They
                used to diverge — fullscreen injected raw HTML — which meant
                custom nodes could render in one and not the other. The wrapper
                is animated via controls rather than remounted, because
                EditorContent owns the editor's DOM node and re-parenting it on
                every slide change is what made the two paths drift apart.
              */}
              <motion.div
                animate={slideAnimation}
                className="w-full h-full"
                style={{ '--slide-font-scale': fontScale } as CSSProperties}
              >
                <SlideContent
                  content={slides[currentSlide]}
                  editor={presentationEditor}
                  onTouchStart={onTouchStart}
                  onTouchMove={onTouchMove}
                  onTouchEnd={onTouchEnd}
                  isFullscreen={isFullscreen}
                  documentStyling={documentStyling}
                  theme={theme}
                />
              </motion.div>
            </EditingProvider>

            <SlideNumber
              current={currentSlide + 1}
              total={slides.length}
              isFullscreen={isFullscreen}
            />
          </div>
        </div>

        {isFullscreen && (
          <div className="absolute bottom-8 left-[50%] translate-x-[-50%] z-50 opacity-0 transition-opacity duration-300 ease-in-out hover:opacity-100">
            <div className="color-utility-overlay rounded-full px-4 py-2">
              <p className="color-text-inverse text-helper-text-sm">
                Press <strong>ESC</strong> to exit fullscreen
              </p>
            </div>
          </div>
        )}

        {/* The slide counter that used to live here now renders for every
            viewport via SlideNumber. */}
        {isFullscreen && isNativeMobile && (
          <div className="fixed top-2 right-4 z-50">
            <IconButton
              variant="ghost"
              onClick={toggleFullscreen}
              icon="X"
              size="md"
            />
          </div>
        )}
      </div>
    </div>
  );
};
