/**
 * App — root router configuration with lazy-loaded pages.
 */

import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { RootLayout } from '@/layouts/RootLayout'
import { PageSkeleton } from '@/components/display/PageSkeleton'
import { ErrorBoundary } from '@/components/display/ErrorBoundary'

const DashboardPage = lazy(() => import('@/pages/DashboardPage').then(m => ({ default: m.DashboardPage })))
const TaskDetailPage = lazy(() => import('@/pages/TaskDetailPage').then(m => ({ default: m.TaskDetailPage })))
const ActivityPage = lazy(() => import('@/pages/ActivityPage').then(m => ({ default: m.ActivityPage })))
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then(m => ({ default: m.SettingsPage })))

/** Wrap each route in its own ErrorBoundary so one page crash doesn't take down the app (B12). */
function RouteGuard({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageSkeleton />}>
        {children}
      </Suspense>
    </ErrorBoundary>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<RootLayout />}>
          <Route index element={<RouteGuard><DashboardPage /></RouteGuard>} />
          <Route path="tasks/:taskId" element={<RouteGuard><TaskDetailPage /></RouteGuard>} />
          <Route path="activity" element={<RouteGuard><ActivityPage /></RouteGuard>} />
          <Route path="settings" element={<RouteGuard><SettingsPage /></RouteGuard>} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
