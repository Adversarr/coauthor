/**
 * Root layout — sidebar + main content area.
 */

import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Sparkles, LayoutDashboard, Settings, Activity } from 'lucide-react'
import { ConnectionIndicator } from '@/components/ConnectionIndicator'
import { useTaskStore } from '@/stores'
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
  SidebarTrigger,
} from '@/components/ui/sidebar'

export function RootLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const activeTasks = useTaskStore(s => s.tasks.filter(t => !['done', 'failed', 'canceled'].includes(t.status)).length)
  const isTasksActive = location.pathname === '/' || location.pathname.startsWith('/tasks')
  const isActivityActive = location.pathname.startsWith('/activity')
  const isSettingsActive = location.pathname.startsWith('/settings')

  return (
    <SidebarProvider defaultOpen>
      <Sidebar collapsible="icon" variant="sidebar">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-2 cursor-pointer" onClick={() => navigate('/')}>
            <Sparkles size={18} className="text-violet-400" />
            <span className="text-sm font-bold tracking-tight">CoAuthor</span>
          </div>
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
          <main className="flex-1 overflow-y-auto">
            <div className="max-w-4xl mx-auto px-6 py-8">
              <Outlet />
            </div>
          </main>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
