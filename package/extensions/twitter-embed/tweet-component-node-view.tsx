/* eslint-disable @typescript-eslint/no-explicit-any */
import { Component, ReactNode, useEffect, useState } from 'react';
import { NodeViewProps } from '@tiptap/core';
import { NodeViewWrapper } from '@tiptap/react';
import { EmbeddedTweet } from 'react-tweet';

// react-tweet's getEntities iterates over hashtags/user_mentions/urls/symbols
// unconditionally. Missing OR null arrays both throw "is not iterable" — coerce
// each field to a real array. `media` is the only one react-tweet nil-checks
// itself, but pass it through as an array too when present.
const toArray = (v: any): any[] => (Array.isArray(v) ? v : []);

const normalizeEntities = (entities: any) => {
  const e = entities ?? {};
  return {
    hashtags: toArray(e.hashtags),
    user_mentions: toArray(e.user_mentions),
    urls: toArray(e.urls),
    symbols: toArray(e.symbols),
    ...(e.media != null ? { media: toArray(e.media) } : {}),
  };
};

const normalizeTweet = (tweet: any) => {
  if (!tweet) return tweet;
  return {
    ...tweet,
    entities: normalizeEntities(tweet.entities),
    quoted_tweet: tweet.quoted_tweet
      ? {
          ...tweet.quoted_tweet,
          entities: normalizeEntities(tweet.quoted_tweet.entities),
        }
      : tweet.quoted_tweet,
  };
};

class TweetErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: unknown) {
    console.error('EmbeddedTweet render failed:', err);
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

export const TweetComponentNodeView = ({ node }: NodeViewProps) => {
  const [tweetData, setTweetData] = useState<any>(null);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const fetchTweetData = async () => {
      try {
        const response = await fetch(
          `https://react-tweet.vercel.app/api/tweet/${node.attrs.tweetId}`,
        );
        if (!response.ok) {
          throw new Error(`tweet fetch failed: ${response.status}`);
        }
        const json = await response.json();
        if (!json?.data) {
          throw new Error('tweet payload missing');
        }
        setTweetData(normalizeTweet(json.data));
      } catch (error) {
        console.error('Error fetching tweet:', error);
        setError(true);
      }
    };

    fetchTweetData();
  }, [node.attrs.tweetId, retryKey]);

  const handleRetry = () => {
    setError(false);
    setTweetData(null);
    setRetryKey((k) => k + 1);
  };

  const tweetUrl = `https://twitter.com/i/status/${node.attrs.tweetId}`;

  const linkFallback = (
    <div className="flex flex-col items-center gap-2 text-center">
      <span className="text-sm color-text-secondary">Failed to load tweet</span>
      <a
        href={tweetUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-blue-600 hover:underline break-all"
      >
        {tweetUrl}
      </a>
      <button
        type="button"
        onClick={handleRetry}
        className="text-sm px-3 py-1 rounded border color-border-default hover:color-bg-default-hover transition-colors"
      >
        Retry
      </button>
    </div>
  );

  return (
    <NodeViewWrapper
      as="div"
      className="flex gap-2 group w-full relative justify-center items-start"
    >
      {error ? (
        linkFallback
      ) : (
        <div className="w-full flex justify-center items-center min-h-[200px]">
          <TweetErrorBoundary key={retryKey} fallback={linkFallback}>
            {tweetData ? (
              <EmbeddedTweet tweet={tweetData} />
            ) : (
              <span className="text-sm color-text-secondary">
                Loading tweet…
              </span>
            )}
          </TweetErrorBoundary>
        </div>
      )}
    </NodeViewWrapper>
  );
};
