export interface ProjectContext {
  agentsMd?: string
}

export interface EnvironmentContext {
  workingDirectory: string
  platform: string
  date: string
}

export interface ContextData {
  env: EnvironmentContext
  project: ProjectContext
}
