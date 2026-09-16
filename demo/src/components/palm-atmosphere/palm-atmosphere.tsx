import { useTheme } from '@fileverse/ui';
import './palm-atmosphere.css';

/**
 * Palm theme atmosphere (TEC-3020): a warm sun wash plus a drifting
 * palm-frond shadow over the whole viewport. Demo-only port of the
 * ddocs.new component so the preview shows the theme as users will see it.
 */
export const PalmAtmosphere = () => {
  const { theme } = useTheme();

  if (theme !== 'theme-palm') return null;

  return (
    <div className="palm-atmosphere" aria-hidden="true">
      <div className="palm-atmosphere__sun" />
      <div className="palm-atmosphere__sun palm-atmosphere__sun--hard" />
      <div className="palm-atmosphere__shadow" />
    </div>
  );
};
