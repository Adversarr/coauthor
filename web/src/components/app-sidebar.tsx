/**
 * Application sidebar built on shadcn's sidebar-10 primitives.
 *
 * This keeps navigation and task-tree behavior in one place so RootLayout can
 * remain a clean shell component.
 */

import { Activity, LayoutDashboard, Settings, Sparkles } from "lucide-react"
import { NavLink, useLocation, useNavigate } from "react-router-dom"

import { ConnectionIndicator } from "@/components/display/ConnectionIndicator"
import { TaskTree } from "@/components/navigation/TaskTree"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { useTaskStore } from "@/stores"

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const navigate = useNavigate()
  const location = useLocation()

  const activeTasks = useTaskStore((s) =>
    s.tasks.filter((t) => !["done", "failed", "canceled"].includes(t.status))
      .length
  )
  const totalTasks = useTaskStore((s) => s.tasks.length)

  const isTasksActive =
    location.pathname === "/" || location.pathname.startsWith("/tasks")
  const isActivityActive = location.pathname.startsWith("/activity")
  const isSettingsActive = location.pathname.startsWith("/settings")

  // Resolve active task for highlight in the tree when route is /tasks/:taskId.
  const taskMatch = location.pathname.match(/^\/tasks\/([^/]+)/)
  const activeTaskId = taskMatch?.[1]

  return (
    <Sidebar {...props}>
      <SidebarHeader>
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-full min-w-0 justify-start gap-2 px-2 py-2"
          onClick={() => navigate("/")}
          aria-label="Go to dashboard"
        >
          <Sparkles size={18} className="shrink-0 text-primary" />
          <span className="truncate text-sm font-bold tracking-tight">
            Seed
          </span>
        </Button>
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
            <SidebarMenuButton
              asChild
              isActive={isActivityActive}
              tooltip="Activity"
            >
              <NavLink to="/activity">
                <Activity />
                <span>Activity</span>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>

          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={isSettingsActive}
              tooltip="Settings"
            >
              <NavLink to="/settings">
                <Settings />
                <span>Settings</span>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

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

      <SidebarRail />
    </Sidebar>
  )
}
