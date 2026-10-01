import { motion } from 'framer-motion';
import cn from 'classnames';

// Fades a whole toolbar bar in once content is ready. Opacity only, so the
// fixed bar never moves. The delay keeps it out of the load burst, so it
// enters after the content instead of inside the first paint.
export const ToolbarReveal = ({
  isReady,
  className,
  children,
}: {
  isReady: boolean;
  className?: string;
  children: React.ReactNode;
}) => {
  return (
    <motion.div
      initial={false}
      animate={{ opacity: isReady ? 1 : 0 }}
      transition={
        isReady
          ? { delay: 0.2, duration: 0.3, ease: [0.33, 1, 0.68, 1] }
          : { duration: 0 }
      }
      className={cn(className, !isReady && 'invisible pointer-events-none')}
    >
      {children}
    </motion.div>
  );
};
