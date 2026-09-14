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

    // Create a MutationObserver to detect changes to the document's data-theme attribute
    // This helps catch theme changes made by ThemeToggle in the same tab
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (
          mutation.type === 'attributes' &&
          mutation.attributeName === 'data-theme' &&
          mutation.target === document.documentElement
        ) {
          // When document theme attribute changes, check localStorage again
          setTheme(getThemeFromLS());
        }
      });
    });

    // Start observing the document element for data-theme attribute changes
    observer.observe(document.documentElement, { attributes: true });

    // Fallback poll for theme changes the observers above miss. This used to
    // run at 0ms, a continuous ~4ms localStorage read for the lifetime of the
    // component; once a second is plenty for a fallback.
    const intervalId = setInterval(() => {
      const currentTheme = getThemeFromLS();
      if (currentTheme !== theme) {
        setTheme(currentTheme);
      }
    }, 1000);

    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      observer.disconnect();
      clearInterval(intervalId);
    };
  }, [theme]);

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
