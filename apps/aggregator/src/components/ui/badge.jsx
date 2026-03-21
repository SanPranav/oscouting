import { cn } from '../../lib/utils';

export function Badge({ className, ...props }) {
  return <div className={cn('inline-flex items-center rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-primary-foreground', className)} {...props} />;
}
