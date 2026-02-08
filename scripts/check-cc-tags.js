#!/usr/bin/env node

import fetch from 'node-fetch';
import { config } from 'dotenv';

// Ladda miljövariabler
config();

const CHECKVIST_USERNAME = process.env.CHECKVIST_USERNAME;
const CHECKVIST_API_KEY = process.env.CHECKVIST_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!CHECKVIST_USERNAME || !CHECKVIST_API_KEY || !ANTHROPIC_API_KEY) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

const CHECKVIST_BASE = 'https://checkvist.com';

// Checkvist API helper
async function checkvist(endpoint, options = {}) {
  const url = `${CHECKVIST_BASE}${endpoint}`;
  const auth = Buffer.from(`${CHECKVIST_USERNAME}:${CHECKVIST_API_KEY}`).toString('base64');

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`Checkvist API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// Claude API helper
async function askClaude(taskContent, taskContext) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `En användare har tagget dig i en Checkvist-task med #cc.

Task: ${taskContent}

${taskContext ? `Context/beskrivning: ${taskContext}` : ''}

Svara på användarens fråga eller task. Följ dessa riktlinjer:
- Kort och koncist - max 3-4 meningar för enkla frågor
- Svenska (om tasken är på svenska)
- Inga emojis
- Börja direkt, skippa "Jag förstår att..." etc
- Om det behövs flera steg, lista dem

Ditt svar ska börja med "Claude: " och vara en kommentar som postas direkt på tasken.`
      }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Claude API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

// Huvudlogik
async function main() {
  console.log('🔍 Checking for #cc tags in Checkvist...');

  try {
    // 1. Hämta alla checklistor
    const checklists = await checkvist('/checklists.json');
    console.log(`📋 Found ${checklists.length} checklists`);

    let totalProcessed = 0;

    // 2. För varje checklista
    for (const checklist of checklists) {
      console.log(`\n📝 Checking checklist: ${checklist.name} (ID: ${checklist.id})`);

      // 3. Hämta alla tasks
      const tasks = await checkvist(`/checklists/${checklist.id}/tasks.json`);

      // 4. Hitta tasks med #cc tag
      const ccTasks = tasks.filter(task =>
        task.tags_as_text && task.tags_as_text.includes('cc')
      );

      if (ccTasks.length === 0) {
        console.log('   ✓ No #cc tags found');
        continue;
      }

      console.log(`   🎯 Found ${ccTasks.length} task(s) with #cc tag`);

      // 5. Bearbeta varje task
      for (const task of ccTasks) {
        console.log(`\n   Processing task ${task.id}: "${task.content}"`);

        try {
          // Hämta task details (för att få notes/context)
          const taskDetails = await checkvist(
            `/checklists/${checklist.id}/tasks/${task.id}.json?with_notes=true`
          );

          // Bygg context från notes
          let context = '';
          if (taskDetails.notes && taskDetails.notes.length > 0) {
            context = taskDetails.notes.map(note => note.comment).join('\n');
          }

          // Fråga Claude
          console.log('   🤖 Asking Claude...');
          const response = await askClaude(task.content, context);

          // Posta som kommentar
          console.log('   💬 Posting response as comment...');
          await checkvist(`/checklists/${checklist.id}/tasks/${task.id}/comments.json`, {
            method: 'POST',
            body: JSON.stringify({ comment: { comment: response } }),
          });

          // Uppdatera tag från #cc till #cc-svar
          console.log('   🏷️  Updating tag to #cc-svar...');
          const newTags = task.tags_as_text
            .replace('cc', 'cc-svar')
            .trim();

          await checkvist(`/checklists/${checklist.id}/tasks/${task.id}.json`, {
            method: 'PUT',
            body: JSON.stringify({ task: { tags: newTags } }),
          });

          console.log('   ✅ Done!');
          totalProcessed++;

        } catch (error) {
          console.error(`   ❌ Error processing task ${task.id}:`, error.message);
        }
      }
    }

    console.log(`\n✅ Finished! Processed ${totalProcessed} task(s) with #cc tag`);

  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  }
}

main();
