export interface ProjectContext {
  outline?: string
  brief?: string
  style?: string
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
