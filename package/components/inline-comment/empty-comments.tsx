import emptyComments from '../../assets/empty-comment.svg';
import darkEmptyComments from '../../assets/dark-empty-comment.svg';
import { useEffect, useState } from 'react';
import { ThemeKey } from '../../types';

const EmptyComments = ({
  commentType,
  handleReset,
}: {
  commentType: string;
  handleReset?: () => void;
}) => {
  const [theme, setTheme] = useState('light');

  // Function to get theme from localStorage
  const getThemeFromLS = (): ThemeKey => {
    const storedTheme = localStorage.getItem('theme');
    return storedTheme ? (storedTheme as ThemeKey) : 'light';
  };

  useEffect(() => {
    // Initial theme setup from localStorage
    setTheme(getThemeFromLS());

    // Listen for storage events to update theme when it changes in other tabs/components
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === 'theme' && event.newValue) {
        setTheme(event.newValue as ThemeKey);
      }
    };

    // Same-tab changes: consumers apply the theme to <html> as a class
    // (ddocs.new's ThemeProvider, the ui ThemeProvider) or a data-theme
    // attribute, and write localStorage in the same effect, so a change to
    // either attribute is the signal to re-read localStorage. This replaces
    // a setInterval poll that ran for the lifetime of the component.
    const observer = new MutationObserver((mutations) => {
      const themeAttributeChanged = mutations.some(
        (mutation) =>
          mutation.type === 'attributes' &&
          mutation.target === document.documentElement &&
          (mutation.attributeName === 'class' ||
            mutation.attributeName === 'data-theme'),
      );
      if (themeAttributeChanged) {
        setTheme(getThemeFromLS());
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    });

    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      observer.disconnect();
    };
  }, []);

  return (
    <div className="flex flex-col items-center justify-center h-full color-text-default">
      <img
        src={theme === 'dark' ? darkEmptyComments : emptyComments}
        alt="empty comments"
      />
      <div className="text-heading-xsm mt-4">No comments yet</div>
      {commentType === 'all' ? (
        <p className="text-body-sm color-text-secondary">
          Add a comment on the text or in this window
        </p>
      ) : (
        <p className="text-body-sm color-text-secondary">
          Try to{' '}
          <span
            onClick={() => {
              handleReset?.();
            }}
            className="color-text-link cursor-pointer"
          >
            Reset
          </span>{' '}
          the filter parameters
        </p>
      )}
    </div>
  );
};

export { EmptyComments };
