/* eslint-disable @typescript-eslint/no-explicit-any */
import { mergeAttributes, Node } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';

export interface TableRowOptions {
  HTMLAttributes: Record<string, any>;
}

export const stopPrevent = <T extends Event>(e: T): T => {
  (e as Event).stopPropagation();
  (e as Event).preventDefault();

  return e;
};

const isScrollable = function (ele: any) {
  const hasScrollableContent = ele.scrollHeight > ele.clientHeight;

  const overflowYStyle = window.getComputedStyle(ele).overflowY;
  const isOverflowHidden = overflowYStyle.indexOf('hidden') !== -1;

  return hasScrollableContent && !isOverflowHidden;
};

const getScrollableParent = function (ele: any): any {
  return !ele || ele === document.body
    ? document.body
    : isScrollable(ele)
      ? ele
      : getScrollableParent(ele.parentNode);
};

const getElementWithAttributes = (
  name: string,
  attrs?: Record<string, any>,
  events?: Record<string, any>,
) => {
  const el = document.createElement(name);

  if (!el) throw new Error(`Element with name ${name} can't be created.`);

  if (attrs) {
    Object.entries(attrs).forEach(([key, val]) => el.setAttribute(key, val));
  }

  if (events) {
    Object.entries(events).forEach(([key, val]) =>
      el.addEventListener(key, val),
    );
  }

  return el;
};

export const TableRow = Node.create<TableRowOptions>({
  name: 'tableRow',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  content: '(tableCell | tableHeader)*',

  tableRole: 'row',

  parseHTML() {
    return [{ tag: 'tr' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'tr',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      0,
    ];
  },

  addNodeView() {
    return ({ editor, HTMLAttributes, getPos }) => {
      // Markup
      /*
        <tr class="relative">
          <section onClick={selectCurrentRow} class="absolute -translate-x-full">
            <button class="absolute -translate-x-12"> D </button> <!-- Delete Row -->
          </section>

          <!-- NodeViewContent -->
        </tr>
      */

      const pos = () => (getPos as () => number)();

      const scrollableParent = getScrollableParent(
        editor.options.element,
      ) as HTMLDivElement;

      let isCursorInsideControlSection = false;

      const actions = {
        deleteRow: () => {
          this.editor.chain().deleteNode('tableRow').focus().run();
        },
        selectRow: () => {
          const from = pos();

          const resolvedFrom = editor.state.doc.resolve(from);

          const nodeSel = new NodeSelection(resolvedFrom);

          editor.view.dispatch(editor.state.tr.setSelection(nodeSel));
        },
      };

      const setCursorInsideControlSection = () => {
        isCursorInsideControlSection = true;
      };

      const setCursorOutsideControlSection = () => {
        isCursorInsideControlSection = false;
      };

      const controlSection = getElementWithAttributes(
        'section',
        {
          // Hidden until the row is hovered; showControls() positions it
          // before revealing it.
          class: 'hidden',
          contenteditable: 'false',
        },
        {
          click: (e: any) => {
            if (e) stopPrevent(e);

            actions.selectRow();
          },
          mouseenter: () => {
            setCursorInsideControlSection();
          },
          mouseover: () => {
            setCursorInsideControlSection();
          },
          mouseleave: () => {
            setCursorOutsideControlSection();
            hideControls();
          },
        },
      );

      const deleteButton = getElementWithAttributes(
        'button',
        {
          class:
            'text-sm px-1 absolute -translate-x-[125%] hover:active:-translate-x-[125%] mr-2',
        },
        {
          click: (e: any) => {
            if (e) stopPrevent(e);

            actions.deleteRow();
          },
        },
      );

      const showControls = () => {
        applyControlsPosition();
        controlSection.classList.remove('hidden');
      };

      const hideControls = () => {
        setTimeout(() => {
          if (isCursorInsideControlSection) return;
          controlSection.classList.add('hidden');
        }, 100);
      };

      // const tableRow = getElementWithAttributes("tr", { class: "content" });
      const tableRow = getElementWithAttributes(
        'tr',
        { ...HTMLAttributes },
        {
          mouseenter: showControls,
          mouseover: showControls,
          mouseleave: hideControls,
        },
      );

      // deleteButton.textContent = 'x'

      controlSection.append(deleteButton);

      document.body.append(controlSection);

      let rectBefore = '';

      const applyControlsPosition = () => {
        const rowCoords = tableRow.getBoundingClientRect();
        const stringifiedRowCoords = JSON.stringify(rowCoords);

        if (rectBefore === stringifiedRowCoords) return;

        controlSection.style.top = `${
          rowCoords.top + document.documentElement.scrollTop
        }px`;
        controlSection.style.left = `${
          rowCoords.x + document.documentElement.scrollLeft - 8
        }px`;
        controlSection.style.height = `${rowCoords.height + 1}px`;

        rectBefore = stringifiedRowCoords;
      };

      // Every row node view used to queue a setTimeout + getBoundingClientRect
      // on every editor update and selection change, even while its controls
      // were hidden. With N rows that is N timers per keystroke across the
      // document. Track the row only while its controls are showing;
      // showControls() positions them synchronously before revealing them.
      const repositionIfVisible = () => {
        if (controlSection.classList.contains('hidden')) return;
        setTimeout(applyControlsPosition);
      };

      editor.on('selectionUpdate', repositionIfVisible);
      editor.on('update', repositionIfVisible);
      scrollableParent?.addEventListener('scroll', repositionIfVisible);
      document.addEventListener('scroll', repositionIfVisible);

      const destroy = () => {
        controlSection.remove();
        editor.off('selectionUpdate', repositionIfVisible);
        editor.off('update', repositionIfVisible);
        scrollableParent?.removeEventListener('scroll', repositionIfVisible);
        document.removeEventListener('scroll', repositionIfVisible);
      };

      return {
        dom: tableRow,
        contentDOM: tableRow,
        destroy,
      };
    };
  },
});
