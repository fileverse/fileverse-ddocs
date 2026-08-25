import {
  createHeadlessEditorRuntime,
  type UseHeadlessEditorProps,
} from './package/hooks/use-headless-editor';

export type DdocHeadlessSyncRuntime = Pick<
  ReturnType<typeof createHeadlessEditorRuntime>,
  'getYjsConvertor' | 'mergeYjsUpdates'
>;

export const createHeadlessSyncRuntime = (
  props?: UseHeadlessEditorProps,
): DdocHeadlessSyncRuntime => {
  const { getYjsConvertor, mergeYjsUpdates } =
    createHeadlessEditorRuntime(props);

  return { getYjsConvertor, mergeYjsUpdates };
};
