import platform from 'platform';
import { useEditorMediaQuery } from '../hooks/use-editor-media-query';
import type { EditorWidthStore } from './editor-width-store';

const checkOs = () => platform.os?.family;

export const useResponsive = (store?: EditorWidthStore) => {
  const isBelow1280px = useEditorMediaQuery('(max-width: 1280px)', store);
  const isBelow1024px = useEditorMediaQuery('(max-width: 1023px)', store);
  const isMobileScreen = useEditorMediaQuery('(max-width: 768px)', store);
  const isMobile = useEditorMediaQuery('(max-width: 480px)', store);
  const isIOS = checkOs() === 'iOS';
  const isWindows = checkOs() === 'Windows';

  const isNativeMobile =
    checkOs() === 'iOS' ||
    checkOs() === 'Android' ||
    checkOs() === 'Windows Phone' ||
    isMobileScreen;

  return {
    isBelow1024px,
    isBelow1280px,
    isMobileScreen,
    isNativeMobile,
    isIOS,
    isMobile,
    isWindows,
  };
};
