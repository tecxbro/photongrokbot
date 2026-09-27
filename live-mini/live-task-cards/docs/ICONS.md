# Matrix step icon guide

Grokbot selects the closest supported key for each `activityPlan` entry. These six monochrome SVG icons are built into the renderer; do not invent keys, send emoji, generate artwork, or supply image URLs. A key selects the icon only. Write the label from the user's actual task and plan.

| Key | Visual | Choose for | Example step label |
| --- | --- | --- | --- |
| `planning` | List | Define scope, break down a task, plan the approach | Plan implementation |
| `researching` | Magnifying glass | Search, discover, gather sources or inspect information | Collect company sources |
| `verifying` | Shield with check | Validate facts, test behavior, confirm correctness | Verify company profiles |
| `analyzing` | Bar chart | Compare, interpret, calculate or synthesize findings | Analyze market findings |
| `report` | Document | Draft, summarize or prepare a written deliverable | Prepare research report |
| `working` | Terminal window | Build, edit, process files, or any action without a closer match | Implement requested changes |

Choose by the action, not the task's industry or title. Research can include verifying, analyzing and report steps. Coding can include planning, working and verifying steps. The shield/check drawing does not mean completion; only the saved stage state determines that. Use `working` as the fallback, and keep a step's icon stable unless its meaning changes.

Example plan fragment, paired with matching `stages` IDs:

```json
"activityPlan": [
  { "stageId": "verify", "icon": "verifying", "label": "Verify company profiles" },
  { "stageId": "analyze", "icon": "analyzing", "label": "Analyze market findings" },
  { "stageId": "report", "icon": "report", "label": "Prepare research report" }
]
```

Write short verb–object labels, at most 50 characters. Use the same label when the row moves from Next to Now. Do not describe upcoming steps as already completed. Stage names and labels are model-authored plan data; the schema checks supported keys and structure, while the task executor supplies the evidence for actual advancement.
