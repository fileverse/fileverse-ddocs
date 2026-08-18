export const validateImageExtension = (
  file: File,
  onError?: (message: string) => void,
) => {
  if (file.type.includes('image')) {
    if (
      !['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml'].includes(
        file.type,
      )
    ) {
      if (onError && typeof onError === 'function') {
        onError('Invalid image type. Try PNG, JPEG, GIF or SVG.');
      }
      return false;
    }
  }
  return true;
};
