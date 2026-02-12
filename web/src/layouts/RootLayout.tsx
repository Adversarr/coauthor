/**
 * Root layout — sidebar + main content area.
 */

import { useEffect } from 'react'
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Sparkles, LayoutDashboard, Settings, Activity } from 'lucide-react'
import { ConnectionIndicator } from '@/components/display/ConnectionIndicator'
import { TaskTree } from '@/components/navigation/TaskTree'
import {
  useTaskStore,
  unregisterTaskStoreSubscriptions,
  unregisterStreamStoreSubscriptions,
  unregisterConversationSubscriptions,
} from '@/stores'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
  SidebarGroup,
  SidebarGroupLabel,
} from '@/components/ui/sidebar'

export function RootLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const activeTasks = useTaskStore(s => s.tasks.filter(t => !['done', 'failed', 'canceled'].includes(t.status)).length)
  const totalTasks = useTaskStore(s => s.tasks.length)
  const isTasksActive = location.pathname === '/' || location.pathname.startsWith('/tasks')
  const isActivityActive = location.pathname.startsWith('/activity')
  const isSettingsActive = location.pathname.startsWith('/settings')

  // Extract active task ID from route like /tasks/:taskId
  const taskMatch = location.pathname.match(/^\/tasks\/([^/]+)/)
  const activeTaskId = taskMatch?.[1]

  // Global keyboard shortcuts (Ctrl+N, Escape, g-h / g-a / g-s)
  useKeyboardShortcuts()

  // Cleanup store subscriptions on unmount (B6: prevents memory leaks on HMR)
  useEffect(() => {
    return () => {
      unregisterTaskStoreSubscriptions()
      unregisterStreamStoreSubscriptions()
      unregisterConversationSubscriptions()
    }
  }, [])

  return (
    <SidebarProvider defaultOpen>
      <Sidebar collapsible="icon" variant="sidebar">
        <SidebarHeader>
          <button className="flex items-center gap-2 px-2 py-2" onClick={() => navigate('/')} aria-label="Go to dashboard">
            <Sparkles size={18} className="text-violet-400" />
            <span className="text-sm font-bold tracking-tight">CoAuthor</span>
          </button>
        </SidebarHeader>

        <SidebarContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={isTasksActive} tooltip="Tasks">
                <NavLink to="/" end>
                  <LayoutDashboard />
                  <span>Tasks</span>
                </NavLink>
              </SidebarMenuButton>
              {activeTasks > 0 && <SidebarMenuBadge>{activeTasks}</SidebarMenuBadge>}
            </SidebarMenuItem>

            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={isActivityActive} tooltip="Activity">
                <NavLink to="/activity">
                  <Activity />
                  <span>Activity</span>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>

            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={isSettingsActive} tooltip="Settings">
                <NavLink to="/settings">
                  <Settings />
                  <span>Settings</span>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>

          {/* Task tree — shows hierarchical task list when tasks exist */}
          {totalTasks > 0 && (
            <>
              <SidebarSeparator />
              <SidebarGroup>
                <SidebarGroupLabel>Tasks</SidebarGroupLabel>
                <TaskTree activeTaskId={activeTaskId} className="px-1" />
              </SidebarGroup>
            </>
          )}
        </SidebarContent>

        <SidebarFooter>
          <div className="px-2 py-2">
            <ConnectionIndicator />
          </div>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <div className="flex h-svh flex-col">
          <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
            <SidebarTrigger />
          </header>
          <main className="flex-1 overflow-hidden">
            <div className="h-full max-w-4xl mx-auto px-6 py-6">
              <Outlet />
            </div>
          </main>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
