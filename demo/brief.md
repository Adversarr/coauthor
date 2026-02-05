# Research Brief: CoAuthor System

## Project Overview

**CoAuthor** is an intelligent co-authoring system designed for STEM academic writing using Large Language Models (LLMs). It provides a task-driven, event-sourced architecture for collaborative writing with LaTeX support.

## Core Innovation

The system addresses a critical gap in current AI-assisted writing tools: **transparency and reproducibility**. By using event sourcing, every change made by human authors or AI agents is recorded in an immutable log, enabling:

- Complete audit trails
- Temporal queries and state reconstruction
- Conflict resolution through event ordering
- Safe experimentation with AI-generated content

## Technical Architecture

- **Hexagonal Architecture**: Clean separation between domain, application, and infrastructure layers
- **Event Sourcing**: All state changes captured as domain events in JSONL format
- **Agent Runtime**: Tool use workflow with UIP (User Interaction Points) for risky operations
- **CLI + TUI**: Flexible interfaces for different user preferences

## Current Status

- M1 (Core event sourcing and CLI scaffolding) - Complete
- M2 (Agent runtime with tool use) - In progress
- M3 (LaTeX compilation and preview) - Planned
