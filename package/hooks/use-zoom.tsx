/* eslint-disable react-refresh/only-export-components */
import { createContext, ReactNode, useContext, useMemo } from 'react';
import { stepZoomLevel, ZoomLevel } from '../utils/zoom';

export interface ZoomContextValue {
  zoomLevel: ZoomLevel;
  scale: number;
  fitScale: number;
  setZoomLevel: (level: ZoomLevel) => void;
  stepZoom: (direction: 1 | -1) => void;
}

const noop = () => {};

const ZoomContext = createContext<ZoomContextValue>({
  zoomLevel: '1',
  scale: 1,
  fitScale: 1,
  setZoomLevel: noop,
  stepZoom: noop,
});

export const ZoomProvider = ({
  zoomLevel,
  scale,
  fitScale,
  setZoomLevel,
  children,
}: Omit<ZoomContextValue, 'stepZoom'> & { children: ReactNode }) => {
  const value = useMemo<ZoomContextValue>(
    () => ({
      zoomLevel,
      scale,
      fitScale,
      setZoomLevel,
      stepZoom: (direction) => {
        const next = stepZoomLevel(zoomLevel, direction, fitScale);
        if (next !== zoomLevel) setZoomLevel(next);
      },
    }),
    [zoomLevel, scale, fitScale, setZoomLevel],
  );
  return <ZoomContext.Provider value={value}>{children}</ZoomContext.Provider>;
};

export const useZoom = () => useContext(ZoomContext);
