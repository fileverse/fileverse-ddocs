import type { Mark } from '@tiptap/pm/model';

export type OldCaret = {
  wasEmpty: boolean;
  pos: number | null;
  deletedMarks: readonly Mark[] | null;
};
export type Pending = { marks: readonly Mark[] | null; explicit: boolean };
export type DispatchContext = {
  local: boolean;
  docChanged: boolean;
  oldCaret: OldCaret | null;
  pending: Pending | null;
};
