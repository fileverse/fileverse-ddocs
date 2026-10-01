import { motion } from 'framer-motion';
import cn from 'classnames';

// Fades a whole toolbar bar in together with the editor content: same
// trigger and duration as slideUpTransition. Opacity only, so the fixed bar
// never moves.
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
      transition={{ duration: isReady ? 0.2 : 0 }}
      className={cn(className, !isReady && 'invisible pointer-events-none')}
    >
      {children}
    </motion.div>
  );
};
