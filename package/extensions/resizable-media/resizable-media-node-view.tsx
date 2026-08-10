/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/exhaustive-deps */
import { LegacyRef, useEffect, useRef, useState } from 'react';
import { NodeViewWrapper, NodeViewContent, NodeViewProps } from '@tiptap/react';
import { resizableMediaActions } from './resizable-media-menu-util';
import cn from 'classnames';
import { useEditingContext } from '../../hooks/use-editing-context';
import ToolbarButton from '../../common/toolbar-button';
import { SecureImage } from '../../components/secure-image.tsx';
import { SecureImageV2 } from '../../components/secure-image-v2.tsx';
import { IpfsImageFetchPayload } from '../../types.ts';
import { isAllowedEmbedSrc } from '../../utils/is-allowed-embed-src';

interface WidthAndHeight {
  width: number;
  height: number;
}

export const getResizableMediaNodeView =
  (
    ipfsImageFetchFn: (
      _data: IpfsImageFetchPayload,
    ) => Promise<{ url: string; file: File }>,
    fetchV1ImageFn: (url: string) => Promise<ArrayBuffer | undefined>,
  ) =>
  ({
    node,
    updateAttributes,
    deleteNode,
    selected,
    editor,
    getPos,
  }: NodeViewProps) => {
    const { isPreviewMode } = useEditingContext();

    const mediaType: 'img' | 'secure-img' | 'video' | 'iframe' =
      node.attrs['media-type'];

    const isImageType = mediaType === 'img' || mediaType === 'secure-img';

    const isSafeIframe =
      mediaType === 'iframe' && isAllowedEmbedSrc(node.attrs.src);

    const isSoundcloudIframe =
      isSafeIframe &&
      URL.canParse(node.attrs.src) &&
      new URL(node.attrs.src).hostname === 'w.soundcloud.com';

    const [aspectRatio, setAspectRatio] = useState(0);

    const [proseMirrorContainerWidth, setProseMirrorContainerWidth] =
      useState(0);

    const [mediaActionActiveState, setMediaActionActiveState] = useState<
      Record<string, boolean>
    >({});

    const resizableImgRef = useRef<
      HTMLImageElement | HTMLVideoElement | HTMLIFrameElement | null
    >(null);

    const lastClientXRef = useRef<number>(-1);

    const [isMouseDown, setIsMouseDown] = useState<boolean>(false);

    const [isDragging, setIsDragging] = useState(false);
    const [touchTimeout, setTouchTimeout] = useState<ReturnType<
      typeof setTimeout
    > | null>(null);
    const dragStartPos = useRef<{ x: number; y: number } | null>(null);

    const calculateMediaActionActiveStates = () => {
      const activeStates: Record<string, boolean> = {};

      resizableMediaActions.forEach(({ tooltip, isActive }) => {
        activeStates[tooltip] = !!isActive?.(node.attrs, node);
      });

      setMediaActionActiveState(activeStates);
    };

    const mediaSetupOnLoad = () => {
      // ! TODO: move this to extension storage
      const proseMirrorContainerDiv = document.querySelector('.ProseMirror');

      if (proseMirrorContainerDiv)
        setProseMirrorContainerWidth(proseMirrorContainerDiv?.clientWidth);

      // When the media has loaded
      if (!resizableImgRef.current) return;

      if (mediaType === 'video') {
        const video = resizableImgRef.current as HTMLVideoElement;

        video.addEventListener('loadeddata', function () {
          // Aspect Ratio from its original size
          setAspectRatio(video.videoWidth / video.videoHeight);

          // for the first time when video is added with custom width and height
          // and we have to adjust the video height according to it's width
          onHorizontalResize('left', 0);
        });
      } else if (mediaType === 'iframe') {
        const iframe = resizableImgRef.current as HTMLIFrameElement;

        iframe.onload = () => {
          // Aspect Ratio from its original size
          setAspectRatio(iframe.offsetWidth / iframe.offsetHeight);
          onHorizontalResize('left', 0);
        };
      } else {
        resizableImgRef.current.onload = () => {
          // Aspect Ratio from its original size
          setAspectRatio(
            (resizableImgRef.current as HTMLImageElement).naturalWidth /
              (resizableImgRef.current as HTMLImageElement).naturalHeight,
          );
        };
      }

      setTimeout(() => calculateMediaActionActiveStates(), 200);
    };

    const setLastClientX = (x: number) => {
      lastClientXRef.current = x;
    };

    useEffect(() => {
      mediaSetupOnLoad();
    }, []);

    // Converts the legacy `caption` string attribute into an editable
    // `mediaCaption` child node. Called on user interaction (click on the
    // legacy caption, or the Add Caption toolbar action). Never called
    // during load — that caused structural conflicts with Yjs
    // reconciliation and wiped the parent nodes.
    const migrateLegacyCaption = () => {
      if (!editor.isEditable) return;
      const caption = node.attrs.caption;
      if (!caption || node.content.childCount > 0) return;
      const pos = getPos();
      if (pos === undefined) return;

      editor
        .chain()
        .insertContentAt(pos + 1, {
          type: 'mediaCaption',
          content: [{ type: 'text', text: caption }],
        })
        .command(({ tr }) => {
          const current = tr.doc.nodeAt(pos);
          if (current) {
            tr.setNodeMarkup(pos, undefined, {
              ...current.attrs,
              caption: null,
            });
          }
          return true;
        })
        .focus(pos + 2 + caption.length)
        .run();
    };

    const limitWidthOrHeight = (
      { width, height }: WidthAndHeight,
      opts: { isSoundcloud?: boolean } = {},
    ) => {
      const minWidth = 200;
      const minHeight = opts.isSoundcloud ? 166 : 200;
      return width < minWidth || height < minHeight;
    };

    const documentHorizontalMouseMove = (e: MouseEvent | TouchEvent) => {
      // Determine if the event is a touch event and extract clientX accordingly
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;

      setTimeout(() => onHorizontalMouseMove(clientX));
    };

    const startHorizontalResize = (e: MouseEvent | TouchEvent) => {
      e.stopPropagation();
      // Check if it's a touch event and extract the clientX accordingly
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      lastClientXRef.current = clientX;

      setTimeout(() => {
        // Use both mouse and touch events for move and end actions
        document.addEventListener('mousemove', documentHorizontalMouseMove);
        document.addEventListener('mouseup', stopHorizontalResize);
        document.addEventListener('touchmove', documentHorizontalMouseMove);
        document.addEventListener('touchend', stopHorizontalResize);
      });

      setIsMouseDown(true);
    };

    const stopHorizontalResize = () => {
      lastClientXRef.current = -1;

      document.removeEventListener('mousemove', documentHorizontalMouseMove);
      document.removeEventListener('mouseup', stopHorizontalResize);
      document.removeEventListener('touchmove', documentHorizontalMouseMove);
      document.removeEventListener('touchend', stopHorizontalResize);

      setIsMouseDown(false);
    };

    const onHorizontalResize = (
      directionOfMouseMove: 'right' | 'left',
      diff: number,
    ) => {
      if (!resizableImgRef.current) {
        console.error('Media ref is undefined|null', {
          resizableImg: resizableImgRef.current,
        });
        return;
      }

      const currentMediaDimensions: WidthAndHeight = {
        width: resizableImgRef.current?.width as number,
        height: resizableImgRef.current?.height as number,
      };

      const newMediaDimensions: WidthAndHeight = {
        width: -1,
        height: -1,
      };

      // Ensure currentMediaDimensions.width is a number
      let width = parseFloat(currentMediaDimensions.width.toString());
      if (isNaN(width)) {
        width = 0; // Default width if current width is not a number
      }

      if (directionOfMouseMove === 'left') {
        newMediaDimensions.width = width - Math.abs(diff);
      } else {
        newMediaDimensions.width = width + Math.abs(diff);
      }

      // Ensure width does not exceed container width
      if (newMediaDimensions.width > proseMirrorContainerWidth) {
        newMediaDimensions.width = proseMirrorContainerWidth;
      }

      // Calculate height based on media type and aspect ratio
      if (mediaType === 'iframe') {
        // For SoundCloud keep fixed height (166px) and allow width resizing.
        if (isSoundcloudIframe) {
          newMediaDimensions.height = 166;
        } else {
          newMediaDimensions.height = newMediaDimensions.width / (16 / 9);
        }
      } else {
        // Ensure aspectRatio is a valid number
        const validAspectRatio = isNaN(aspectRatio) ? 1 : aspectRatio; // Fallback to 1 if aspectRatio is NaN
        newMediaDimensions.height = newMediaDimensions.width / validAspectRatio;
      }

      // Fallback for NaN dimensions
      newMediaDimensions.width = isNaN(newMediaDimensions.width)
        ? 0
        : newMediaDimensions.width;
      newMediaDimensions.height = isNaN(newMediaDimensions.height)
        ? 0
        : newMediaDimensions.height;

      if (
        limitWidthOrHeight(newMediaDimensions, {
          isSoundcloud: isSoundcloudIframe,
        })
      )
        return;

      updateAttributes(newMediaDimensions);
    };

    const onHorizontalMouseMove = (clientX: number) => {
      if (lastClientXRef.current === -1) return;

      const diff = lastClientXRef.current - clientX;

      if (diff === 0) return;

      const directionOfMouseMove: 'left' | 'right' =
        diff > 0 ? 'left' : 'right';

      setTimeout(() => {
        onHorizontalResize(directionOfMouseMove, Math.abs(diff));
        lastClientXRef.current = clientX;
      });
    };

    const [isFloat, setIsFloat] = useState<boolean>();

    const [isAlign, setIsAlign] = useState<boolean>();

    useEffect(() => {
      calculateMediaActionActiveStates();
      setIsFloat(node.attrs.dataFloat);
      setIsAlign(node.attrs.dataAlign);
    }, [node.attrs]);

    const handleTouchStart = (e: React.TouchEvent) => {
      // Prevent default to avoid scrolling while attempting to drag
      e.stopPropagation();

      // Store initial touch position
      dragStartPos.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      };

      // Set a timeout to distinguish between tap and drag
      const timeout = setTimeout(() => {
        setIsDragging(true);
      }, 500); // 500ms hold to start drag

      setTouchTimeout(timeout);
    };

    const handleTouchMove = (e: React.TouchEvent) => {
      if (!isDragging) {
        // If we moved before the drag started, cancel the timeout
        if (touchTimeout) {
          clearTimeout(touchTimeout);
          setTouchTimeout(null);
        }
        return;
      }

      e.stopPropagation();
    };

    const handleTouchEnd = () => {
      if (touchTimeout) {
        clearTimeout(touchTimeout);
        setTouchTimeout(null);
      }
      setIsDragging(false);
      dragStartPos.current = null;
    };

    useEffect(() => {
      return () => {
        if (touchTimeout) {
          clearTimeout(touchTimeout);
        }
      };
    }, [touchTimeout]);

    const startCornerResize = (
      corner: 'tl' | 'tr' | 'bl' | 'br',
      e: React.MouseEvent | React.TouchEvent,
    ) => {
      e.stopPropagation();
      e.preventDefault();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      lastClientXRef.current = clientX;

      const direction: 'left' | 'right' =
        corner === 'tl' || corner === 'bl' ? 'left' : 'right';

      const handleMove = (ev: MouseEvent | TouchEvent) => {
        const currentX = 'touches' in ev ? ev.touches[0].clientX : ev.clientX;
        const diff = lastClientXRef.current - currentX;
        if (diff === 0) return;

        const actualDirection: 'left' | 'right' =
          direction === 'left'
            ? diff > 0
              ? 'right'
              : 'left'
            : diff > 0
              ? 'left'
              : 'right';

        onHorizontalResize(actualDirection, Math.abs(diff));
        lastClientXRef.current = currentX;
      };

      const handleUp = () => {
        lastClientXRef.current = -1;
        document.removeEventListener('mousemove', handleMove);
        document.removeEventListener('mouseup', handleUp);
        document.removeEventListener('touchmove', handleMove);
        document.removeEventListener('touchend', handleUp);
        setIsMouseDown(false);
      };

      document.addEventListener('mousemove', handleMove);
      document.addEventListener('mouseup', handleUp);
      document.addEventListener('touchmove', handleMove);
      document.addEventListener('touchend', handleUp);
      setIsMouseDown(true);
    };

    return (
      <NodeViewWrapper
        as="article"
        className={cn(
          'media-node-view not-prose transition-all ease-in-out w-full',
          isFloat && `f-${node.attrs.dataFloat}`,
          isAlign && `justify-${node.attrs.dataAlign}`,
        )}
      >
        <div
          draggable={isDragging}
          data-drag-handle={isDragging}
          className={cn(
            'w-fit flex flex-col relative group transition-all ease-in-out',
            !isPreviewMode && 'p-2 pt-1 color-bg-secondary rounded-lg',
            isDragging && 'opacity-50',
          )}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
        >
          {!isPreviewMode && (
            <div className="flex gap-1 p-1 mb-1 ml-auto">
              {resizableMediaActions
                .filter((btn) => {
                  if (mediaType === 'iframe' && btn.tooltip === 'Add Caption')
                    return false;
                  return true;
                })
                .map((btn, index) => {
                  return (
                    <ToolbarButton
                      key={index}
                      variant={'ghost'}
                      tooltip={btn.tooltip}
                      isActive={mediaActionActiveState[btn.tooltip]}
                      onClick={() =>
                        btn.tooltip === 'Delete'
                          ? deleteNode()
                          : btn.action?.(updateAttributes, editor, getPos)
                      }
                      icon={btn.icon as string}
                      classNames="min-w-6 aspect-square"
                      size="sm"
                    />
                  );
                })}
            </div>
          )}
          <div
            contentEditable={false}
            className={cn(
              'relative',
              node.attrs.dataAlign === 'start' && 'self-start',
              node.attrs.dataAlign === 'center' && 'self-center',
              node.attrs.dataAlign === 'end' && 'self-end',
              isImageType && 'border-2',
              isImageType && selected
                ? 'border-[#5c0aff]'
                : 'border-transparent',
              // Round the backdrop to match the media's own rounded-lg so the
              // background doesn't poke out behind a transparent image's corners.
              node.attrs.backgroundColor && 'rounded-lg',
            )}
            style={
              node.attrs.backgroundColor
                ? { backgroundColor: node.attrs.backgroundColor }
                : undefined
            }
            onClick={() => {
              if (isPreviewMode) return;
              const pos = getPos();
              if (pos === undefined) return;
              editor.chain().setNodeSelection(pos).run();
            }}
          >
            {mediaType === 'img' && (
              <img
                src={node.attrs.src}
                ref={resizableImgRef as LegacyRef<HTMLImageElement>}
                className="rounded-lg"
                alt={node.attrs.src}
                width={node.attrs.width}
                height={node.attrs.height}
              />
            )}

            {mediaType === 'secure-img' &&
              !['2', 2].includes(node.attrs.version) && (
                <SecureImage
                  encryptedKey={node.attrs.encryptedKey}
                  url={node.attrs.url}
                  iv={node.attrs.iv}
                  privateKey={node.attrs.privateKey}
                  fetchV1ImageFn={fetchV1ImageFn}
                  alt={node.attrs.alt}
                  className="rounded-lg"
                  width={node.attrs.width}
                  height={node.attrs.height}
                  ref={resizableImgRef as LegacyRef<HTMLImageElement>}
                />
              )}

            {mediaType === 'secure-img' && node.attrs.version == '2' && (
              <SecureImageV2
                encryptionKey={node.attrs.encryptionKey}
                url={node.attrs.ipfsUrl}
                nonce={node.attrs.nonce}
                ipfsHash={node.attrs.ipfsHash}
                alt={node.attrs.alt}
                ipfsImageFetchFn={ipfsImageFetchFn}
                className="rounded-lg"
                width={node.attrs.width}
                height={node.attrs.height}
                mimeType={node.attrs.mimeType}
                ref={resizableImgRef as LegacyRef<HTMLImageElement>}
                authTag={node.attrs.authTag}
              />
            )}

            {mediaType === 'video' && (
              <video
                ref={resizableImgRef as LegacyRef<HTMLVideoElement>}
                className="rounded-lg"
                controls
                width={node.attrs.width}
                height={node.attrs.height}
              >
                <source src={node.attrs.src} />
              </video>
            )}

            {mediaType === 'iframe' && isSafeIframe && (
              <iframe
                ref={resizableImgRef as LegacyRef<HTMLIFrameElement>}
                className={cn(
                  'rounded-lg max-w-full',
                  isMouseDown && 'pointer-events-none',
                )}
                src={node.attrs.src}
                width={node.attrs.width}
                height={node.attrs.height}
                sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
                referrerPolicy="no-referrer"
              />
            )}

            {mediaType === 'iframe' && !isSafeIframe && (
              <div
                className="rounded-lg border color-border-default color-bg-secondary color-text-secondary text-sm p-4 max-w-full"
                style={{
                  width: node.attrs.width || 640,
                  minHeight: node.attrs.height || 120,
                }}
              >
                Embed blocked: unsupported or disallowed source
              </div>
            )}

            {!isPreviewMode && !isImageType && (
              <div
                className="horizontal-resize-handle group-hover:bg-[#2E2E2E] group-hover:border-2 group-hover:border-[#E8EBEC]"
                title="Resize"
                onClick={({ clientX }) => setLastClientX(clientX)}
                onMouseDown={(e: any) => startHorizontalResize(e)}
                onMouseUp={stopHorizontalResize}
                onTouchStart={(e: any) => startHorizontalResize(e)}
                onTouchEnd={stopHorizontalResize}
              />
            )}

            {!isPreviewMode && isImageType && selected && (
              <>
                {(['tl', 'tr', 'bl', 'br'] as const).map((corner) => (
                  <div
                    key={corner}
                    className={`corner-resize-handle ${corner}`}
                    onMouseDown={(e) => startCornerResize(corner, e)}
                    onTouchStart={(e) => startCornerResize(corner, e)}
                  />
                ))}
              </>
            )}
          </div>

          {node.content.childCount > 0 ? (
            <NodeViewContent
              as="div"
              className={cn('media-caption', {
                'text-left': node.attrs.dataAlign === 'start',
                'text-center': node.attrs.dataAlign === 'center',
                'text-right': node.attrs.dataAlign === 'end',
              })}
            />
          ) : node.attrs.caption ? (
            <div
              contentEditable={false}
              className={cn('media-caption media-caption-legacy', {
                'text-left': node.attrs.dataAlign === 'start',
                'text-center': node.attrs.dataAlign === 'center',
                'text-right': node.attrs.dataAlign === 'end',
              })}
              onClick={migrateLegacyCaption}
            >
              {node.attrs.caption}
            </div>
          ) : null}
        </div>
      </NodeViewWrapper>
    );
  };
