import { useState, useEffect, forwardRef } from 'react';
import { Skeleton } from '@fileverse/ui';
import { IpfsImageFetchPayload } from '../types.ts';
import {
  normalizeSvgDimensions,
  readFileText,
} from '../utils/svg-normalize.ts';

/**
 * Already-stored SVGs can't be rewritten (the encrypted bytes are pinned),
 * so dimensionless ones — which Firefox renders at 0 height — are pinned
 * again at render time: swap the decrypted blob for one whose root carries
 * concrete width/height. Fail-open: any error keeps the original URL.
 */
const normalizeSvgObjectUrl = async (
  file: File,
  originalUrl: string,
): Promise<string> => {
  try {
    const normalized = normalizeSvgDimensions(await readFileText(file));
    if (!normalized) return originalUrl;
    const url = URL.createObjectURL(
      new Blob([normalized], { type: 'image/svg+xml' }),
    );
    URL.revokeObjectURL(originalUrl);
    return url;
  } catch {
    return originalUrl;
  }
};

// One retry after a failed load (the host retries each load too), jittered so
// a gateway hiccup does not retry every image in the doc at the same moment.
const RETRY_DELAY_MS = 4000;
// A wedged decrypt never settles: show the error after this long, but still
// show the image if that load finishes later.
const LOAD_TIMEOUT_MS = 60000;

type Props = {
  encryptionKey: string;
  url: string;
  nonce: string;
  alt?: string;
  width?: string;
  height?: string;
  className?: string;
  caption?: string;
  ipfsImageFetchFn: (
    _data: IpfsImageFetchPayload,
  ) => Promise<{ url: string; file: File }>;
  ipfsHash: string;
  mimeType: string;
  authTag: string;
};

export const SecureImageV2 = forwardRef<HTMLImageElement, Props>(
  (
    {
      encryptionKey,
      url,
      nonce,
      alt,
      className,
      width,
      height,
      ipfsImageFetchFn,
      ipfsHash,
      mimeType,
      authTag,
    },
    ref,
  ) => {
    const [source, setSource] = useState<string>('');
    const [failed, setFailed] = useState(false);
    const [retryKey, setRetryKey] = useState(0);

    useEffect(() => {
      const imageReadyForDecryption = encryptionKey && url && nonce && authTag;
      let isMounted = true;
      let settled = false;
      let currentObjectUrl: string | null = null;
      const timers: ReturnType<typeof setTimeout>[] = [];
      setSource('');
      setFailed(false);

      // The first load to succeed wins, even one that outlived its timeout.
      const show = async (result: { url: string; file: File }) => {
        if (!isMounted || settled) {
          URL.revokeObjectURL(result.url);
          return;
        }
        settled = true;
        const objectUrl =
          result.file?.type === 'image/svg+xml' || mimeType === 'image/svg+xml'
            ? await normalizeSvgObjectUrl(result.file, result.url)
            : result.url;
        if (!isMounted) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        currentObjectUrl = objectUrl;
        setFailed(false);
        setSource(objectUrl);
      };

      const load = (retriesLeft: number) => {
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          if (isMounted && !settled) setFailed(true);
        }, LOAD_TIMEOUT_MS);
        timers.push(timer);
        ipfsImageFetchFn({
          encryptionKey,
          ipfsUrl: url,
          nonce,
          ipfsHash,
          mimeType,
          authTag,
        }).then(
          (result) => {
            clearTimeout(timer);
            void show(result);
          },
          (error) => {
            clearTimeout(timer);
            if (!isMounted || settled || timedOut) return;
            if (retriesLeft === 0) {
              console.error('Image failed to load:', error);
              setFailed(true);
              return;
            }
            const delay = RETRY_DELAY_MS * (0.5 + Math.random());
            timers.push(setTimeout(() => load(retriesLeft - 1), delay));
          },
        );
      };

      if (imageReadyForDecryption) load(1);

      return () => {
        isMounted = false;
        timers.forEach(clearTimeout);
        if (currentObjectUrl) {
          URL.revokeObjectURL(currentObjectUrl);
        }
      };
    }, [encryptionKey, url, nonce, authTag, retryKey]);

    const handleRetry = () => {
      setFailed(false);
      setRetryKey((key) => key + 1);
    };

    if (source) {
      return (
        <img
          src={source}
          alt={alt}
          className={className}
          width={width}
          height={height}
          ref={ref}
        />
      );
    }

    if (failed) {
      return (
        <div className="w-[500px] max-w-full h-[300px] rounded-lg border color-border-default flex flex-col items-center justify-center gap-2 text-center">
          <span className="text-sm color-text-secondary">
            Failed to load image
          </span>
          <button
            type="button"
            onClick={handleRetry}
            aria-label="Retry loading image"
            className="text-sm px-3 py-1 rounded border color-border-default hover:color-bg-default-hover transition-colors"
          >
            Retry
          </button>
        </div>
      );
    }

    return <Skeleton className={`w-[500px] h-[300px] rounded-lg`} />;
  },
);
