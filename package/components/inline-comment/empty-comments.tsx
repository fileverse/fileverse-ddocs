import emptyComments from '../../assets/empty-comment.svg';
import darkEmptyComments from '../../assets/dark-empty-comment.svg';

const EmptyComments = ({
  commentType,
  handleReset,
}: {
  commentType: string;
  handleReset?: () => void;
}) => {
  return (
    <div className="flex flex-col items-center justify-center h-full color-text-default">
      {/* Two artworks rather than one recoloured asset: the dark version is
          a different drawing, not the same paths in other colours. CSS picks
          between them, so there is no theme state in JS; the hidden one is
          display:none and leaves the accessibility tree with it.
          `[.dark_&]` rather than `dark:` because that variant follows the
          CONSUMER's tailwind darkMode setting (the demo leaves it at the
          `media` default, so `dark:` there would follow the OS instead of
          the editor theme); this compiles to a plain `.dark` descendant
          selector either way. */}
      <img
        src={emptyComments}
        alt="empty comments"
        className="[.dark_&]:hidden"
      />
      <img
        src={darkEmptyComments}
        alt="empty comments"
        className="hidden [.dark_&]:block"
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
