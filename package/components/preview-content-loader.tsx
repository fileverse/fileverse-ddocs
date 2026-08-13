import { PreviewSkeleton } from './preview-skeleton';
import { motion, MotionConfig } from 'framer-motion';

export const PreviewContentLoader = () => {
  return (
    <div className="flex flex-col gap-8">
      <MotionConfig
        transition={{
          duration: 4,
          ease: 'easeInOut',
          repeat: Infinity,
        }}
      >
        <motion.div
          className="space-y-4"
          animate={{
            opacity: [0.4, 1, 1, 1, 0.4],
          }}
        >
          <PreviewSkeleton className="h-10" />
          <PreviewSkeleton className="w-[77.54%]" />
          <PreviewSkeleton className="w-[83.62%]" />
          <PreviewSkeleton className="w-[51.01%]" />
        </motion.div>
        <motion.div
          className="space-y-4"
          animate={{
            opacity: [0.2, 0.4, 1, 1, 0.2],
          }}
        >
          <PreviewSkeleton className="w-[83.62%]" />
          <PreviewSkeleton className="w-[90.43%]" />
          <PreviewSkeleton className="w-[77.54%]" />
          <PreviewSkeleton className="w-[72.75%]" />
        </motion.div>
        <motion.div
          className="space-y-4"
          animate={{
            opacity: [0.1, 0.2, 0.4, 1, 0.1],
          }}
        >
          <PreviewSkeleton className="w-[83.62%]" />
          <PreviewSkeleton className="w-[90.43%]" />
          <PreviewSkeleton className="w-[77.54%]" />
          <PreviewSkeleton className="w-[72.75%]" />
        </motion.div>
      </MotionConfig>
    </div>
  );
};
