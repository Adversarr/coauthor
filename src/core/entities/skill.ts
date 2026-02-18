/**
 * Domain Layer - Skill Entity
 *
 * Skills are reusable instruction bundles discovered from workspace files.
 * This module defines stable metadata and activation payload types shared by
 * runtime orchestration, registries, and the activateSkill tool.
 */

/**
 * Metadata visible before activation.
 * This is intentionally lightweight for progressive disclosure.
 */
type SkillMetadata = {
  /**
   * Stable skill identifier used by runtime/tool calls.
   * Derived from frontmatter `name` and sanitized for safety.
   */
  name: string

  /** Human-readable summary shown in the system prompt catalog. */
  description: string

  /** Workspace-relative directory where the skill is stored. */
  location: string
}

/**
 * Registry-level skill definition.
 * Holds metadata plus source file path needed for lazy body loading.
 */
export type SkillDefinition = SkillMetadata & {
  /** Absolute path to the skill markdown file (`SKILL.md`). */
  skillFilePath: string
}

/**
 * Activation payload returned by activateSkill.
 * The body and folder structure are injected through tool-result history.
 */
export type SkillActivationResult = {
  name: string
  description: string
  location: string
  mountPath: string
  folderStructure: string
  body: string
  alreadyActivated: boolean
}

/**
 * Convert an arbitrary skill label into a stable ID.
 *
 * Rules:
 * - trim whitespace
 * - lowercase
 * - collapse non `[a-z0-9._-]` characters into `-`
 * - trim edge separators
 *
 * Returns an empty string when normalization yields no valid content.
 */
export function sanitizeSkillName(rawName: string): string {
  return rawName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^-+/u, '')
    .replace(/-+$/u, '')
}

/**
 * Normalize metadata fields while preserving semantic content.
 */
export function normalizeSkillMetadata(input: {
  name: string
  description: string
  location: string
}): SkillMetadata {
  return {
    name: sanitizeSkillName(input.name),
    description: input.description.trim(),
    location: input.location.replace(/\\/gu, '/').trim(),
  }
}
