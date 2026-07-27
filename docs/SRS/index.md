# Software Requirements Specification (SRS) — SWAL Agent Runner

> **Protocol Version:** 3.9.0  
> **Synced Ratio Target:** 100%  
> **Status:** Active / Synced

## Specification Documents

| Document | Description | Status |
|---|---|---|
| [REQUIREMENTS.md](file:///home/belal/proyectosSWAL/swal-agent-runner/docs/SRS/REQUIREMENTS.md) | Functional Requirements (REQ-01 to REQ-06) with Acceptance Criteria & Traces | Synced (100%) |
| [ARCHITECTURE.md](file:///home/belal/proyectosSWAL/swal-agent-runner/docs/SRS/ARCHITECTURE.md) | High-Level Component Diagrams & Interface Contracts | Synced (100%) |

## Project Summary

`swal-agent-runner` is a PWA development and memory edge node built for the SWAL ecosystem. It acts as an autonomous coding agent runner that executes tasks in headless WebContainers, stores repos via `isomorphic-git` in IndexedDB, routes prompts across multiple LLM providers (Google AI Pro via OAuth2 PKCE, Gemini API, OpenRouter, OpenCodeGo), and maintains an embedded Xavier Memory core that synchronizes in real time with the primary workstation Xavier node.

---
*SWAL GitCore Protocol v3.9.0*
