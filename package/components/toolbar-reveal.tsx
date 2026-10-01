import { motion } from 'framer-motion';
import cn from 'classnames';

// Fades a whole toolbar bar in once content is ready. Opacity only, so the
// fixed bar never moves; hidden and inert until then.
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
      transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
      className={cn(className, !isReady && 'invisible pointer-events-none')}
    >
      {children}
    </motion.div>
  );
};
