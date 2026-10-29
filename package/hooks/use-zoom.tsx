/* eslint-disable react-refresh/only-export-components */
import { createContext, ReactNode, useContext, useMemo } from 'react';
import { ZoomLevel } from '../utils/zoom';

export interface ZoomContextValue {
  zoomLevel: ZoomLevel;
  scale: number;
  fitScale: number;
  setZoomLevel: (level: ZoomLevel) => void;
}

const noop = () => {};

const ZoomContext = createContext<ZoomContextValue>({
  zoomLevel: '1',
  scale: 1,
  fitScale: 1,
  setZoomLevel: noop,
});

export const ZoomProvider = ({
  zoomLevel,
  scale,
  fitScale,
  setZoomLevel,
  children,
}: ZoomContextValue & { children: ReactNode }) => {
  const value = useMemo<ZoomContextValue>(
    () => ({
      zoomLevel,
      scale,
      fitScale,
      setZoomLevel,
    }),
    [zoomLevel, scale, fitScale, setZoomLevel],
  );
  return <ZoomContext.Provider value={value}>{children}</ZoomContext.Provider>;
};

export const useZoom = () => useContext(ZoomContext);
