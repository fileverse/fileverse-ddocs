import { describe, it, expect } from 'vitest';
import { demoMenuTree } from './menu-tree';
import { projectMenu } from './project-menu';
import { deriveCapabilities } from './capabilities';
import type { ProjectedNode } from './menu-types';

const ctxFor = (
  role: 'owner' | 'viewer' | 'unauth' | 'collaborator',
  opts: { isCommentUsable?: boolean } = {},
) => ({
  caps: deriveCapabilities({
    isPreviewMode: role === 'viewer' || role === 'unauth',
    isCollaboratorMode: role === 'collaborator',
    isDDocOwner: role === 'owner',
    isAuthenticated: role !== 'unauth',
    isOnline: true,
    hasSelection: false,
    permissionAllowsComment: true,
    isRtcEnabled: false,
    isCommentUsable: opts.isCommentUsable ?? true,
  }),
  state: {},
});

/** Find a node by id anywhere in a projected children tree. */
const findNode = (
  nodes: ProjectedNode[],
  id: string,
): ProjectedNode | undefined => {
  for (const n of nodes) {
    if (n.id === id) return n;
    if ('children' in n) {
      const found = findNode(n.children, id);
      if (found) return found;
    }
  }
  return undefined;
};

describe('demoMenuTree', () => {
  it('owner sees File/Edit/View/Insert/Format/Tools', () => {
    expect(projectMenu(demoMenuTree, ctxFor('owner')).map((m) => m.label)).toEqual(
      ['File', 'Edit', 'View', 'Insert', 'Format', 'Tools'],
    );
  });

  it('viewer sees only File/View (Help & Themes are consumer-only, dropped)', () => {
    expect(projectMenu(demoMenuTree, ctxFor('viewer')).map((m) => m.label)).toEqual(
      ['File', 'View'],
    );
  });

  it('collaborator sees File/Edit/View/Insert/Format (no Tools)', () => {
    expect(
      projectMenu(demoMenuTree, ctxFor('collaborator')).map((m) => m.label),
    ).toEqual(['File', 'Edit', 'View', 'Insert', 'Format']);
  });

  it('viewer File contains New dDoc + Import/Export + Print', () => {
    const file = projectMenu(demoMenuTree, ctxFor('viewer')).find(
      (m) => m.id === 'file',
    )!;
    expect(
      file.children.filter((c) => c.kind !== 'separator').map((c) => c.id),
    ).toEqual(['file.new', 'file.importexport', 'file.print']);
  });

  it('viewer File ▸ Import/Export projects as "Export" with only "Export as .md"', () => {
    const file = projectMenu(demoMenuTree, ctxFor('viewer')).find(
      (m) => m.id === 'file',
    )!;
    const submenu = file.children.find((c) => c.id === 'file.importexport');
    expect(submenu).toMatchObject({ kind: 'submenu', label: 'Export' });
    if (submenu?.kind !== 'submenu') throw new Error('expected submenu');
    // Import group is absent entirely.
    expect(submenu.children.find((c) => c.id === 'file.import')).toBeUndefined();
    // Export group's own label projects as '' (submenu already says "Export").
    const exportGroup = submenu.children.find(
      (c) => c.id === 'file.exportGroup',
    );
    expect(exportGroup).toMatchObject({ kind: 'group', label: '' });
    if (exportGroup?.kind !== 'group') throw new Error('expected group');
    expect(exportGroup.children).toHaveLength(1);
    expect(exportGroup.children[0]).toMatchObject({ label: 'Export as .md' });
  });

  it('collaborator File ▸ Import/Export projects as "Export" with 4 export items and no Import group', () => {
    const file = projectMenu(demoMenuTree, ctxFor('collaborator')).find(
      (m) => m.id === 'file',
    )!;
    const submenu = file.children.find((c) => c.id === 'file.importexport');
    expect(submenu).toMatchObject({ kind: 'submenu', label: 'Export' });
    if (submenu?.kind !== 'submenu') throw new Error('expected submenu');
    expect(findNode(submenu.children, 'file.import')).toBeUndefined();
    const exportGroup = submenu.children.find(
      (c) => c.id === 'file.exportGroup',
    );
    expect(exportGroup?.kind).toBe('group');
    if (exportGroup?.kind !== 'group') throw new Error('expected group');
    expect(exportGroup.children).toHaveLength(4);
  });

  it('owner File ▸ Import/Export submenu is labeled "Import/Export" and contains the Import group', () => {
    const file = projectMenu(demoMenuTree, ctxFor('owner')).find(
      (m) => m.id === 'file',
    )!;
    const submenu = file.children.find((c) => c.id === 'file.importexport');
    expect(submenu).toMatchObject({ kind: 'submenu', label: 'Import / Export' });
    if (submenu?.kind !== 'submenu') throw new Error('expected submenu');
    expect(findNode(submenu.children, 'file.import')).toBeDefined();
  });

  it('collaborator View does not contain Focus mode; owner View does', () => {
    const collaboratorView = projectMenu(demoMenuTree, ctxFor('collaborator')).find(
      (m) => m.id === 'view',
    )!;
    expect(findNode(collaboratorView.children, 'view.focusMode')).toBeUndefined();

    const ownerView = projectMenu(demoMenuTree, ctxFor('owner')).find(
      (m) => m.id === 'view',
    )!;
    expect(findNode(ownerView.children, 'view.focusMode')).toBeDefined();
  });

  it('Format contains format.columns; Insert contains no insert.columns* item', () => {
    const projected = projectMenu(demoMenuTree, ctxFor('owner'));
    const format = projected.find((m) => m.id === 'format')!;
    expect(findNode(format.children, 'format.columns')).toBeDefined();

    const insert = projected.find((m) => m.id === 'insert')!;
    const hasColumns = (nodes: ProjectedNode[]): boolean =>
      nodes.some(
        (n) =>
          n.id.startsWith('insert.columns') ||
          ('children' in n && hasColumns(n.children)),
      );
    expect(hasColumns(insert.children)).toBe(false);
  });

  it('View ▸ Zoom children labels are Fit/50%/75%/100%/150%/200%', () => {
    const view = projectMenu(demoMenuTree, ctxFor('owner')).find(
      (m) => m.id === 'view',
    )!;
    const zoom = view.children.find((c) => c.id === 'view.zoom');
    expect(zoom?.kind).toBe('submenu');
    if (zoom?.kind !== 'submenu') throw new Error('expected submenu');
    expect(zoom.children.map((c) => c.label)).toEqual([
      'Fit',
      '50%',
      '75%',
      '100%',
      '150%',
      '200%',
    ]);
  });

  it('Format ▸ Line height ends with a Custom spacing action', () => {
    const format = projectMenu(demoMenuTree, ctxFor('owner')).find(
      (m) => m.id === 'format',
    )!;
    const lineHeight = findNode(format.children, 'format.lineHeight');
    if (lineHeight?.kind !== 'submenu') throw new Error('expected submenu');
    // Mirrors the toolbar dropdown and the bubble menu: presets, a divider,
    // then the dialog opener.
    expect(lineHeight.children.at(-2)).toMatchObject({ kind: 'separator' });
    expect(lineHeight.children.at(-1)).toMatchObject({
      kind: 'action',
      label: 'Custom spacing',
      action: 'format.customSpacing',
      disabled: false,
    });
  });

  // This tree and the consumer's must not drift in order or wording — the
  // demo is the in-repo mirror of it, and it is the only one of the two that
  // imports spacingToggleLabel rather than authoring the strings.
  it('Format ▸ Line height carries the spacing toggles, in toolbar order', () => {
    const format = projectMenu(demoMenuTree, ctxFor('owner')).find(
      (m) => m.id === 'format',
    )!;
    const lineHeight = findNode(format.children, 'format.lineHeight');
    if (lineHeight?.kind !== 'submenu') throw new Error('expected submenu');

    expect(lineHeight.children.map((c) => c.id)).toEqual([
      'format.lineHeight.1',
      'format.lineHeight.1_15',
      'format.lineHeight.1_5',
      'format.lineHeight.2',
      'format.lineHeight.2_5',
      'format.lineHeight.3',
      'format.lineHeight.sep',
      'format.lineHeight.spaceBefore',
      'format.lineHeight.spaceAfter',
      'format.lineHeight.sep2',
      'format.lineHeight.custom',
    ]);
  });

  it('Format ▸ Line height spacing labels follow the registry reading', () => {
    const labelsFor = (state: Record<string, { current?: string | null }>) => {
      const format = projectMenu(demoMenuTree, {
        ...ctxFor('owner'),
        state,
      }).find((m) => m.id === 'format')!;
      const lineHeight = findNode(format.children, 'format.lineHeight');
      if (lineHeight?.kind !== 'submenu') throw new Error('expected submenu');
      return lineHeight.children
        .filter((c) => c.id.startsWith('format.lineHeight.space'))
        .map((c) => ('label' in c ? c.label : ''));
    };

    expect(
      labelsFor({
        'format.spaceBefore': { current: 'add' },
        'format.spaceAfter': { current: 'add' },
      }),
    ).toEqual(['Add space before paragraph', 'Add space after paragraph']);

    expect(
      labelsFor({
        'format.spaceBefore': { current: 'remove' },
        'format.spaceAfter': { current: 'add' },
      }),
    ).toEqual(['Remove space before paragraph', 'Add space after paragraph']);

    // No reading yet (null editor → disabled Proxy): fail closed to Remove,
    // matching the browser default where editor.css already supplies a gap.
    expect(labelsFor({})).toEqual([
      'Remove space before paragraph',
      'Remove space after paragraph',
    ]);
  });

  it('margins is comingSoon-disabled for owner', () => {
    const format = projectMenu(demoMenuTree, ctxFor('owner')).find(
      (m) => m.id === 'format',
    )!;
    expect(format.children.find((c) => c.id === 'format.margins')!.disabled).toBe(
      true,
    );
  });

  it('owner + isCommentUsable:false: View ▸ Comments submenu is visible but disabled (TEC-1458 bugfix)', () => {
    const view = projectMenu(
      demoMenuTree,
      ctxFor('owner', { isCommentUsable: false }),
    ).find((m) => m.id === 'view')!;
    const comments = findNode(view.children, 'view.comments')!;
    expect(comments, 'view.comments should be visible for owner').toBeDefined();
    expect(
      'disabled' in comments && comments.disabled,
      'view.comments should be disabled when isCommentUsable is false',
    ).toBe(true);
  });

  it('owner + isCommentUsable:true: View ▸ Comments submenu is enabled', () => {
    const view = projectMenu(
      demoMenuTree,
      ctxFor('owner', { isCommentUsable: true }),
    ).find((m) => m.id === 'view')!;
    const comments = findNode(view.children, 'view.comments')!;
    expect(comments).toBeDefined();
    expect('disabled' in comments && comments.disabled).toBe(false);
  });

  it('unauth viewer: View ▸ Comments ▸ Show all comments requiresAuth', () => {
    const view = projectMenu(demoMenuTree, ctxFor('unauth')).find(
      (m) => m.id === 'view',
    )!;
    const showAll = findNode(view.children, 'view.comments.showAll')!;
    expect(showAll).toBeDefined();
    expect(showAll.kind === 'action' && showAll.requiresAuth).toBe(true);
  });

  it('authenticated owner: View ▸ Comments ▸ Show all comments does not requireAuth', () => {
    const view = projectMenu(demoMenuTree, ctxFor('owner')).find(
      (m) => m.id === 'view',
    )!;
    const showAll = findNode(view.children, 'view.comments.showAll')!;
    expect(showAll).toBeDefined();
    expect(showAll.kind === 'action' && showAll.requiresAuth).toBe(false);
  });

  it('insert.comment disabled state mirrors the command isEnabled', () => {
    const commentNode = (isEnabled: boolean | undefined) => {
      const ctx = ctxFor('owner');
      if (isEnabled !== undefined) {
        ctx.state = { 'insert.comment': { isEnabled } };
      }
      const insert = projectMenu(demoMenuTree, ctx).find(
        (m) => m.id === 'insert',
      )!;
      return findNode(insert.children, 'insert.comment')!;
    };
    // No state entry (e.g. store not wired) → disabled, never silently enabled.
    expect(commentNode(undefined).disabled).toBe(true);
    expect(commentNode(false).disabled).toBe(true);
    expect(commentNode(true).disabled).toBe(false);
  });

  it('every node id is unique', () => {
    const ids: string[] = [];
    const walk = (nodes: { id: string; children?: unknown[] }[]) =>
      nodes.forEach((n) => {
        ids.push(n.id);
        if (n.children) walk(n.children as never);
      });
    walk(demoMenuTree as never);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
