import {
  cn,
  IconButton,
  Tooltip,
  // IconButton
} from '@fileverse/ui';
import { TextSelection } from '@tiptap/pm/state';
import { useState, useMemo, useCallback, memo, useRef, useEffect } from 'react';
import { ToCProps, ToCItemProps, ToCItemType } from './types';
import { useCopyToClipboard, useMediaQuery } from 'usehooks-ts';
import { headingToSlug } from '../../utils/heading-to-slug';
import { getEditorScrollContainer } from '../../utils/get-editor-scroll-container';

const isValidToCItemId = (id: unknown): id is string =>
  typeof id === 'string' && id.length > 0;

// Memoize the ToC item to prevent unnecessary re-renders
export const ToCItem = memo(
  ({
    item,
    onItemClick,
    index,
    orientation,
    // onItemRemove,
  }: ToCItemProps) => {
    // Memoize the click handler to prevent recreating it on every render
    const [, copyToClipboard] = useCopyToClipboard();
    const [copyState, setCopyState] = useState<boolean | null>(null);
    const itemId = item.id;

    function handleCopyToClipboard(
      ev: React.MouseEvent<HTMLButtonElement>,
      val: string,
    ) {
      ev.stopPropagation();
      copyToClipboard(val)
        .then((success) => {
          if (success) {
            setCopyState(true);
          } else {
            setCopyState(false);
          }
        })
        .finally(() =>
          setTimeout(() => {
            setCopyState(null);
          }, 500),
        );
    }
    const handleClick = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isValidToCItemId(itemId)) return;
        onItemClick(e, itemId);
      },
      // Keep memoization tied to the primitive heading ID.
      [onItemClick, itemId],
    );

    // Memoize the href generation
    const href = useMemo(() => {
      if (!isValidToCItemId(itemId)) {
        return globalThis.location.href;
      }

      const heading = headingToSlug(item.textContent);
      const uuid = itemId.replace(/-/g, '').substring(0, 8);
      const headingValue = `${heading}-${uuid}`;

      // Build the full URL with current location, preserving other hash params
      const url = new URL(globalThis.location.href);

      // Parse existing hash as URLSearchParams
      const hash = url.hash.startsWith('#') ? url.hash.substring(1) : url.hash;
      const hashParams = new URLSearchParams(hash);

      // Update only the heading parameter
      hashParams.set('heading', headingValue);

      // Set the updated hash
      url.hash = hashParams.toString();

      return url.toString();
    }, [itemId, item.textContent]);

    // Memoize the className calculation with orientation-based widths
    const className = useMemo(() => {
      // Calculate breakpoints to prevent overlap:
      // Canvas Left Margin = (Screen Width - Canvas Width) / 2
      // No overlap when: (Screen Width - Canvas Width) / 2 > TOC Width + 40px padding
      //
      // Portrait (850px canvas):
      //   - 1280-1409px: 160px TOC (safe: (1280-850)/2 = 215px > 200px)
      //   - 1410-1599px: 240px TOC (safe: (1410-850)/2 = 280px > 280px)
      //   - 1600px+: 320px TOC (safe: (1600-850)/2 = 375px > 360px)
      //
      // Landscape (1190px canvas):
      //   - 1280-1749px: 160px TOC (safe with canvas shift on 1360-1599px)
      //   - 1750px+: 240px TOC (safe centered: (1750-1190)/2 = 280px > 240px)
      const widthClasses =
        orientation === 'landscape'
          ? 'xl:!max-w-[160px] min-[1750px]:!max-w-[240px]'
          : 'xl:!max-w-[160px] min-[1410px]:!max-w-[240px] min-[1600px]:!max-w-[320px]';

      return cn(
        `flex items-center transition-all text-body-sm-bold max-[1280px]:h-[32px] max-[1280px]:px-2 max-[1280px]:py-1 h-5 max-[1280px]:max-w-full ${widthClasses} xl:border-l-2`,
        item.isActive
          ? 'color-border-active color-text-default max-[1280px]:border-none max-[1280px]:bg-[#F8F9FA] max-[1280px]:rounded max-[1280px]:text-[#363B3F]'
          : 'color-text-secondary border-transparent lg:hover:!brightness-90',
      );
    }, [item.isActive, orientation]);

    return (
      <div
        data-index={index}
        style={{
          paddingLeft: `${(item.level - 1) * 8}px`,
        }}
        className={className}
      >
        <a
          href={href}
          onClick={handleClick}
          data-item-index={item.itemIndex}
          className="flex items-center justify-between pl-2 gap-1 h-[36px] transition-all no-underline w-full group/toc-item"
        >
          <span className="truncate">{item.textContent}</span>
          <Tooltip
            text={copyState ? 'Heading link copied' : 'Copy heading link'}
            position={'right'}
          >
            <IconButton
              icon={copyState ? 'Check' : 'Clipboard'}
              size="sm"
              variant="ghost"
              className={cn(
                '!bg-transparent group-hover/toc-item:opacity-100 opacity-0 transition-all color-text-secondary active:scale-75',
                item.isActive
                  ? 'max-[1280px]:visible'
                  : 'max-[1280px]:invisible',
              )}
              onClick={(ev) => handleCopyToClipboard(ev, href)}
            />
          </Tooltip>
        </a>
      </div>
    );
  },
);

ToCItem.displayName = 'ToCItem';

export const ToCEmptyState = memo(() => {
  return (
    <p className="text-helper-text-sm px-[12px] color-text-secondary">
      Heading that you add to the document will appear here
    </p>
  );
});

ToCEmptyState.displayName = 'ToCEmptyState';

export const ToC = memo(
  ({ items = [], editor, setItems, orientation }: ToCProps) => {
    const [activeId, setActiveId] = useState<string | null>(null);
    const isMobile = useMediaQuery('(max-width: 1280px)');

    // Add refs for the cache
    const headingsCacheRef = useRef<Map<string, HTMLElement> | null>(null);
    const lastCacheTimeRef = useRef<number>(0);
    const updateTimeoutRef = useRef<number | null>(null);

    // No longer using context for collapsed headings - they're stored in document

    // Memoize the filtered and processed items for faster rendering
    const processedItems = useMemo(() => {
      return items.map((item) => ({
        ...item,
        isActive: isValidToCItemId(item.id) && item.id === activeId,
      }));
    }, [items, activeId]);

    // Update getHeadingsMap to use refs and be more efficient
    const getHeadingsMap = useCallback(() => {
      if (
        editor &&
        editor.view?.dom &&
        (!headingsCacheRef.current ||
          Date.now() - lastCacheTimeRef.current > 250)
      ) {
        const newMap = new Map<string, HTMLElement>();

        // Use a more efficient selector that queries all headings at once
        const allHeadings = editor.view.dom.querySelectorAll('[data-toc-id]');
        allHeadings.forEach((element) => {
          const id = element.getAttribute('data-toc-id');
          if (id) {
            newMap.set(id, element as HTMLElement);
          }
        });

        headingsCacheRef.current = newMap;
        lastCacheTimeRef.current = Date.now();
      }

      return headingsCacheRef.current;
    }, [editor]);

    // Add effect to handle editor updates
    useEffect(() => {
      if (!editor) return;

      const handleUpdate = () => {
        if (updateTimeoutRef.current) {
          cancelAnimationFrame(updateTimeoutRef.current);
        }

        updateTimeoutRef.current = requestAnimationFrame(() => {
          // Force cache refresh on editor update
          headingsCacheRef.current = null;
          getHeadingsMap();
        });
      };

      editor.on('update', handleUpdate);
      editor.on('selectionUpdate', handleUpdate);

      return () => {
        editor.off('update', handleUpdate);
        editor.off('selectionUpdate', handleUpdate);
        if (updateTimeoutRef.current) {
          cancelAnimationFrame(updateTimeoutRef.current);
        }
      };
    }, [editor, getHeadingsMap]);

    // Helper to expand heading by updating document attributes
    const expandHeading = useCallback(
      (headingId: string) => {
        if (!editor) return;

        // Find the heading in the document
        const { doc } = editor.state;
        let headingPos = -1;

        doc.descendants((node, pos) => {
          if (node.type.name === 'dBlock') {
            const headingNode = node.content.content?.[0];
            if (
              headingNode?.type.name === 'heading' &&
              headingNode.attrs.id === headingId
            ) {
              headingPos = pos;
              return false; // Stop searching
            }
          }
          // Flat v2 schema: headings are top-level, match them directly.
          // (In v1 the dBlock branch above wins first, since parents are
          // visited before children.)
          if (node.type.name === 'heading' && node.attrs.id === headingId) {
            headingPos = pos;
            return false;
          }
        });

        if (headingPos !== -1) {
          editor
            .chain()
            .setNodeSelection(headingPos)
            .updateAttributes('heading', { isCollapsed: false })
            .run();
        }
      },
      [editor],
    );

    // Fix for handling heading expansion
    const expandHeadingAndItsAncestors = useCallback(
      (id: string) => {
        if (!editor) return;

        // Expand the clicked heading
        expandHeading(id);

        // Find the clicked item
        const clickedItem = items.find((item) => item.id === id);
        if (!clickedItem) return;

        const clickedLevel = clickedItem.level;

        // If clicked item is H1, expand all its nested content
        if (clickedLevel === 1) {
          let isWithinCurrentH1 = false;

          items.forEach((item) => {
            // Start collecting items after current H1
            if (item.id === id) {
              isWithinCurrentH1 = true;
              return;
            }

            // Stop when we hit the next H1
            if (item.level === 1) {
              isWithinCurrentH1 = false;
              return;
            }

            // Expand all items between current H1 and next H1
            if (isWithinCurrentH1) {
              if (isValidToCItemId(item.id)) {
                expandHeading(item.id);
              }
            }
          });
        } else {
          // For non-H1 headings, find and expand all ancestors
          // Simple iteration up the levels to find ancestors
          for (
            let i = items.findIndex((item) => item.id === id) - 1;
            i >= 0;
            i--
          ) {
            const item = items[i];
            if (item.level < clickedLevel) {
              if (isValidToCItemId(item.id)) {
                expandHeading(item.id);
              }
              if (item.level === 1) break; // Stop at H1
            }
          }
        }
      },
      [items, editor, expandHeading],
    );

    // Optimize clicking on a heading by using the cached heading structure
    const onItemClick = useCallback(
      (e: React.MouseEvent, id: string) => {
        e.preventDefault();
        e.stopPropagation();

        // Update active item
        setActiveId(id);

        if (editor && editor.view?.dom) {
          // First handle heading expansion - this is critical for making the TOC work
          expandHeadingAndItsAncestors(id);

          // Find the element - try the DOM cache first, but fall back to direct query if not found
          const headingsMap = getHeadingsMap();
          let element = headingsMap?.get(id);

          // If not found in the cache, try direct lookup and refresh the cache
          if (!element) {
            element = editor.view.dom.querySelector(
              `[data-toc-id="${id}"]`,
            ) as HTMLElement;
            if (element && headingsMap) {
              headingsMap.set(id, element);
            }
          }

          if (!element) {
            return;
          }

          // Add a small delay to allow DOM updates before scrolling
          const timeout = setTimeout(() => {
            const pos = editor.view.posAtDOM(element as Node, 0);

            // set focus
            const tr = editor.view.state.tr;
            tr.setSelection(new TextSelection(tr.doc.resolve(pos)));
            editor.view.dispatch(tr);

            const scrollContainer = getEditorScrollContainer({
              targetElement: element,
              editorRoot: editor.view.dom as HTMLElement,
            });

            if (scrollContainer) {
              // Use requestAnimationFrame to ensure DOM updates are complete
              requestAnimationFrame(() => {
                const containerRect = scrollContainer.getBoundingClientRect();
                const elementRect = (
                  element as HTMLElement
                ).getBoundingClientRect();

                // Calculate the scroll position to start the element at the top of the container
                const scrollTop =
                  elementRect.top -
                  containerRect.top -
                  containerRect.height / (isMobile ? 5 : 7) +
                  elementRect.height / (isMobile ? 5 : 7);

                scrollContainer.scrollBy({
                  top: scrollTop,
                  behavior: 'smooth',
                });
              });
            }
          }, 0);

          return () => clearTimeout(timeout);
        }
      },
      [editor, expandHeadingAndItsAncestors, getHeadingsMap, isMobile],
    );

    const onItemRemove = useCallback(
      (e: React.MouseEvent, id: string) => {
        e.preventDefault();
        e.stopPropagation();

        setItems((prev: ToCItemType[]) => {
          // Find the index of the item being removed
          const removedIndex = prev.findIndex((item) => item.id === id);
          const filtered = prev.filter((item) => item.id !== id);

          // Only update active item if we're removing the currently active item
          if (id === activeId && filtered.length > 0) {
            const nextItem =
              removedIndex === prev.length - 1
                ? filtered[filtered.length - 1]
                : filtered[removedIndex];

            if (isValidToCItemId(nextItem?.id)) {
              onItemClick(e, nextItem.id);
            } else {
              setActiveId(null);
            }
          } else if (filtered.length === 0) {
            setActiveId(null);
          }

          return filtered;
        });
      },
      [activeId, onItemClick, setItems],
    );

    // Empty state check
    if (items.length === 0) {
      return <ToCEmptyState />;
    }

    return (
      <div className="flex flex-col max-[1280px]:gap-2 gap-4 pl-[35px] mb-3">
        {processedItems.map((item, i) => (
          <ToCItem
            onItemClick={onItemClick}
            onItemRemove={onItemRemove}
            key={
              isValidToCItemId(item.id)
                ? item.id
                : `missing-toc-id-${i}-${item.itemIndex}`
            }
            item={item}
            index={i + 1}
            orientation={orientation}
          />
        ))}
      </div>
    );
  },
);

ToC.displayName = 'ToC';
