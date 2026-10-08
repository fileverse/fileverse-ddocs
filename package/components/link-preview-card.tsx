import { useEffect, useRef, useState } from 'react';
import { useMediaQuery } from 'usehooks-ts';

export interface LinkPreviewData {
  image: string;
  title: string;
  description: string;
  favicon: string;
  link: string;
}

export const LinkPreviewCard = ({
  link,
  metadataProxyUrl,
  hoverEvent,
}: {
  link: string;
  metadataProxyUrl: string;
  hoverEvent: EventTarget;
}) => {
  const isMediaMax768px = useMediaQuery('(max-width:768px)');
  const [previewData, setPreviewData] = useState<LinkPreviewData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const metadataCache = useRef(new Map<string, LinkPreviewData>());

  const loadPreviewData = async (link: string) => {
    if (!link) return;

    if (metadataCache.current.has(link)) {
      setPreviewData(metadataCache.current.get(link)!);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(
        `${metadataProxyUrl}/${encodeURIComponent(link)}`,
      );
      const { metadata } = await response.json();

      const newPreviewData: LinkPreviewData = {
        title: metadata.title,
        description: metadata.description,
        image: metadata.image,
        favicon: metadata.favicon,
        link: link,
      };

      metadataCache.current.set(link, newPreviewData);
      setPreviewData(newPreviewData);
    } catch (error) {
      console.error('Error fetching link preview:', error);
      setPreviewData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (link) {
      loadPreviewData(link);
    }
  }, [link]);

  useEffect(() => {
    const handleHoverChange = (event: CustomEvent) => {
      if (event.detail) {
        if (metadataCache.current.has(link)) {
          setPreviewData(metadataCache.current.get(link)!);
          setLoading(false);
        } else {
          loadPreviewData(link);
        }
      } else {
        setLoading(true);
        setPreviewData(null);
      }
    };

    hoverEvent.addEventListener(
      'hoverStateChange',
      handleHoverChange as EventListener,
    );

    return () => {
      hoverEvent.removeEventListener(
        'hoverStateChange',
        handleHoverChange as EventListener,
      );
    };
  }, [hoverEvent, link]);

  if (isMediaMax768px) return <></>;

  return (
    <div className="w-[250px] border color-border-default shadow-elevation-3 rounded p-3 flex flex-col gap-2 justify-center hover-link-popup color-bg-default">
      {loading ? (
        <p className="text-helper-text-sm color-text-secondary">
          Loading preview...
        </p>
      ) : previewData ? (
        <>
          {previewData.image && (
            <img
              src={previewData.image}
              className="w-[225px] h-[125px] object-contain rounded"
              alt="Preview"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          )}
          <div className="flex flex-col gap-2">
            {(previewData.title || previewData.description) && (
              <div className="flex flex-col gap-[2px]">
                {previewData.title && (
                  <p className="text-heading-xsm w-full truncate color-text-default select-text">
                    {previewData.title}
                  </p>
                )}
                {previewData.description && (
                  <p className="text-helper-text-sm color-text-secondary w-full truncate select-text">
                    {previewData.description}
                  </p>
                )}
              </div>
            )}
            <div className="flex gap-2">
              {previewData.favicon && (
                <img
                  src={previewData.favicon}
                  className="w-[18px] aspect-square rounded"
                  alt="Favicon"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              )}
              {previewData.link && (
                <a
                  href={previewData.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-helper-text-sm color-text-link w-full truncate hover:underline hover:cursor-pointer"
                >
                  {previewData.link}
                </a>
              )}
            </div>
          </div>
        </>
      ) : (
        <p className="text-helper-text-sm color-text-secondary">
          No preview available
        </p>
      )}
    </div>
  );
};
