// demo/src/components/second-level-nav/menu-renderer.tsx
import { useRef } from 'react';
import {
  Menubar,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarItem,
  MenubarCheckboxItem,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarLabel,
  MenubarSeparator,
  MenubarSub,
  MenubarSubTrigger,
  MenubarSubContent,
  LucideIcon,
} from '@fileverse/ui';
import type {
  ProjectedAction,
  ProjectedCheckbox,
  ProjectedMenuBar,
  ProjectedNode,
  ProjectedRadio,
} from './menu-types';
import type { ActionRegistry } from './action-registry';

type Props = {
  projected: ProjectedMenuBar;
  registry: ActionRegistry;
  /** Fired when a requiresAuth item is clicked while signed out. */
  onRequiresAuth?: () => void;
};

export const MenuBarRenderer = ({
  projected,
  registry,
  onRequiresAuth,
}: Props) => {
  // True while a menu close was caused by dispatching an action. Editor
  // commands chain .focus() onto the new node; Radix's close-auto-focus
  // would steal it back to the menu trigger — suppress that for dispatches
  // only, so Escape/outside-click still return focus to the trigger (a11y).
  const dispatchedRef = useRef(false);
  const onCloseAutoFocus = (e: Event) => {
    if (dispatchedRef.current) {
      dispatchedRef.current = false;
      e.preventDefault();
    }
  };

  const dispatch = (
    node: ProjectedAction | ProjectedCheckbox | ProjectedRadio,
  ) => {
    if (node.kind === 'action' && node.requiresAuth && onRequiresAuth) {
      return onRequiresAuth();
    }
    dispatchedRef.current = true;
    registry[node.action]?.run(node.kind === 'radio' ? node.value : undefined);
  };

  const itemIcon = (icon?: string) =>
    icon && <LucideIcon name={icon} size="sm" className="mr-3" />;

  const renderNode = (node: ProjectedNode): JSX.Element => {
    switch (node.kind) {
      case 'separator':
        return <MenubarSeparator key={node.id} />;
      case 'submenu':
        return (
          <MenubarSub key={node.id}>
            <MenubarSubTrigger disabled={node.disabled}>
              {itemIcon(node.icon)}
              {node.label}
            </MenubarSubTrigger>
            <MenubarSubContent className="min-w-60">
              {renderChildren(node.children)}
            </MenubarSubContent>
          </MenubarSub>
        );
      case 'group':
        // Labeled inline section: header + children in the same panel.
        return (
          <div key={node.id} className="[&:has([data-type=label])+*]:mt-1">
            {node.label && (
              <MenubarLabel data-type="label">{node.label}</MenubarLabel>
            )}
            {renderChildren(node.children)}
          </div>
        );
      case 'checkbox':
        return (
          <MenubarCheckboxItem
            key={node.id}
            checked={node.checked}
            disabled={node.disabled}
            onSelect={(e) => {
              e.preventDefault();
              dispatch(node);
            }}
          >
            <div className="flex items-center">
              {itemIcon(node.icon)}
              {node.label}
            </div>
          </MenubarCheckboxItem>
        );
      // radio items are grouped by renderChildren below
      case 'radio':
      case 'action':
        return (
          <MenubarItem
            key={node.id}
            disabled={node.disabled}
            onSelect={() => dispatch(node)}
          >
            {itemIcon(node.icon)}
            {node.label}
            {node.kind === 'action' && node.comingSoon && (
              <span className="ml-auto rounded px-1.5 text-helper-text-sm color-text-disabled border color-border-default">
                Soon
              </span>
            )}
          </MenubarItem>
        );
    }
  };

  /** Wrap consecutive radio siblings in a MenubarRadioGroup. */
  const renderChildren = (nodes: ProjectedNode[]): JSX.Element[] => {
    const out: JSX.Element[] = [];
    let radioRun: ProjectedRadio[] = [];
    const flushRadios = () => {
      if (!radioRun.length) return;
      const group = radioRun;
      radioRun = [];
      const selected = group.find((r) => r.checked)?.value;
      out.push(
        <MenubarRadioGroup key={`${group[0].id}-group`} value={selected}>
          {group.map((r) => (
            <MenubarRadioItem
              key={r.id}
              value={r.value}
              disabled={r.disabled}
              onSelect={(e) => {
                e.preventDefault();
                dispatch(r);
              }}
            >
              {r.description ? (
                <div className="flex items-center gap-3 py-0.5 pr-2">
                  {r.icon && <LucideIcon name={r.icon} size="md" />}
                  <div className="flex flex-col gap-1 max-w-[160px]">
                    <span className={r.checked ? 'text-body-sm-bold' : ''}>
                      {r.label}
                    </span>
                    <span className="text-helper-text-sm color-text-secondary">
                      {r.description}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex items-center">
                  {itemIcon(r.icon)}
                  {r.label}
                </div>
              )}
            </MenubarRadioItem>
          ))}
        </MenubarRadioGroup>,
      );
    };
    for (const n of nodes) {
      if (n.kind === 'radio') radioRun.push(n);
      else {
        flushRadios();
        out.push(renderNode(n));
      }
    }
    flushRadios();
    return out;
  };

  return (
    // hidden lg:flex — desktop-only constraint (demo addition; backport to consumer plan)
    <Menubar aria-label="Document menu" className="hidden lg:flex">
      {projected.map((menu) => (
        <MenubarMenu key={menu.id}>
          <MenubarTrigger
            data-testid={`slnav-${menu.id}`}
            className="text-body-sm-bold color-text-default"
          >
            {menu.label}
          </MenubarTrigger>
          <MenubarContent
            className="min-w-60"
            onCloseAutoFocus={onCloseAutoFocus}
          >
            {renderChildren(menu.children)}
          </MenubarContent>
        </MenubarMenu>
      ))}
    </Menubar>
  );
};
