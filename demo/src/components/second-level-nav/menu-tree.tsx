// demo/src/components/second-level-nav/menu-tree.tsx
// The demo's canonical tree — the consumer ddocMenuTree (D2, one tree +
// capability projection) minus consumer-only items (version history, rename,
// move-to, delete, templates, copy-as-markdown, local LLM, backup key, Help,
// Themes). Predicates reference ctx.caps.* only — never roles.
import type { MenuBarTree, MenuContext } from './menu-types';

const canEdit = (c: MenuContext) => c.caps.canEdit;
const canCreate = (c: MenuContext) => c.caps.canCreate;
const canTools = (c: MenuContext) => c.caps.canUseTools;
const hasSelection = (c: MenuContext) => c.caps.hasSelection;
const isOnline = (c: MenuContext) => c.caps.isOnline;
// ticket scopes these to owner, not all editors
const ownerOnly = (c: MenuContext) => c.caps.canManageDoc;

export const demoMenuTree: MenuBarTree = [
  {
    id: 'file',
    label: 'File',
    children: [
      {
        id: 'file.new',
        kind: 'submenu',
        label: 'New dDoc',
        icon: 'Plus',
        visibleWhen: canCreate,
        children: [
          {
            id: 'file.new.blank',
            kind: 'action',
            icon: 'Plus',
            label: 'Blank dDoc',
            action: 'file.new.blank',
          },
        ],
      },
      {
        id: 'file.importexport',
        kind: 'submenu',
        label: (c) => (c.caps.canManageDoc ? 'Import / Export' : 'Export'),
        icon: 'FileImport',
        enabledWhen: isOnline,
        children: [
          {
            id: 'file.import',
            kind: 'group',
            label: 'Import',
            visibleWhen: (c) => c.caps.canManageDoc,
            children: [
              {
                id: 'file.import.md',
                kind: 'action',
                label: 'Markdown (.md)',
                icon: 'FileImport',
                action: 'file.import.md',
              },
              {
                id: 'file.import.docx',
                kind: 'action',
                label: 'Microsoft Word (.docx)',
                icon: 'FileImport',
                action: 'file.import.docx',
              },
            ],
          },
          {
            id: 'file.exportGroup',
            kind: 'group',
            label: (c) => (c.caps.canManageDoc ? 'Export' : ''),
            children: [
              {
                id: 'file.export.pdf',
                kind: 'action',
                label: 'PDF document (.pdf)',
                icon: 'FileExport',
                action: 'file.export.pdf',
                visibleWhen: canEdit,
              },
              {
                id: 'file.export.html',
                kind: 'action',
                label: 'Web page (.html)',
                icon: 'FileExport',
                action: 'file.export.html',
                visibleWhen: canEdit,
              },
              {
                id: 'file.export.txt',
                kind: 'action',
                label: 'Plain text (.txt)',
                icon: 'FileExport',
                action: 'file.export.txt',
                visibleWhen: canEdit,
              },
              {
                id: 'file.export.md',
                kind: 'action',
                label: (c) =>
                  c.caps.canEdit ? 'Markdown (.md)' : 'Export as .md',
                icon: 'FileExport',
                action: 'file.export.md',
              },
            ],
          },
        ],
      },
      { id: 'file.sep2', kind: 'separator' },
      {
        id: 'file.print',
        kind: 'action',
        label: 'Print',
        icon: 'Printer',
        action: 'file.print',
      },
    ],
  },
  {
    id: 'edit',
    label: 'Edit',
    children: [
      {
        id: 'edit.undo',
        kind: 'action',
        label: 'Undo',
        icon: 'Undo2',
        action: 'edit.undo',
        visibleWhen: canEdit,
      },
      {
        id: 'edit.redo',
        kind: 'action',
        label: 'Redo',
        icon: 'Redo2',
        action: 'edit.redo',
        visibleWhen: canEdit,
      },
      { id: 'edit.sep1', kind: 'separator' },
      {
        id: 'edit.cut',
        kind: 'action',
        label: 'Cut',
        icon: 'Scissors',
        action: 'edit.cut',
        visibleWhen: canEdit,
        enabledWhen: hasSelection,
      },
      {
        id: 'edit.copy',
        kind: 'action',
        label: 'Copy',
        icon: 'Copy',
        action: 'edit.copy',
        visibleWhen: canEdit,
        enabledWhen: hasSelection,
      },
      {
        id: 'edit.paste',
        kind: 'action',
        label: 'Paste',
        icon: 'Clipboard',
        action: 'edit.paste',
        visibleWhen: canEdit,
      },
      {
        id: 'edit.pasteWithoutFormatting',
        kind: 'action',
        icon: 'ClipboardRemoveFormatting',
        label: 'Paste without formatting',
        action: 'edit.pasteWithoutFormatting',
        visibleWhen: canEdit,
      },
      { id: 'edit.sep2', kind: 'separator' },
      {
        id: 'edit.selectAll',
        kind: 'action',
        icon: 'TextSelectIcon',
        label: 'Select all',
        action: 'edit.selectAll',
        visibleWhen: canEdit,
      },
      {
        id: 'edit.delete',
        kind: 'action',
        label: 'Delete',
        icon: 'Trash2',
        action: 'edit.delete',
        visibleWhen: canEdit,
        enabledWhen: hasSelection,
      },
      {
        id: 'edit.findReplace',
        kind: 'action',
        label: 'Find and replace',
        icon: 'FileSearch',
        action: 'edit.findReplace',
        visibleWhen: canEdit,
      },
    ],
  },
  {
    id: 'view',
    label: 'View',
    children: [
      {
        id: 'view.comments',
        kind: 'submenu',
        label: 'Comments',
        icon: 'MessageSquareText',
        visibleWhen: (c) => c.caps.canComment,
        // Visible-but-disabled when comments aren't actually usable
        // (unpublished/RTC/offline — see canUseComments, capabilities.ts),
        // consistent with the ticket's RTC treatment elsewhere. TEC-1458 bug:
        // this was previously unconditionally enabled once visible.
        enabledWhen: (c) => c.caps.canUseComments,
        children: [
          {
            id: 'view.comments.toggleCanvas',
            kind: 'action',
            label: (c) =>
              c.state['view.comments.toggleCanvas']?.isActive
                ? 'Show comments'
                : 'Hide comments',
            action: 'view.comments.toggleCanvas',
            visibleWhen: canEdit,
          },
          {
            id: 'view.comments.showAll',
            kind: 'action',
            label: 'Show all comments',
            action: 'view.comments.showAll',
            // Makes capabilities.ts's commentRequiresAuth live: an unauth
            // permission-holding viewer clicking this goes to the login flow
            // instead of opening the drawer (TEC-1458 bug: was previously
            // dead — no tree node consulted it).
            requiresAuth: (c) => c.caps.commentRequiresAuth,
          },
        ],
      },
      {
        id: 'view.outlines',
        kind: 'action',
        icon: 'List',
        label: (c) =>
          c.state['view.outlines.toggle']?.isActive
            ? 'Collapse outlines'
            : 'Expand tabs and outlines',
        action: 'view.outlines.toggle',
      },
      {
        id: 'view.styles',
        kind: 'action',
        label: 'Styles',
        icon: 'Paintbrush',
        action: 'view.styles',
        visibleWhen: canEdit,
      },
      // Demo-only: D6 controlled focus mode dogfood (not in the consumer tree).
      {
        id: 'view.focusMode',
        kind: 'action',
        icon: 'Focus',
        label: 'Focus mode',
        action: 'view.focusMode',
        visibleWhen: ownerOnly,
      },
      {
        id: 'view.splitView',
        kind: 'action',
        icon: 'SquareSplitHorizontal',
        label: (c) =>
          c.state['view.splitView']?.isActive
            ? 'Editor View'
            : 'Split Markdown View',
        action: 'view.splitView',
        visibleWhen: ownerOnly,
        enabledWhen: (c) => c.caps.canSplitView,
      },
      { id: 'view.sep1', kind: 'separator' },
      {
        id: 'view.zoom',
        kind: 'submenu',
        label: 'Zoom',
        icon: 'ZoomIn',
        visibleWhen: canEdit,
        children: (
          [
            ['fit', 'Fit'],
            ['50', '50%'],
            ['75', '75%'],
            ['100', '100%'],
            ['150', '150%'],
            ['200', '200%'],
          ] as const
        ).map(([value, label]) => ({
          id: `view.zoom.${value}`,
          kind: 'radio' as const,
          label,
          value,
          action: 'view.zoom',
          state: (c: MenuContext) => c.state['view.zoom']?.current === value,
        })),
      },
    ],
  },
  {
    id: 'insert',
    label: 'Insert',
    children: [
      {
        id: 'insert.image',
        kind: 'action',
        label: 'Image',
        icon: 'Image',
        action: 'insert.image',
        visibleWhen: canEdit,
      },
      {
        id: 'insert.table',
        kind: 'action',
        label: 'Table',
        icon: 'Table',
        action: 'insert.table',
        visibleWhen: canEdit,
      },
      {
        id: 'insert.link',
        kind: 'action',
        label: 'Link',
        icon: 'Link',
        action: 'insert.link',
        visibleWhen: canEdit,
      },
      {
        id: 'insert.callout',
        kind: 'action',
        label: 'Callout',
        icon: 'Callout',
        action: 'insert.callout',
        visibleWhen: canEdit,
      },
      {
        id: 'insert.quote',
        kind: 'action',
        label: 'Quote',
        icon: 'TextQuote',
        action: 'insert.quote',
        visibleWhen: canEdit,
      },
      {
        id: 'insert.code',
        kind: 'action',
        label: 'Code',
        icon: 'Code',
        action: 'insert.code',
        visibleWhen: canEdit,
      },
      {
        id: 'insert.codeBlock',
        kind: 'action',
        label: 'Code block',
        icon: 'Braces',
        action: 'insert.codeBlock',
        visibleWhen: canEdit,
      },
      {
        id: 'insert.mermaid',
        kind: 'action',
        label: 'Mermaid diagram',
        icon: 'GitGraph',
        action: 'insert.mermaid',
        visibleWhen: canEdit,
      },
      {
        id: 'insert.plainText',
        kind: 'action',
        label: 'Plain text',
        icon: 'NotepadText',
        action: 'insert.plainText',
        visibleWhen: canEdit,
      },
      {
        id: 'insert.video',
        kind: 'action',
        label: 'Video',
        icon: 'Youtube',
        action: 'insert.video',
        visibleWhen: canEdit,
      },
      {
        id: 'insert.tweet',
        kind: 'action',
        label: 'Tweet',
        icon: 'XSocial',
        action: 'insert.tweet',
        visibleWhen: canEdit,
      },
      {
        id: 'insert.soundcloud',
        kind: 'action',
        label: 'Soundcloud',
        icon: 'Soundcloud',
        action: 'insert.soundcloud',
        visibleWhen: canEdit,
      },
      { id: 'insert.sep1', kind: 'separator' },
      {
        id: 'insert.tab',
        kind: 'action',
        label: 'Tab',
        icon: 'FilePlus',
        action: 'insert.tab',
        visibleWhen: canEdit,
      },
      {
        id: 'insert.divider',
        kind: 'action',
        label: 'Divider',
        icon: 'Minus',
        action: 'insert.divider',
        visibleWhen: canEdit,
      },
      {
        id: 'insert.pageBreak',
        kind: 'action',
        label: 'Page break',
        icon: 'PageBreak',
        action: 'insert.pageBreak',
        visibleWhen: canEdit,
      },
      { id: 'insert.sep2', kind: 'separator' },
      {
        id: 'insert.comment',
        kind: 'action',
        label: 'Comment',
        icon: 'MessageSquareText',
        action: 'insert.comment',
        visibleWhen: (c) => c.caps.canComment && canEdit(c),
        // Reflect the package command's enablement (word target under the
        // cursor + isInlineCommentAvailable) — same pattern as format.table.
        enabledWhen: (c) => c.state['insert.comment']?.isEnabled ?? false,
      },
    ],
  },
  {
    id: 'format',
    label: 'Format',
    children: [
      {
        id: 'format.text',
        kind: 'submenu',
        label: 'Text',
        icon: 'Text',
        visibleWhen: canEdit,
        children: [
          {
            id: 'format.bold',
            kind: 'checkbox',
            label: 'Bold',
            icon: 'Bold',
            action: 'format.bold',
            state: (c) => c.state['format.bold']?.isActive ?? false,
          },
          {
            id: 'format.italic',
            kind: 'checkbox',
            label: 'Italic',
            icon: 'Italic',
            action: 'format.italic',
            state: (c) => c.state['format.italic']?.isActive ?? false,
          },
          {
            id: 'format.underline',
            kind: 'checkbox',
            label: 'Underline',
            icon: 'Underline',
            action: 'format.underline',
            state: (c) => c.state['format.underline']?.isActive ?? false,
          },
          {
            id: 'format.strike',
            kind: 'checkbox',
            label: 'Strike-through',
            icon: 'Strikethrough',
            action: 'format.strike',
            state: (c) => c.state['format.strike']?.isActive ?? false,
          },
          {
            id: 'format.superscript',
            kind: 'checkbox',
            label: 'Superscript',
            icon: 'Superscript',
            action: 'format.superscript',
            state: (c) => c.state['format.superscript']?.isActive ?? false,
          },
          {
            id: 'format.subscript',
            kind: 'checkbox',
            label: 'Subscript',
            icon: 'Subscript',
            action: 'format.subscript',
            state: (c) => c.state['format.subscript']?.isActive ?? false,
          },
          { id: 'format.text.sep', kind: 'separator' },
          {
            id: 'format.fontSize',
            kind: 'submenu',
            label: 'Font size',
            children: [
              {
                id: 'format.fontSize.increase',
                kind: 'action',
                label: 'Increase font size',
                action: 'format.fontSize.increase',
              },
              {
                id: 'format.fontSize.decrease',
                kind: 'action',
                label: 'Decrease font size',
                action: 'format.fontSize.decrease',
              },
            ],
          },
        ],
      },
      {
        id: 'format.paragraph',
        kind: 'submenu',
        label: 'Paragraph styles',
        icon: 'Heading1',
        visibleWhen: canEdit,
        children: [
          {
            id: 'format.heading.1',
            kind: 'radio',
            label: 'Heading 1',
            icon: 'Heading1',
            value: '1',
            action: 'format.heading',
            state: (c) => c.state['format.heading']?.current === '1',
          },
          {
            id: 'format.heading.2',
            kind: 'radio',
            label: 'Heading 2',
            icon: 'Heading2',
            value: '2',
            action: 'format.heading',
            state: (c) => c.state['format.heading']?.current === '2',
          },
          {
            id: 'format.heading.3',
            kind: 'radio',
            label: 'Heading 3',
            icon: 'Heading3',
            value: '3',
            action: 'format.heading',
            state: (c) => c.state['format.heading']?.current === '3',
          },
          {
            id: 'format.heading.paragraph',
            kind: 'radio',
            label: 'Text',
            icon: 'Type',
            value: 'paragraph',
            action: 'format.heading',
            state: (c) => c.state['format.heading']?.current === 'paragraph',
          },
        ],
      },
      {
        id: 'format.align',
        kind: 'submenu',
        label: 'Align',
        icon: 'AlignLeft',
        visibleWhen: canEdit,
        children: [
          {
            id: 'format.align.left',
            kind: 'radio',
            label: 'Left',
            value: 'left',
            icon: 'AlignLeft',
            action: 'format.align',
            state: (c) => c.state['format.align']?.current === 'left',
          },
          {
            id: 'format.align.center',
            kind: 'radio',
            label: 'Centre',
            value: 'center',
            icon: 'AlignCenter',
            action: 'format.align',
            state: (c) => c.state['format.align']?.current === 'center',
          },
          {
            id: 'format.align.right',
            kind: 'radio',
            label: 'Right',
            value: 'right',
            icon: 'AlignRight',
            action: 'format.align',
            state: (c) => c.state['format.align']?.current === 'right',
          },
          {
            id: 'format.align.justify',
            kind: 'radio',
            label: 'Justified',
            value: 'justify',
            icon: 'AlignJustify',
            action: 'format.align',
            state: (c) => c.state['format.align']?.current === 'justify',
          },
        ],
      },
      {
        id: 'format.lineHeight',
        kind: 'submenu',
        label: 'Line height',
        icon: 'UnfoldVertical',
        visibleWhen: canEdit,
        children: ['1', '1.15', '1.5', '2', '2.5', '3'].map((v) => ({
          id: `format.lineHeight.${v.replace('.', '_')}`,
          kind: 'radio' as const,
          label: v,
          value: v,
          action: 'format.lineHeight',
          state: (c: MenuContext) =>
            c.state['format.lineHeight']?.current === v,
        })),
      },
      {
        id: 'format.lists',
        kind: 'submenu',
        label: 'Bullets and numbering',
        icon: 'List',
        visibleWhen: canEdit,
        children: [
          {
            id: 'format.list.numbered',
            kind: 'checkbox',
            label: 'Numbered list',
            icon: 'ListOrdered',
            action: 'format.list.numbered',
            state: (c) => c.state['format.list.numbered']?.isActive ?? false,
          },
          {
            id: 'format.list.bullet',
            kind: 'checkbox',
            label: 'Bullet list',
            icon: 'List',
            action: 'format.list.bullet',
            state: (c) => c.state['format.list.bullet']?.isActive ?? false,
          },
          {
            id: 'format.list.check',
            kind: 'checkbox',
            label: 'Checklist',
            icon: 'ListChecks',
            action: 'format.list.check',
            state: (c) => c.state['format.list.check']?.isActive ?? false,
          },
        ],
      },
      {
        id: 'format.columns',
        kind: 'submenu',
        label: 'Columns',
        icon: 'Columns2',
        visibleWhen: canEdit,
        children: [
          {
            id: 'format.columns.2',
            kind: 'action',
            label: '2 columns',
            icon: 'Columns2',
            action: 'insert.columns2',
          },
          {
            id: 'format.columns.3',
            kind: 'action',
            label: '3 columns',
            icon: 'Columns3',
            action: 'insert.columns3',
          },
        ],
      },
      {
        id: 'format.orientation',
        kind: 'submenu',
        label: 'Page orientation',
        icon: 'RectanglePosition',
        visibleWhen: canEdit,
        children: [
          {
            id: 'format.orientation.horizontal',
            kind: 'radio',
            label: 'Horizontal',
            icon: 'RectangleHorizontal',
            value: 'landscape',
            action: 'format.pageOrientation',
            state: (c) =>
              c.state['format.pageOrientation']?.current === 'landscape',
          },
          {
            id: 'format.orientation.vertical',
            kind: 'radio',
            label: 'Vertical',
            icon: 'RectangleVertical',
            value: 'portrait',
            action: 'format.pageOrientation',
            state: (c) =>
              (c.state['format.pageOrientation']?.current ?? 'portrait') ===
              'portrait',
          },
        ],
      },
      {
        id: 'format.table',
        kind: 'submenu',
        label: 'Table',
        icon: 'Table',
        visibleWhen: canEdit,
        // Ticket: active only when the cursor is inside a table.
        enabledWhen: (c) => c.state['table.deleteTable']?.isEnabled ?? false,
        children: [
          ...(
            [
              ['table.addRowAbove', 'Add row above'],
              ['table.addRowBelow', 'Add row below'],
              [
                'table.mergeCellsRow',
                'Merge cells in a row',
                'table.mergeCells',
              ],
              ['table.deleteRow', 'Remove row'],
              ['table.sepRows', '---'],
              ['table.addColumnLeft', 'Add column left'],
              ['table.addColumnRight', 'Add column right'],
              [
                'table.mergeCellsColumn',
                'Merge cells in a column',
                'table.mergeCells',
              ],
              ['table.deleteColumn', 'Remove column'],
              ['table.sepCols', '---'],
              ['table.toggleHeaderRow', 'Toggle header row'],
              ['table.toggleHeaderColumn', 'Toggle header column'],
              ['table.toggleHeaderCell', 'Toggle header cell'],
              ['table.sepHeader', '---'],
              ['table.deleteTable', 'Delete table'],
            ] as const
          ).map(([id, label, actionOverride]) =>
            label === '---'
              ? ({ id, kind: 'separator' } as const)
              : ({
                  id,
                  kind: 'action' as const,
                  label,
                  action: actionOverride ?? id,
                  enabledWhen: (c: MenuContext) =>
                    c.state[actionOverride ?? id]?.isEnabled ?? false,
                } as const),
          ),
        ],
      },
      {
        id: 'format.margins',
        kind: 'action',
        label: 'Margins',
        icon: 'Frame',
        action: 'format.margins',
        comingSoon: true,
        visibleWhen: canEdit,
      },
      { id: 'format.sep1', kind: 'separator' },
      {
        id: 'format.clearFormatting',
        kind: 'action',
        label: 'Clear formatting',
        icon: 'RemoveFormatting',
        action: 'format.clearFormatting',
        visibleWhen: canEdit,
      },
    ],
  },
  {
    id: 'tools',
    label: 'Tools',
    children: [
      {
        id: 'tools.slides',
        kind: 'action',
        label: 'Slides',
        icon: 'Presentation',
        action: 'tools.slides',
        visibleWhen: canTools,
      },
      {
        id: 'tools.wordCount',
        kind: 'action',
        label: 'Word count',
        icon: 'FileText',
        action: 'tools.wordCount',
        visibleWhen: canTools,
      },
    ],
  },
];
