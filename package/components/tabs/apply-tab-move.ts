import { toast } from '@fileverse/ui';
import type { DocumentOutlineProps } from '../toc/types';
import type { Tab } from './utils/tab-utils';

export const applyTabMove = (
  reparent: NonNullable<DocumentOutlineProps['reparentTab']>,
  tabs: Tab[],
  expand: (id: string) => void,
  tabId: string,
  ...destination: [targetId?: string, placement?: 'before' | 'after']
) => {
  const result = reparent(tabId, ...destination);
  if (!result.ok) {
    toast({
      title:
        result.reason === 'third-level'
          ? 'Cannot create or move sub-tab inside a 3rd level sub-tab'
          : result.reason === 'branch-too-deep'
            ? 'Cannot move tab. This move would exceed the three-level tab limit'
            : 'Cannot move tab',
    });
    return false;
  }

  let parent = result.parentId;
  while (parent) {
    expand(parent);
    parent = tabs.find((tab) => tab.id === parent)?.parentId ?? null;
  }
  return true;
};
