/**
 * PageSkeleton — loading fallback for lazy-loaded pages.
 *
 * Renders pulsing skeleton bars mimicking a typical page layout,
 * shown while a React.lazy() chunk is being downloaded.
 */

import { Skeleton } from '@/components/ui/skeleton'

export function PageSkeleton() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Title skeleton */}
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>

      {/* Tabs skeleton */}
      <div className="flex gap-2">
        <Skeleton className="h-8 w-20 rounded-md" />
        <Skeleton className="h-8 w-20 rounded-md" />
        <Skeleton className="h-8 w-20 rounded-md" />
      </div>

      {/* Content skeleton */}
      <div className="space-y-3">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 p-3">
            <Skeleton className="h-4 w-4 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}
