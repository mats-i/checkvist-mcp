#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from the project root (one directory up from dist)
dotenv.config({ path: join(__dirname, '..', '.env') });

const CHECKVIST_API_BASE = 'https://checkvist.com';
const username = process.env.CHECKVIST_USERNAME;
const apiKey = process.env.CHECKVIST_API_KEY;

if (!username || !apiKey) {
  throw new Error('CHECKVIST_USERNAME and CHECKVIST_API_KEY must be set in .env');
}

// Authentication token cache
let authToken: string | null = null;
let tokenExpiry: number | null = null;

async function getAuthToken(): Promise<string> {
  // Return cached token if still valid (with 1 hour buffer)
  if (authToken && tokenExpiry && Date.now() < tokenExpiry - 3600000) {
    return authToken;
  }

  const response = await fetch(`${CHECKVIST_API_BASE}/auth/login.json?version=2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      remote_key: apiKey,
    }),
  });

  if (!response.ok) {
    throw new Error(`Authentication failed: ${response.statusText}`);
  }

  const data = await response.json() as { token: string };
  authToken = data.token;
  // Token valid for 1 day, store expiry
  tokenExpiry = Date.now() + 86400000;

  return authToken as string;
}

async function checkvistapiCall(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  body?: any
): Promise<any> {
  const token = await getAuthToken();
  const url = `${CHECKVIST_API_BASE}${endpoint}`;

  const headers: Record<string, string> = {
    'X-Client-Token': token,
    'Content-Type': 'application/json',
  };

  const options: any = {
    method,
    headers,
  };

  if (body && (method === 'POST' || method === 'PUT')) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const errorText = await response.text();
    let helpfulMessage = `Checkvist API error: ${response.status} - ${errorText}`;

    // Add helpful tips based on status code
    if (response.status === 401) {
      helpfulMessage += '\n\nTip: Check your CHECKVIST_USERNAME and CHECKVIST_API_KEY in .env';
    } else if (response.status === 404) {
      helpfulMessage += '\n\nTip: Verify that the checklist_id or task_id exists';
    } else if (response.status === 403) {
      helpfulMessage += '\n\nTip: You may not have permission to perform this action';
    } else if (response.status === 422) {
      helpfulMessage += '\n\nTip: Check that all required fields are provided and valid';
    }

    throw new Error(helpfulMessage);
  }

  return response.json();
}

const server = new Server(
  {
    name: 'checkvist-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List all tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'checkvist_list_checklists',
        description: 'Get all checklists for the authenticated user. Can filter for archived lists.',
        inputSchema: {
          type: 'object',
          properties: {
            archived: {
              type: 'boolean',
              description: 'If true, returns archived lists',
            },
            skip_stats: {
              type: 'boolean',
              description: 'If true, faster execution but missing stats',
            },
          },
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      {
        name: 'checkvist_get_checklist',
        description: 'Get information about a specific checklist by ID',
        inputSchema: {
          type: 'object',
          properties: {
            checklist_id: {
              type: 'number',
              description: 'The ID of the checklist',
            },
          },
          required: ['checklist_id'],
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      {
        name: 'checkvist_create_checklist',
        description: 'Create a new checklist',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Checklist name',
            },
            public: {
              type: 'boolean',
              description: 'Make checklist public',
            },
            tags: {
              type: 'string',
              description: 'Comma-separated list of tags',
            },
          },
          required: ['name'],
        },
      },
      {
        name: 'checkvist_update_checklist',
        description: 'Update an existing checklist',
        inputSchema: {
          type: 'object',
          properties: {
            checklist_id: {
              type: 'number',
              description: 'The ID of the checklist',
            },
            name: {
              type: 'string',
              description: 'New checklist name',
            },
            public: {
              type: 'boolean',
              description: 'Make checklist public or private',
            },
          },
          required: ['checklist_id'],
        },
      },
      {
        name: 'checkvist_delete_checklist',
        description: 'Delete a checklist (marks for deletion)',
        inputSchema: {
          type: 'object',
          properties: {
            checklist_id: {
              type: 'number',
              description: 'The ID of the checklist',
            },
          },
          required: ['checklist_id'],
        },
        annotations: {
          destructiveHint: true,
        },
      },
      {
        name: 'checkvist_get_tasks',
        description: 'Get all tasks from a checklist as raw JSON. Use checkvist_get_tasks_summary instead for easier reading. Only use this when you need the complete JSON data structure.',
        inputSchema: {
          type: 'object',
          properties: {
            checklist_id: {
              type: 'number',
              description: 'The ID of the checklist',
            },
            with_notes: {
              type: 'boolean',
              description: 'Include notes/comments in the response',
            },
          },
          required: ['checklist_id'],
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      {
        name: 'checkvist_get_tasks_summary',
        description: 'Get tasks from a checklist in a readable text format (RECOMMENDED). For VERY LARGE checklists: use preview=true to see only top-level tasks. For large checklists: use compact=true to show all tasks with titles+IDs only. For small checklists: use default to see full details.',
        inputSchema: {
          type: 'object',
          properties: {
            checklist_id: {
              type: 'number',
              description: 'The ID of the checklist',
            },
            max_depth: {
              type: 'number',
              description: 'Maximum depth of subtasks to include (default: 99 = show all)',
            },
            include_closed: {
              type: 'boolean',
              description: 'Include closed tasks (default: false)',
            },
            compact: {
              type: 'boolean',
              description: 'Ultra-compact mode: only show task IDs and titles, no metadata or notes. Use this for large checklists to see entire structure (default: false)',
            },
            preview: {
              type: 'boolean',
              description: 'Preview mode: show only top-level tasks without subtasks. Perfect for getting a quick overview of very large checklists. Set max_depth=1 and compact=true automatically (default: false)',
            },
          },
          required: ['checklist_id'],
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      {
        name: 'checkvist_get_task',
        description: 'Get a specific task by ID, including its parent hierarchy (returns JSON)',
        inputSchema: {
          type: 'object',
          properties: {
            checklist_id: {
              type: 'number',
              description: 'The ID of the checklist',
            },
            task_id: {
              type: 'number',
              description: 'The ID of the task',
            },
            with_notes: {
              type: 'boolean',
              description: 'Include notes/comments',
            },
          },
          required: ['checklist_id', 'task_id'],
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      {
        name: 'checkvist_get_task_tree',
        description: 'Get a specific task and its subtasks in readable text format. Use max_depth to limit size if needed.',
        inputSchema: {
          type: 'object',
          properties: {
            checklist_id: {
              type: 'number',
              description: 'The ID of the checklist',
            },
            task_id: {
              type: 'number',
              description: 'The ID of the task to start from',
            },
            include_closed: {
              type: 'boolean',
              description: 'Include closed tasks (default: false)',
            },
            max_depth: {
              type: 'number',
              description: 'Maximum depth to show (default: 3). Use lower value if result is too large.',
            },
            compact: {
              type: 'boolean',
              description: 'Compact mode - shorter output (default: false)',
            },
            with_notes: {
              type: 'boolean',
              description: 'Include notes/comments. WARNING: Notes can be very large and cause size limit errors (default: false)',
            },
          },
          required: ['checklist_id', 'task_id'],
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      {
        name: 'checkvist_get_checklist_stats',
        description: 'Get statistics about a checklist: number of tasks, top-level tasks, average depth, etc. Use this first to understand checklist size.',
        inputSchema: {
          type: 'object',
          properties: {
            checklist_id: {
              type: 'number',
              description: 'The ID of the checklist',
            },
          },
          required: ['checklist_id'],
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      {
        name: 'checkvist_list_top_level_tasks',
        description: 'Get ONLY the list of top-level task IDs and titles (no subtasks). Use this to get an overview, then use checkvist_get_task_tree to read each one individually.',
        inputSchema: {
          type: 'object',
          properties: {
            checklist_id: {
              type: 'number',
              description: 'The ID of the checklist',
            },
          },
          required: ['checklist_id'],
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      {
        name: 'checkvist_get_tasks_paginated',
        description: 'Get ALL tasks in chunks to avoid size limits. Returns a specific page of top-level tasks with their subtasks. Call multiple times with different page numbers to read entire checklist.',
        inputSchema: {
          type: 'object',
          properties: {
            checklist_id: {
              type: 'number',
              description: 'The ID of the checklist',
            },
            page: {
              type: 'number',
              description: 'Page number (1-based). Each page contains 1 top-level task with all its subtasks.',
            },
            compact: {
              type: 'boolean',
              description: 'Compact mode (default: true)',
            },
            max_depth: {
              type: 'number',
              description: 'Maximum depth of subtasks to include. Use 2-3 for very large branches, 99 for everything (default: 2)',
            },
            ultra_compact: {
              type: 'boolean',
              description: 'Ultra-minimal mode: only ID + first 40 chars of title. Use for maximum size reduction (default: false)',
            },
          },
          required: ['checklist_id', 'page'],
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      {
        name: 'checkvist_create_task',
        description: 'Create a new task in a checklist',
        inputSchema: {
          type: 'object',
          properties: {
            checklist_id: {
              type: 'number',
              description: 'The ID of the checklist',
            },
            content: {
              type: 'string',
              description: 'Task text content',
            },
            parent_id: {
              type: 'number',
              description: 'Parent task ID (optional)',
            },
            tags: {
              type: 'string',
              description: 'Comma-separated list of tags',
            },
            due_date: {
              type: 'string',
              description: 'Due date in Checkvist smart syntax',
            },
            position: {
              type: 'number',
              description: '1-based position',
            },
            priority: {
              type: 'number',
              description: 'Priority 0-9',
              minimum: 0,
              maximum: 9,
            },
            assignee_ids: {
              type: 'array',
              description: 'Array of user IDs to assign this task to',
              items: {
                type: 'number',
              },
            },
          },
          required: ['checklist_id', 'content'],
        },
      },
      {
        name: 'checkvist_update_task',
        description: 'Update an existing task',
        inputSchema: {
          type: 'object',
          properties: {
            checklist_id: {
              type: 'number',
              description: 'The ID of the checklist',
            },
            task_id: {
              type: 'number',
              description: 'The ID of the task',
            },
            content: {
              type: 'string',
              description: 'New task text',
            },
            parent_id: {
              type: 'number',
              description: 'New parent task ID',
            },
            tags: {
              type: 'string',
              description: 'Comma-separated list of tags',
            },
            due_date: {
              type: 'string',
              description: 'Due date in Checkvist smart syntax',
            },
            position: {
              type: 'number',
              description: '1-based position',
            },
            priority: {
              type: 'number',
              description: 'Priority 0-9',
              minimum: 0,
              maximum: 9,
            },
            assignee_ids: {
              type: 'array',
              description: 'Array of user IDs to assign this task to',
              items: {
                type: 'number',
              },
            },
            parse: {
              type: 'boolean',
              description: 'Parse smart syntax for ^due and #tags',
            },
          },
          required: ['checklist_id', 'task_id'],
        },
      },
      {
        name: 'checkvist_close_task',
        description: 'Close/complete a task',
        inputSchema: {
          type: 'object',
          properties: {
            checklist_id: {
              type: 'number',
              description: 'The ID of the checklist',
            },
            task_id: {
              type: 'number',
              description: 'The ID of the task',
            },
          },
          required: ['checklist_id', 'task_id'],
        },
      },
      {
        name: 'checkvist_reopen_task',
        description: 'Reopen a closed task',
        inputSchema: {
          type: 'object',
          properties: {
            checklist_id: {
              type: 'number',
              description: 'The ID of the checklist',
            },
            task_id: {
              type: 'number',
              description: 'The ID of the task',
            },
          },
          required: ['checklist_id', 'task_id'],
        },
      },
      {
        name: 'checkvist_delete_task',
        description: 'Delete a task and its children',
        inputSchema: {
          type: 'object',
          properties: {
            checklist_id: {
              type: 'number',
              description: 'The ID of the checklist',
            },
            task_id: {
              type: 'number',
              description: 'The ID of the task',
            },
          },
          required: ['checklist_id', 'task_id'],
        },
        annotations: {
          destructiveHint: true,
        },
      },
      {
        name: 'checkvist_invalidate_task',
        description: 'Mark a task as invalidated (status=2, different from closed)',
        inputSchema: {
          type: 'object',
          properties: {
            checklist_id: {
              type: 'number',
              description: 'The ID of the checklist',
            },
            task_id: {
              type: 'number',
              description: 'The ID of the task',
            },
          },
          required: ['checklist_id', 'task_id'],
        },
      },
      {
        name: 'checkvist_set_repeating_task',
        description: 'Configure a task to repeat on a schedule',
        inputSchema: {
          type: 'object',
          properties: {
            checklist_id: {
              type: 'number',
              description: 'The ID of the checklist',
            },
            task_id: {
              type: 'number',
              description: 'The ID of the task',
            },
            period: {
              type: 'string',
              description: 'Repeat period',
              enum: ['daily', 'weekly', 'monthly', 'yearly'],
            },
            period_number: {
              type: 'number',
              description: 'Repeat every N periods (e.g., every 2 weeks)',
            },
            since: {
              type: 'string',
              description: 'Start date (optional)',
            },
            until: {
              type: 'string',
              description: 'End date (optional)',
            },
          },
          required: ['checklist_id', 'task_id', 'period'],
        },
      },
      {
        name: 'checkvist_import_tasks',
        description: 'Import multiple tasks at once in Checkvist format (indented text)',
        inputSchema: {
          type: 'object',
          properties: {
            checklist_id: {
              type: 'number',
              description: 'The ID of the checklist',
            },
            import_content: {
              type: 'string',
              description: 'Tasks in Checkvist import format (indented lines)',
            },
            parent_id: {
              type: 'number',
              description: 'Optional parent task ID',
            },
            parse_tasks: {
              type: 'boolean',
              description: 'Parse smart syntax (^due, #tags, !priority)',
            },
          },
          required: ['checklist_id', 'import_content'],
        },
      },
      {
        name: 'checkvist_get_notes',
        description: 'Get all notes/comments for a task',
        inputSchema: {
          type: 'object',
          properties: {
            checklist_id: {
              type: 'number',
              description: 'The ID of the checklist',
            },
            task_id: {
              type: 'number',
              description: 'The ID of the task',
            },
          },
          required: ['checklist_id', 'task_id'],
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      {
        name: 'checkvist_create_note',
        description: 'Create a note/comment on a task',
        inputSchema: {
          type: 'object',
          properties: {
            checklist_id: {
              type: 'number',
              description: 'The ID of the checklist',
            },
            task_id: {
              type: 'number',
              description: 'The ID of the task',
            },
            comment: {
              type: 'string',
              description: 'Note text',
            },
          },
          required: ['checklist_id', 'task_id', 'comment'],
        },
      },
      {
        name: 'checkvist_update_note',
        description: 'Update an existing note/comment',
        inputSchema: {
          type: 'object',
          properties: {
            checklist_id: {
              type: 'number',
              description: 'The ID of the checklist',
            },
            task_id: {
              type: 'number',
              description: 'The ID of the task',
            },
            note_id: {
              type: 'number',
              description: 'The ID of the note',
            },
            comment: {
              type: 'string',
              description: 'Updated note text',
            },
          },
          required: ['checklist_id', 'task_id', 'note_id', 'comment'],
        },
      },
      {
        name: 'checkvist_delete_note',
        description: 'Delete a note/comment from a task',
        inputSchema: {
          type: 'object',
          properties: {
            checklist_id: {
              type: 'number',
              description: 'The ID of the checklist',
            },
            task_id: {
              type: 'number',
              description: 'The ID of the task',
            },
            note_id: {
              type: 'number',
              description: 'The ID of the note',
            },
          },
          required: ['checklist_id', 'task_id', 'note_id'],
        },
        annotations: {
          destructiveHint: true,
        },
      },
      {
        name: 'checkvist_get_current_user',
        description: 'Get profile information for the authenticated user',
        inputSchema: {
          type: 'object',
          properties: {},
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Type guard for args
  if (!args) {
    throw new Error('Missing arguments');
  }

  try {
    switch (name) {
      case 'checkvist_list_checklists': {
        const params = new URLSearchParams();
        if (args.archived) params.append('archived', 'true');
        if (args.skip_stats) params.append('skip_stats', 'true');
        
        const queryString = params.toString();
        const endpoint = `/checklists.json${queryString ? '?' + queryString : ''}`;
        const data = await checkvistapiCall(endpoint);
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case 'checkvist_get_checklist': {
        const data = await checkvistapiCall(`/checklists/${args.checklist_id}.json`);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case 'checkvist_get_tasks': {
        const params = new URLSearchParams();
        if (args.with_notes) params.append('with_notes', 'true');

        const queryString = params.toString();
        const endpoint = `/checklists/${args.checklist_id}/tasks.json${queryString ? '?' + queryString : ''}`;
        const data = await checkvistapiCall(endpoint);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case 'checkvist_get_tasks_summary': {
        const endpoint = `/checklists/${args.checklist_id}/tasks.json`; // NO with_notes!
        const tasks = await checkvistapiCall(endpoint) as any[];

        const isPreview = args.preview === true;
        const maxDepth = isPreview ? 1 : (typeof args.max_depth === 'number' ? args.max_depth : 99);
        const includeClosed = args.include_closed === true;
        const compactMode = isPreview ? true : (args.compact === true);

        // Create a map for easy lookup
        const taskMap = new Map();
        tasks.forEach(task => taskMap.set(task.id, task));

        // Helper function to format task tree
        const formatTask = (taskId: number, depth: number, prefix: string): string => {
          const task = taskMap.get(taskId);
          if (!task) return '';

          // Skip closed tasks unless requested
          if (!includeClosed && task.status === 1) return '';

          const indent = '  '.repeat(depth);

          if (compactMode) {
            // Ultra-compact: only status, title, and ID
            const status = task.status === 1 ? '✓' : task.status === 2 ? '✗' : ' ';
            let result = `${indent}[${status}] ${task.content} [${task.id}]\n`;

            // Add subtasks
            if (depth < maxDepth && task.tasks && task.tasks.length > 0) {
              task.tasks.forEach((subtaskId: number) => {
                result += formatTask(subtaskId, depth + 1, prefix);
              });
            }
            return result;
          } else {
            // Full format with metadata
            const status = task.status === 1 ? '[✓]' : '[ ]';
            const due = task.due ? ` (due: ${task.due})` : '';
            const priority = task.priority ? ` !${task.priority}` : '';
            const tags = task.tags_as_text ? ` #${task.tags_as_text}` : '';

            let result = `${indent}${status} ${task.content}${due}${priority}${tags} [ID: ${task.id}]\n`;

            // Add notes if any
            if (task.notes && task.notes.length > 0) {
              task.notes.forEach((note: any) => {
                result += `${indent}  📝 ${note.comment}\n`;
              });
            }

            // Add subtasks if within depth limit
            if (depth < maxDepth && task.tasks && task.tasks.length > 0) {
              task.tasks.forEach((subtaskId: number) => {
                result += formatTask(subtaskId, depth + 1, prefix);
              });
            } else if (task.tasks && task.tasks.length > 0) {
              result += `${indent}  ... (${task.tasks.length} more subtasks, increase max_depth to see)\n`;
            }

            return result;
          }
        };

        // Find top-level tasks (parent_id === 0)
        const topLevelTasks = tasks.filter(task => task.parent_id === 0);

        let summary = `📋 Checklist Summary (${topLevelTasks.length} top-level tasks, ${tasks.length} total)\n`;
        if (isPreview) {
          summary += `⚡ PREVIEW MODE: Showing only top-level tasks\n`;
        } else if (compactMode) {
          summary += `COMPACT MODE: Showing only task titles and IDs\n`;
        }
        summary += `Showing ${maxDepth === 99 ? 'all levels' : `up to ${maxDepth} levels`}, ${includeClosed ? 'including' : 'excluding'} closed tasks\n\n`;

        topLevelTasks.forEach(task => {
          summary += formatTask(task.id, 0, '');
        });

        if (isPreview) {
          summary += `\n💡 TIP: Use checkvist_get_task_tree with a specific task ID to explore subtasks\n`;
          summary += `     Or use max_depth=2 to see one more level\n`;
        } else if (compactMode) {
          summary += `\n💡 Use checkvist_get_task_tree with a specific task ID to see full details\n`;
        }

        return {
          content: [
            {
              type: 'text',
              text: summary,
            },
          ],
        };
      }

      case 'checkvist_get_task': {
        const params = new URLSearchParams();
        if (args.with_notes) params.append('with_notes', 'true');

        const queryString = params.toString();
        const endpoint = `/checklists/${args.checklist_id}/tasks/${args.task_id}.json${queryString ? '?' + queryString : ''}`;
        const data = await checkvistapiCall(endpoint);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case 'checkvist_get_task_tree': {
        // Fetch all tasks from the checklist - only include notes if requested
        const withNotes = args.with_notes === true;
        const endpoint = `/checklists/${args.checklist_id}/tasks.json${withNotes ? '?with_notes=true' : ''}`;
        const allTasks = await checkvistapiCall(endpoint) as any[];
        const includeClosed = args.include_closed === true;
        const maxDepth = typeof args.max_depth === 'number' ? args.max_depth : 3; // Default 3
        const compactMode = args.compact === true;

        // Create a map for quick lookup
        const taskMap = new Map();
        allTasks.forEach(task => taskMap.set(task.id, task));

        // Get the root task
        const rootTask = taskMap.get(args.task_id);
        if (!rootTask) {
          throw new Error(`Task ${args.task_id} not found in checklist ${args.checklist_id}`);
        }

        // Format task tree
        const formatTask = (taskId: number, depth: number): string => {
          const task = taskMap.get(taskId);
          if (!task) return '';

          // Skip closed tasks unless requested
          if (!includeClosed && task.status === 1) return '';

          const indent = '  '.repeat(depth);

          if (compactMode) {
            const truncated = task.content.length > 50 ? task.content.substring(0, 50) + '...' : task.content;
            let result = `${indent}${task.id}: ${truncated}\n`;

            if (depth < maxDepth && task.tasks && task.tasks.length > 0) {
              task.tasks.forEach((subtaskId: number) => {
                result += formatTask(subtaskId, depth + 1);
              });
            } else if (depth >= maxDepth && task.tasks && task.tasks.length > 0) {
              result += `${indent}  ... (${task.tasks.length} more, use max_depth=${maxDepth+1})\n`;
            }
            return result;
          } else {
            const status = task.status === 1 ? '[✓]' : task.status === 2 ? '[✗]' : '[ ]';
            const due = task.due ? ` 📅 ${task.due}` : '';
            const priority = task.priority ? ` ⚠️ P${task.priority}` : '';
            const tags = task.tags_as_text ? ` 🏷️ ${task.tags_as_text}` : '';

            let result = `${indent}${status} ${task.content}${due}${priority}${tags} [${task.id}]\n`;

            // Add notes only if they were fetched (limit to 2 notes to reduce size)
            if (withNotes && task.notes && task.notes.length > 0) {
              const notesToShow = task.notes.slice(0, 2);
              notesToShow.forEach((note: any) => {
                const noteText = note.comment.length > 150 ? note.comment.substring(0, 150) + '...' : note.comment;
                result += `${indent}  💬 ${noteText}\n`;
              });
              if (task.notes.length > 2) {
                result += `${indent}  ... (${task.notes.length - 2} more notes)\n`;
              }
            }

            // Add subtasks
            if (depth < maxDepth && task.tasks && task.tasks.length > 0) {
              task.tasks.forEach((subtaskId: number) => {
                result += formatTask(subtaskId, depth + 1);
              });
            } else if (depth >= maxDepth && task.tasks && task.tasks.length > 0) {
              result += `${indent}  ... (${task.tasks.length} more subtasks, use max_depth=${maxDepth+1})\n`;
            }

            return result;
          }
        };

        let output = `🌳 Task: ${rootTask.content}\n`;
        output += `Depth: ${maxDepth}, ${compactMode ? 'Compact' : 'Full'} mode\n\n`;
        output += formatTask(args.task_id as number, 0);

        return {
          content: [
            {
              type: 'text',
              text: output,
            },
          ],
        };
      }

      case 'checkvist_get_checklist_stats': {
        const endpoint = `/checklists/${args.checklist_id}/tasks.json`; // NO with_notes!
        const allTasks = await checkvistapiCall(endpoint) as any[];

        const topLevelTasks = allTasks.filter(task => task.parent_id === 0);
        const closedTasks = allTasks.filter(task => task.status === 1);
        const tasksWithNotes = allTasks.filter(task => task.notes && task.notes.length > 0);

        // Calculate depth statistics
        const taskMap = new Map();
        allTasks.forEach(task => taskMap.set(task.id, task));

        const getDepth = (taskId: number, currentDepth: number = 0): number => {
          const task = taskMap.get(taskId);
          if (!task || !task.tasks || task.tasks.length === 0) {
            return currentDepth;
          }
          const childDepths = task.tasks.map((childId: number) => getDepth(childId, currentDepth + 1));
          return Math.max(...childDepths);
        };

        const depths = topLevelTasks.map(task => getDepth(task.id, 0));
        const maxDepth = Math.max(...depths, 0);
        const avgDepth = depths.length > 0 ? (depths.reduce((a, b) => a + b, 0) / depths.length).toFixed(1) : 0;

        let stats = `📊 Checklist Statistics\n`;
        stats += `Checklist ID: ${args.checklist_id}\n\n`;
        stats += `📝 Total tasks: ${allTasks.length}\n`;
        stats += `📌 Top-level tasks: ${topLevelTasks.length}\n`;
        stats += `✓ Closed tasks: ${closedTasks.length} (${((closedTasks.length/allTasks.length)*100).toFixed(1)}%)\n`;
        stats += `💬 Tasks with notes: ${tasksWithNotes.length}\n\n`;
        stats += `📏 Depth statistics:\n`;
        stats += `   Maximum depth: ${maxDepth} levels\n`;
        stats += `   Average depth: ${avgDepth} levels\n\n`;
        stats += `💡 Recommendation:\n`;
        if (allTasks.length < 50) {
          stats += `   Small checklist - use checkvist_get_tasks_summary with default settings\n`;
        } else if (allTasks.length < 200) {
          stats += `   Medium checklist - use checkvist_get_tasks_summary with compact=true\n`;
        } else {
          stats += `   Large checklist - use checkvist_get_tasks_paginated with max_depth=3\n`;
          stats += `   This will show ${topLevelTasks.length} pages (1 top-level task per page)\n`;
        }

        return {
          content: [
            {
              type: 'text',
              text: stats,
            },
          ],
        };
      }

      case 'checkvist_list_top_level_tasks': {
        const endpoint = `/checklists/${args.checklist_id}/tasks.json`; // NO with_notes!
        const allTasks = await checkvistapiCall(endpoint) as any[];
        const topLevelTasks = allTasks.filter(task => task.parent_id === 0);

        // ULTRA minimal - just IDs
        const ids = topLevelTasks.map(t => t.id).join(', ');

        let output = `Top-level task IDs (${topLevelTasks.length} total):\n${ids}\n\n`;
        output += `Use checkvist_get_task_tree(checklist_id: ${args.checklist_id}, task_id: X) to read each one.\n`;

        return {
          content: [
            {
              type: 'text',
              text: output,
            },
          ],
        };
      }

      case 'checkvist_get_tasks_paginated': {
        // Fetch all tasks from the checklist WITHOUT notes (notes make it huge)
        const endpoint = `/checklists/${args.checklist_id}/tasks.json`;
        const allTasks = await checkvistapiCall(endpoint) as any[];
        const compactMode = args.compact !== false; // Default true
        const pageNum = args.page as number;
        const pageSize = 1; // 1 top-level task per page to avoid size limits
        const maxDepth = typeof args.max_depth === 'number' ? args.max_depth : 2; // Default 2, not 99
        const ultraCompact = args.ultra_compact === true;

        // Create a map for quick lookup
        const taskMap = new Map();
        allTasks.forEach(task => taskMap.set(task.id, task));

        // Get top-level tasks
        const topLevelTasks = allTasks.filter(task => task.parent_id === 0);
        const totalPages = Math.ceil(topLevelTasks.length / pageSize);

        if (pageNum < 1 || pageNum > totalPages) {
          throw new Error(`Invalid page ${pageNum}. Valid pages: 1-${totalPages}`);
        }

        const startIdx = (pageNum - 1) * pageSize;
        const endIdx = Math.min(startIdx + pageSize, topLevelTasks.length);
        const pageTasks = topLevelTasks.slice(startIdx, endIdx);

        // Format task tree recursively
        const formatTask = (taskId: number, depth: number): string => {
          const task = taskMap.get(taskId);
          if (!task) return '';

          const indent = '  '.repeat(depth);

          if (ultraCompact) {
            // ULTRA minimal: just ID + truncated title
            const truncated = task.content.length > 40 ? task.content.substring(0, 40) + '...' : task.content;
            let result = `${indent}${task.id}: ${truncated}\n`;

            if (depth < maxDepth && task.tasks && task.tasks.length > 0) {
              task.tasks.forEach((subtaskId: number) => {
                result += formatTask(subtaskId, depth + 1);
              });
            }
            return result;
          } else if (compactMode) {
            const status = task.status === 1 ? '✓' : task.status === 2 ? '✗' : ' ';
            let result = `${indent}[${status}] ${task.content} [${task.id}]\n`;

            if (depth < maxDepth && task.tasks && task.tasks.length > 0) {
              task.tasks.forEach((subtaskId: number) => {
                result += formatTask(subtaskId, depth + 1);
              });
            } else if (depth >= maxDepth && task.tasks && task.tasks.length > 0) {
              result += `${indent}  ... (${task.tasks.length} more)\n`;
            }
            return result;
          } else {
            const status = task.status === 1 ? '[✓]' : task.status === 2 ? '[✗]' : '[ ]';
            const due = task.due ? ` 📅 ${task.due}` : '';
            const priority = task.priority ? ` ⚠️ P${task.priority}` : '';
            const tags = task.tags_as_text ? ` 🏷️ ${task.tags_as_text}` : '';

            let result = `${indent}${status} ${task.content}${due}${priority}${tags} [ID: ${task.id}]\n`;

            // Skip notes in paginated view to reduce size

            if (depth < maxDepth && task.tasks && task.tasks.length > 0) {
              task.tasks.forEach((subtaskId: number) => {
                result += formatTask(subtaskId, depth + 1);
              });
            } else if (depth >= maxDepth && task.tasks && task.tasks.length > 0) {
              result += `${indent}  ... (${task.tasks.length} more)\n`;
            }
            return result;
          }
        };

        let output = `📄 Page ${pageNum}/${totalPages}\n`;
        output += `Total: ${topLevelTasks.length} top-level, ${allTasks.length} overall\n`;
        if (ultraCompact) {
          output += `Mode: ULTRA (ID + 40 chars), `;
        } else if (compactMode) {
          output += `Mode: Compact, `;
        }
        output += `Depth: ${maxDepth}\n\n`;

        pageTasks.forEach(task => {
          output += formatTask(task.id, 0);
          output += `\n`;
        });

        if (pageNum < totalPages) {
          output += `\n📌 More pages available. Use page=${pageNum + 1} to continue reading.\n`;
          if (maxDepth < 99) {
            output += `   (If tasks are cut off, you can increase max_depth to see more subtasks)\n`;
          }
        } else {
          output += `\n✅ End of checklist. You have read all ${topLevelTasks.length} top-level tasks.\n`;
          if (maxDepth < 99) {
            output += `   (Some deep subtasks may have been hidden due to max_depth=${maxDepth})\n`;
          }
        }

        return {
          content: [
            {
              type: 'text',
              text: output,
            },
          ],
        };
      }

      case 'checkvist_create_task': {
        const taskData: any = {
          content: args.content,
        };

        if (args.parent_id) taskData.parent_id = args.parent_id;
        if (args.tags) taskData.tags = args.tags;
        if (args.due_date) taskData.due_date = args.due_date;
        if (args.position) taskData.position = args.position;
        if (args.priority !== undefined) taskData.priority = args.priority;
        if (args.assignee_ids) taskData.assignee_ids = args.assignee_ids;

        const data = await checkvistapiCall(
          `/checklists/${args.checklist_id}/tasks.json`,
          'POST',
          { task: taskData }
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case 'checkvist_update_task': {
        const taskData: any = {};

        if (args.content) taskData.content = args.content;
        if (args.parent_id) taskData.parent_id = args.parent_id;
        if (args.tags) taskData.tags = args.tags;
        if (args.due_date) taskData.due_date = args.due_date;
        if (args.position) taskData.position = args.position;
        if (args.priority !== undefined) taskData.priority = args.priority;
        if (args.assignee_ids) taskData.assignee_ids = args.assignee_ids;

        const params = new URLSearchParams();
        if (args.parse) params.append('parse', 'true');
        if (args.with_notes) params.append('with_notes', 'true');

        const queryString = params.toString();
        const endpoint = `/checklists/${args.checklist_id}/tasks/${args.task_id}.json${queryString ? '?' + queryString : ''}`;

        const data = await checkvistapiCall(endpoint, 'PUT', { task: taskData });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case 'checkvist_close_task': {
        const data = await checkvistapiCall(
          `/checklists/${args.checklist_id}/tasks/${args.task_id}/close.json`,
          'POST'
        );
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case 'checkvist_reopen_task': {
        const data = await checkvistapiCall(
          `/checklists/${args.checklist_id}/tasks/${args.task_id}/reopen.json`,
          'POST'
        );
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case 'checkvist_delete_task': {
        const data = await checkvistapiCall(
          `/checklists/${args.checklist_id}/tasks/${args.task_id}.json`,
          'DELETE'
        );
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case 'checkvist_import_tasks': {
        const importData: any = {
          import_content: args.import_content,
        };
        
        if (args.parent_id) importData.parent_id = args.parent_id;
        if (args.parse_tasks) importData.parse_tasks = 'true';
        
        const data = await checkvistapiCall(
          `/checklists/${args.checklist_id}/import.json`,
          'POST',
          importData
        );
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case 'checkvist_get_notes': {
        const data = await checkvistapiCall(
          `/checklists/${args.checklist_id}/tasks/${args.task_id}/comments.json`
        );
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case 'checkvist_create_note': {
        const data = await checkvistapiCall(
          `/checklists/${args.checklist_id}/tasks/${args.task_id}/comments.json`,
          'POST',
          { comment: { comment: args.comment } }
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case 'checkvist_create_checklist': {
        const checklistData: any = {
          name: args.name,
        };

        if (args.public !== undefined) checklistData.public = args.public;
        if (args.tags) checklistData.tags = args.tags;

        const data = await checkvistapiCall(
          '/checklists.json',
          'POST',
          { checklist: checklistData }
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case 'checkvist_update_checklist': {
        const checklistData: any = {};

        if (args.name) checklistData.name = args.name;
        if (args.public !== undefined) checklistData.public = args.public;

        const data = await checkvistapiCall(
          `/checklists/${args.checklist_id}.json`,
          'PUT',
          { checklist: checklistData }
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case 'checkvist_delete_checklist': {
        const data = await checkvistapiCall(
          `/checklists/${args.checklist_id}.json`,
          'DELETE'
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case 'checkvist_invalidate_task': {
        const data = await checkvistapiCall(
          `/checklists/${args.checklist_id}/tasks/${args.task_id}/invalidate.json`,
          'POST'
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case 'checkvist_set_repeating_task': {
        const repeatData: any = {
          period: args.period,
        };

        if (args.period_number) repeatData.period_number = args.period_number;
        if (args.since) repeatData.since = args.since;
        if (args.until) repeatData.until = args.until;

        const data = await checkvistapiCall(
          `/checklists/${args.checklist_id}/tasks/${args.task_id}/repeat.json`,
          'POST',
          repeatData
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case 'checkvist_update_note': {
        const data = await checkvistapiCall(
          `/checklists/${args.checklist_id}/tasks/${args.task_id}/comments/${args.note_id}.json`,
          'PUT',
          { comment: { comment: args.comment } }
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case 'checkvist_delete_note': {
        const data = await checkvistapiCall(
          `/checklists/${args.checklist_id}/tasks/${args.task_id}/comments/${args.note_id}.json`,
          'DELETE'
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case 'checkvist_get_current_user': {
        const data = await checkvistapiCall('/auth/curr_user.json');

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Checkvist MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
