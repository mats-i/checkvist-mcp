# Checkvist MCP Server

MCP server for Checkvist API integration, enabling Claude to read and write to Checkvist checklists.

## Features

- Complete checklist CRUD operations (list, get, create, update, delete)
- Complete task management (create, update, close, reopen, delete, invalidate)
- Repeating task configuration
- Task assignment to users
- Import multiple tasks at once
- Complete notes/comments management (get, create, update, delete)
- User profile information
- Full support for Checkvist's smart syntax (^due dates, #tags, !priority)
- Helpful error messages with actionable tips

## Installation

```bash
npm install
npm run build
```

## Configuration

1. Get your Checkvist API key from your profile page: https://checkvist.com/auth/profile
2. Create a `.env` file:

```bash
cp .env.example .env
```

3. Edit `.env` and add your credentials:

```
CHECKVIST_USERNAME=your_email@example.com
CHECKVIST_API_KEY=your_api_key_here
```

## Claude Desktop Configuration

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "checkvist": {
      "command": "node",
      "args": [
        "/Users/matsingerdal/Developer/GitHub/checkvist-mcp/dist/index.js"
      ]
    }
  }
}
```

## Available Tools

### Checklist Management
- `checkvist_list_checklists` - Get all checklists (read-only)
- `checkvist_get_checklist` - Get specific checklist info (read-only)
- `checkvist_create_checklist` - Create a new checklist
- `checkvist_update_checklist` - Update checklist name or visibility
- `checkvist_delete_checklist` - Delete checklist (marks for deletion)

### Task Management
- `checkvist_get_tasks` - Get all tasks as raw JSON (read-only)
- `checkvist_get_tasks_summary` - Get all tasks in readable text format (read-only)
- `checkvist_get_tasks_paginated` - Get tasks in pages to read entire large checklists (RECOMMENDED, read-only)
- `checkvist_get_task` - Get specific task with parent hierarchy as JSON (read-only)
- `checkvist_get_task_tree` - Get a specific task and ALL its subtasks in readable text (read-only)
- `checkvist_create_task` - Create a new task (supports assignee_ids)
- `checkvist_update_task` - Update existing task (supports assignee_ids)
- `checkvist_close_task` - Mark task as complete
- `checkvist_reopen_task` - Reopen completed task
- `checkvist_delete_task` - Delete task and children
- `checkvist_invalidate_task` - Mark task as invalidated (status=2)
- `checkvist_set_repeating_task` - Configure repeating task schedule
- `checkvist_import_tasks` - Import multiple tasks at once

### Notes/Comments
- `checkvist_get_notes` - Get all notes for a task (read-only)
- `checkvist_create_note` - Add a note to a task
- `checkvist_update_note` - Update existing note
- `checkvist_delete_note` - Delete a note

### User Information
- `checkvist_get_current_user` - Get authenticated user profile (read-only)

## Reading Large Checklists

For large checklists with many tasks, use the right approach based on checklist size:

### Strategy 1: Quick Preview (BEST for VERY large checklists) ⭐

**`checkvist_get_tasks_summary` with `preview: true`**
- Shows **ONLY top-level tasks** (no subtasks)
- Minimal data, perfect for huge checklists (1000+ tasks)
- Automatically uses compact mode
- Get quick overview, then drill down with get_task_tree
- Example:
  ```
  checkvist_get_tasks_summary(
    checklist_id: 941803,
    preview: true
  )
  ```
- Output:
  ```
  📋 Checklist Summary (5 top-level tasks, 847 total)
  ⚡ PREVIEW MODE: Showing only top-level tasks

  [ ] Main Project [12345]
  [ ] Archive [12350]
  [ ] Notes [12351]
  [ ] Resources [12352]
  [ ] Templates [12353]

  💡 TIP: Use checkvist_get_task_tree with a specific task ID to explore subtasks
  ```

### Strategy 2: See Full Structure (for medium/large checklists)

**`checkvist_get_tasks_summary` with `compact: true`**
- Shows **ENTIRE checklist** in ultra-compact format
- Only displays: status, title, and ID (no metadata, no notes)
- Works for hundreds of tasks
- Example:
  ```
  checkvist_get_tasks_summary(
    checklist_id: 941803,
    compact: true,
    max_depth: 2
  )
  ```

### Strategy 3: Explore Specific Branches

**`checkvist_get_task_tree`** (for detailed view of one branch)
- Get ONE specific task and ALL its subtasks with full details
- Shows metadata, notes, due dates, priorities, tags
- Perfect when you found interesting task in compact view
- Example: `checkvist_get_task_tree(checklist_id: 941803, task_id: 71218558)`

### Strategy 4: Full Details for Smaller Checklists

**`checkvist_get_tasks_summary` with `compact: false`** (default)
- Shows everything with full metadata and notes
- Only use for checklists with <50 tasks
- May be too large for bigger checklists

**`checkvist_get_tasks`**
- Returns raw JSON structure
- May be stored in files that are harder to read
- Use only when you need to process JSON programmatically

### Recommended Workflows

**Option 1: Read Everything in Pages** ⭐ (BEST for reading entire checklist)
```
1. checkvist_get_tasks_paginated(checklist_id: X, page: 1)
   → Shows first 3 top-level tasks with ALL their subtasks
2. checkvist_get_tasks_paginated(checklist_id: X, page: 2)
   → Shows next 3 top-level tasks with ALL their subtasks
3. Continue until you've read all pages
```
Claude can read ALL tasks this way without hitting size limits!

**Option 2: Preview + Drill Down** (faster for finding specific info)
```
1. checkvist_get_tasks_summary(checklist_id: X, preview: true)
   → See all top-level tasks (just 5-10 items)
2. Find interesting task in the preview
3. checkvist_get_task_tree(checklist_id: X, task_id: Y)
   → Get all details for that specific branch
```

## Smart Syntax Support

Checkvist supports smart syntax in task content:

- `^tomorrow` - Set due date
- `#tag` - Add tag
- `!3` - Set priority (0-9)
- `@username` - Assign to user

Enable parsing with `parse_tasks: true` or `parse: true` parameters.

## Development

```bash
# Watch mode
npm run dev

# Build
npm run build

# Start
npm start
```

## API Documentation

Full Checkvist API docs: https://checkvist.com/auth/api
