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
          display:none and leaves the accessibility tree with it. `dark:`
          resolves to the `.dark` class rather than the OS setting because
          the tailwind preset this package ships composes the ui preset,
          which sets darkMode: 'class'. */}
      <img src={emptyComments} alt="empty comments" className="dark:hidden" />
      <img
        src={darkEmptyComments}
        alt="empty comments"
        className="hidden dark:block"
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
