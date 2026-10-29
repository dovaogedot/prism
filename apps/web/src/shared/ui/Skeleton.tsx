/** The classes that size a placeholder. */
export type SkeletonProps = Readonly<{ className?: string }>;

/** A block standing where content will be, sized entirely by its class. */
export const Skeleton = ({ className = "" }: SkeletonProps) => <div className={`animate-pulse rounded-lg bg-sunken ${className}`} />;
