import type {
  MenuBarTree,
  MenuContext,
  MenuLabel,
  MenuNode,
  ProjectedMenuBar,
  ProjectedNode,
} from './menu-types';

const resolveLabel = (label: MenuLabel, ctx: MenuContext): string =>
  typeof label === 'function' ? label(ctx) : label;

const projectNode = (node: MenuNode, ctx: MenuContext): ProjectedNode | null => {
  if (node.visibleWhen && !node.visibleWhen(ctx)) return null;

  switch (node.kind) {
    case 'separator':
      return { kind: 'separator', id: node.id };

    case 'submenu':
    case 'group': {
      const children = stripSeparators(
        node.children
          .map((c) => projectNode(c, ctx))
          .filter((c): c is ProjectedNode => c !== null),
      );
      // A container whose children all projected away disappears too.
      if (children.length === 0) return null;
      return {
        kind: node.kind,
        id: node.id,
        label: resolveLabel(node.label, ctx),
        icon: node.icon && resolveLabel(node.icon, ctx),
        disabled:
          node.kind === 'submenu' && node.enabledWhen
            ? !node.enabledWhen(ctx)
            : false,
        children,
      };
    }

    case 'checkbox':
      return {
        kind: 'checkbox',
        id: node.id,
        label: resolveLabel(node.label, ctx),
        icon: node.icon && resolveLabel(node.icon, ctx),
        action: node.action,
        shortcut: node.shortcut,
        disabled: node.enabledWhen ? !node.enabledWhen(ctx) : false,
        checked: node.state(ctx),
      };

    case 'radio':
      return {
        kind: 'radio',
        id: node.id,
        label: resolveLabel(node.label, ctx),
        icon: node.icon && resolveLabel(node.icon, ctx),
        action: node.action,
        value: node.value,
        description: node.description,
        disabled: node.enabledWhen ? !node.enabledWhen(ctx) : false,
        checked: node.state(ctx),
      };

    case 'action':
      return {
        kind: 'action',
        id: node.id,
        label: resolveLabel(node.label, ctx),
        icon: node.icon && resolveLabel(node.icon, ctx),
        action: node.action,
        shortcut: node.shortcut,
        comingSoon: node.comingSoon,
        requiresAuth: node.requiresAuth?.(ctx),
        disabled:
          node.comingSoon === true ||
          (node.enabledWhen ? !node.enabledWhen(ctx) : false),
      };
  }
};

/** Remove leading/trailing separators and collapse consecutive ones. */
const stripSeparators = (nodes: ProjectedNode[]): ProjectedNode[] => {
  const out: ProjectedNode[] = [];
  for (const n of nodes) {
    if (
      n.kind === 'separator' &&
      (out.length === 0 || out[out.length - 1].kind === 'separator')
    )
      continue;
    out.push(n);
  }
  while (out.length && out[out.length - 1].kind === 'separator') out.pop();
  return out;
};

export const projectMenu = (
  tree: MenuBarTree,
  ctx: MenuContext,
): ProjectedMenuBar =>
  tree
    .map((menu) => ({
      ...menu,
      children: stripSeparators(
        menu.children
          .map((n) => projectNode(n, ctx))
          .filter((n): n is ProjectedNode => n !== null),
      ),
    }))
    .filter((menu) => menu.children.length > 0);
