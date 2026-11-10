# BTB Documentation

BTB documentation is grouped by purpose. Start with the document that matches the task instead of reading the entire set.

## Start here

| Need | Document |
| --- | --- |
| Set up and run the repository | [Root README](../README.md#quick-start) |
| Understand architecture and execution flow | [Codebase guide](architecture/codebase-guide.md) |
| Learn the codebase from the beginning in Indonesian | [BTB learning course](learning/README.md) |
| Use a compact staged checklist | [Codebase learning path](architecture/codebase-learning-path.md) |
| Operate or troubleshoot runs | [Runbook](operations/runbook.md) |
| Understand product requirements | [PRD](product/prd.md) |
| Review delivery status and remaining work | [Delivery status](product/delivery-status.md) |

## Structure

```text
docs/
├── README.md
├── product/       # Requirements, scope, UI plan, and delivery status
├── architecture/  # System design, data model, and codebase references
├── learning/      # Indonesian guided course and feature flows
├── operations/    # Operating and troubleshooting procedures
└── evidence/      # Spike results and release-gate evidence
```

## Product

Answers: **what are we building, and why?**

- [Product requirements](product/prd.md) — problem, requirements, user stories, and implementation decisions.
- [Feature breakdown](product/feature-breakdown.md) — epics, dependencies, risks, and release gates.
- [UI epics](product/ui-epics.md) — web UI scope and implementation status.
- [Delivery status](product/delivery-status.md) — completed milestones, remaining external work, and current constraints.

## Architecture

Answers: **how is the system designed, and how does the code work?**

- [System flowchart](architecture/system-flowchart.html) — visual system and execution flow.
- [Database schema](architecture/database-schema.html) — PostgreSQL tables and relationships.
- [Codebase guide](architecture/codebase-guide.md) — current architecture and end-to-end flows.
- [Codebase learning path](architecture/codebase-learning-path.md) — staged reading plan, exercises, and checkpoints.

## Learning

Answers: **where should a new developer begin, and how does each feature flow work?**

- [BTB learning course](learning/README.md) — Indonesian course from stack orientation through feature flows and debugging.

## Operations

Answers: **how do we run and recover the system?**

- [Runbook](operations/runbook.md) — startup, test execution, emergency stop, troubleshooting, and capacity.

## Evidence

Answers: **what has been measured and verified?**

- [Go/no-go assessment](evidence/go-no-go.md) — current release recommendation and supporting evidence.
- `evidence/m5/` — detailed spike and validation artifacts.

## Conventions

- File names use lowercase kebab-case.
- Every Markdown document has one level-one heading; major sections use level two.
- Internal links use relative paths.
- The PRD is authoritative for product requirements.
- The runbook is authoritative for operating procedures.
- Evidence records measurements; it does not redefine requirements.
- Status documents summarize current implementation and link to evidence instead of duplicating raw output.
