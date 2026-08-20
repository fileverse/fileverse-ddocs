import { Plugin, PluginKey } from 'prosemirror-state';
import { IMG_UPLOAD_SETTINGS } from '../../../components/editor-utils';
import { startImageUpload } from '../../../utils/upload-images.tsx';
import { validateImageExtension } from '../../../utils/check-image-type.ts';
import { normalizeSvgFile } from '../../../utils/svg-normalize.ts';
import { IpfsImageUploadResponse } from '../../../types.ts';

export type UploadFnType = (image: File) => Promise<string>;

/**
 * This function creates a Prosemirror plugin that handles pasting and dropping of media files.
 * It accepts an upload function as a parameter which is used to upload the media files.
 * The plugin prevents the default paste and drop event, uploads the media file (if an upload function is provided),
 * creates a new node with the uploaded media file and replaces the current selection with the new node.
 * If no upload function is provided, it reads the media file as DataURL and uses this in the new node.
 * The function returns a new instance of the Plugin.
 */
export const getMediaPasteDropPlugin = (
  onError: (error: string) => void,
  ipfsImageUploadFn?: (file: File) => Promise<IpfsImageUploadResponse>,
) => {
  return new Plugin({
    key: new PluginKey('media-paste-drop'),
    props: {
      handlePaste(_view, event) {
        const items = Array.from(event.clipboardData?.items || []);
        const files = event.clipboardData?.files;
        const position = _view.state.selection.from;

        if (!position) {
          return false;
        }
        const imgConfig = ipfsImageUploadFn
          ? IMG_UPLOAD_SETTINGS.Extended
          : IMG_UPLOAD_SETTINGS.Base;
        const filesContainImage = Object.values(files ?? {}).some(
          (file) => file?.type.indexOf('image') === 0,
        );

        if (filesContainImage && ipfsImageUploadFn) {
          Object.values(files ?? {}).forEach((file) => {
            const isImage = file?.type.indexOf('image') === 0;
            if (isImage) {
              if (!validateImageExtension(file, onError)) {
                return;
              }
              if (file.size > imgConfig.maxSize) {
                onError(imgConfig.errorMsg);
                throw new Error(imgConfig.errorMsg);
              }
              startImageUpload(file, _view, position, ipfsImageUploadFn);
            }
          });

          return true;
        }

        // TODO: Check if the gif is supported and without duplicated images
        items.forEach((item) => {
          const file = item.getAsFile();

          const isImageOrVideo =
            file?.type.indexOf('image') === 0 ||
            file?.type.indexOf('video') === 0;

          if (isImageOrVideo) {
            event.preventDefault();

            if (file) {
              // Check if the image size is less than 100Kb
              if (file.size > imgConfig.maxSize) {
                onError(imgConfig.errorMsg);
                throw new Error(imgConfig.errorMsg);
              }
            }
          }
        });

        return false;
      },
      handleDrop(view, event) {
        const hasFiles =
          event.dataTransfer &&
          event.dataTransfer.files &&
          event.dataTransfer.files.length;

        if (!hasFiles) {
          return false;
        }

        const imagesAndVideos = Array.from(
          event.dataTransfer?.files ?? [],
        ).filter(({ type: t }) => /image|video/i.test(t));

        if (imagesAndVideos.length === 0) return false;

        event.preventDefault();

        const { schema } = view.state;

        const coordinates = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        });

        if (!coordinates) return false;

        imagesAndVideos.forEach(async (imageOrVideo) => {
          const reader = new FileReader();

          if (!validateImageExtension(imageOrVideo, onError)) {
            return;
          }

          if (typeof ipfsImageUploadFn === 'function') {
            try {
              startImageUpload(
                imageOrVideo,
                view,
                coordinates.pos,
                ipfsImageUploadFn,
              );
            } catch (error) {
              onError((error as Error).message || 'Error uploading media');
              throw new Error(
                (error as Error).message || 'Error uploading media',
              );
            }
          } else {
            reader.onload = (readerEvent) => {
              const node = schema.nodes.resizableMedia.create({
                src: readerEvent.target?.result,

                'media-type': imageOrVideo.type.includes('image')
                  ? 'img'
                  : 'video',
              });

              const transaction = view.state.tr.insert(coordinates.pos, node);

              view.dispatch(transaction);
            };

            reader.readAsDataURL(await normalizeSvgFile(imageOrVideo));
          }
        });

        return true;
      },
    },
  });
};
