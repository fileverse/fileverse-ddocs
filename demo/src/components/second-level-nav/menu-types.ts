// menu-types.ts — ENGINE types: no Tiptap, no app imports (dsheets D-C).
import type { DocumentCapabilities } from './capabilities';

export type MenuContext = {
  caps: DocumentCapabilities;
  /** Reactive value bag: actionId → { isActive?, isEnabled?, current? }.
   *  Populated at wiring time from the merged registry. */
  state: Record<
    string,
    { isActive?: boolean; isEnabled?: boolean; current?: string | null }
  >;
};

export type MenuPredicate = (ctx: MenuContext) => boolean;
export type MenuLabel = string | ((ctx: MenuContext) => string);

/** Fields every visible (non-separator) node carries. */
type BaseNode = {
  id: string;
  label: MenuLabel;
  /** Icon name; a function resolves it from ctx like a label. */
  icon?: MenuLabel;
  visibleWhen?: MenuPredicate;
};

export type ActionNode = BaseNode & {
  kind: 'action';
  /** ActionId — key into the merged registry. */
  action: string;
  shortcut?: string;
  comingSoon?: boolean;
  /** Renders normally; click routes to sign-in when this predicate is true
   *  (mirrors visibleWhen/enabledWhen — evaluated over MenuContext, not a
   *  static flag, so it can react to auth state). */
  requiresAuth?: MenuPredicate;
  enabledWhen?: MenuPredicate;
};

export type CheckboxNode = BaseNode & {
  kind: 'checkbox';
  action: string;
  /** Checked state, derived from ctx (usually ctx.state[action].isActive). */
  state: MenuPredicate;
  shortcut?: string;
  enabledWhen?: MenuPredicate;
};

export type RadioNode = BaseNode & {
  kind: 'radio';
  action: string;
  /** Passed to run(value); consecutive radio siblings form one group. */
  value: string;
  /** Selected state, derived from ctx (usually ctx.state[action].current). */
  state: MenuPredicate;
  /** Helper line under the label. */
  description?: string;
  enabledWhen?: MenuPredicate;
};

export type SubmenuNode = BaseNode & {
  kind: 'submenu';
  children: MenuNode[];
  enabledWhen?: MenuPredicate;
};

/** Labeled inline section: a MenubarLabel header + children in the same panel. */
export type GroupNode = BaseNode & {
  kind: 'group';
  children: MenuNode[];
};

export type SeparatorNode = {
  kind: 'separator';
  id: string;
  visibleWhen?: MenuPredicate;
};

export type MenuNode =
  | ActionNode
  | CheckboxNode
  | RadioNode
  | SubmenuNode
  | GroupNode
  | SeparatorNode;

export type MenuBarTree = { id: string; label: string; children: MenuNode[] }[];

// Projected output (renderer input) — plain data, fully resolved:
type ProjectedBase = {
  id: string;
  label: string;
  icon?: string;
  disabled: boolean;
};

export type ProjectedAction = ProjectedBase & {
  kind: 'action';
  action: string;
  shortcut?: string;
  comingSoon?: boolean;
  requiresAuth?: boolean;
};

export type ProjectedCheckbox = ProjectedBase & {
  kind: 'checkbox';
  action: string;
  checked: boolean;
  shortcut?: string;
};

export type ProjectedRadio = ProjectedBase & {
  kind: 'radio';
  action: string;
  value: string;
  checked: boolean;
  description?: string;
};

export type ProjectedSubmenu = ProjectedBase & {
  kind: 'submenu';
  children: ProjectedNode[];
};

export type ProjectedGroup = ProjectedBase & {
  kind: 'group';
  children: ProjectedNode[];
};

export type ProjectedSeparator = { kind: 'separator'; id: string };

export type ProjectedNode =
  | ProjectedAction
  | ProjectedCheckbox
  | ProjectedRadio
  | ProjectedSubmenu
  | ProjectedGroup
  | ProjectedSeparator;

export type ProjectedMenuBar = {
  id: string;
  label: string;
  children: ProjectedNode[];
}[];
