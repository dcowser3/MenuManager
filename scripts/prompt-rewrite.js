#!/usr/bin/env node
/**
 * Weekly Prompt Rewrite (Learning Pipeline v2)
 *
 * Gathers:
 *   - Unconsumed correction_rules from Supabase
 *   - Document pairs (original + approved DOCX) for those submissions
 *   - Current base prompt
 *
 * Sends everything to an LLM which proposes a rewritten prompt.
 * Stores the proposal in the prompt_proposals table for human review.
 *
 * Usage:
 *   npm run prompt:rewrite
 *   node scripts/prompt-rewrite.js
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawnSync } = require('child_process');

// Load env
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { createClient } = require('@supabase/supabase-js');

function getRepoRoot() {
  return path.resolve(__dirname, '..');
}

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY (or SUPABASE_ANON_KEY) are required');
  }
  return createClient(url, key);
}

function resolvePythonBin(repoRoot) {
  const venvPython = path.join(repoRoot, 'services', 'docx-redliner', 'venv', 'bin', 'python');
  if (fs.existsSync(venvPython)) return venvPython;
  return 'python3';
}

function extractCleanMenuText(pythonBin, extractScript, docxPath) {
  if (!fs.existsSync(docxPath)) return null;
  const result = spawnSync(pythonBin, [extractScript, docxPath], {
    encoding: 'utf8',
    timeout: 30000,
  });
  if (result.status !== 0) return null;
  return (result.stdout || '').trim();
}

function getWeekId() {
  const now = new Date();
  const year = now.getFullYear();
  const jan1 = new Date(year, 0, 1);
  const days = Math.floor((now - jan1) / 86400000);
  const week = Math.ceil((days + jan1.getDay() + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function generateDiff(oldText, newText) {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const diff = [];
  const maxLen = Math.max(oldLines.length, newLines.length);

  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];
    if (oldLine === newLine) {
      diff.push(`  ${oldLine || ''}`);
    } else {
      if (oldLine !== undefined) diff.push(`- ${oldLine}`);
      if (newLine !== undefined) diff.push(`+ ${newLine}`);
    }
  }
  return diff.join('\n');
}

async function callLLM(systemPrompt, userPrompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'sk-your_openai_api_key_here') {
    throw new Error('OPENAI_API_KEY is required for prompt rewrite');
  }

  const model = process.env.PROMPT_REWRITE_MODEL || 'gpt-4o';

  // Use fetch (available in Node 18+)
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 16000,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errorBody}`);
  }

  const data = await response.json();
  return {
    content: data.choices[0]?.message?.content || '',
    model: data.model,
    usage: data.usage,
  };
}

async function run() {
  const repoRoot = getRepoRoot();
  const supabase = getSupabase();
  const cycleId = getWeekId();

  console.log(`\nWeekly Prompt Rewrite — Cycle: ${cycleId}`);
  console.log('='.repeat(50));

  // Check for existing proposal this week
  const { data: existingProposal } = await supabase
    .from('prompt_proposals')
    .select('id, status')
    .eq('cycle_id', cycleId)
    .maybeSingle();

  if (existingProposal) {
    console.log(`Proposal already exists for ${cycleId} (status: ${existingProposal.status})`);
    console.log('Delete the existing proposal or wait for next week to regenerate.');
    return;
  }

  // 1. Fetch unconsumed correction rules
  console.log('\n1. Fetching unconsumed correction rules...');
  const { data: rules, error: rulesError } = await supabase
    .from('correction_rules')
    .select('*')
    .is('prompt_cycle_id', null)
    .in('status', ['accepted', 'pending'])
    .order('created_at', { ascending: true });

  if (rulesError) throw new Error(`Failed to fetch correction rules: ${rulesError.message}`);

  const correctionRules = rules || [];
  console.log(`   Found ${correctionRules.length} unconsumed correction rules`);

  if (correctionRules.length === 0) {
    console.log('\nNo new corrections to process. Skipping prompt rewrite.');
    return;
  }

  // 2. Read current base prompt
  console.log('\n2. Reading current base prompt...');
  const qaPromptPath = path.join(repoRoot, 'sop-processor', 'qa_prompt.txt');
  const currentPrompt = await fsp.readFile(qaPromptPath, 'utf8');
  console.log(`   Prompt length: ${currentPrompt.length} chars`);

  // 3. Extract document excerpts for context
  console.log('\n3. Extracting document excerpts...');
  const pythonBin = resolvePythonBin(repoRoot);
  const extractScript = path.join(repoRoot, 'services', 'docx-redliner', 'extract_clean_menu_text.py');
  const submissionIds = [...new Set(correctionRules.map((r) => r.submission_id))];

  const documentExcerpts = [];
  for (const subId of submissionIds.slice(0, 10)) {
    // Try to find document pairs via assets
    const { data: assets } = await supabase
      .from('assets')
      .select('asset_type, storage_path, file_name')
      .eq('submission_id', subId)
      .in('asset_type', ['original_docx', 'approved_docx']);

    if (!assets || assets.length === 0) continue;

    const original = assets.find((a) => a.asset_type === 'original_docx');
    const approved = assets.find((a) => a.asset_type === 'approved_docx');

    let aiText = null;
    let finalText = null;
    if (original?.storage_path) {
      aiText = extractCleanMenuText(pythonBin, extractScript, original.storage_path);
    }
    if (approved?.storage_path) {
      finalText = extractCleanMenuText(pythonBin, extractScript, approved.storage_path);
    }

    if (aiText || finalText) {
      documentExcerpts.push({
        submission_id: subId,
        ai_excerpt: aiText ? aiText.substring(0, 600) : '(not available)',
        final_excerpt: finalText ? finalText.substring(0, 600) : '(not available)',
      });
    }
  }
  console.log(`   Extracted ${documentExcerpts.length} document excerpts`);

  // 4. Build LLM request
  console.log('\n4. Building LLM request...');

  const systemPrompt = `You are a prompt engineer improving an AI menu editor for Richard Sandoval Hospitality (RSH).

You will receive the current QA review prompt, a list of human corrections with reasoning, and sample before/after documents.

Your task: Rewrite the prompt so it would have produced the human-corrected output on the first pass.

Rules:
- Keep the same structure, section numbering, and formatting conventions
- Do NOT remove existing rules unless a correction explicitly contradicts them
- For location-specific rules, add them in a clearly labeled subsection
- Be specific and actionable — not vague guidance
- Preserve all existing allergen, formatting, and severity rules
- At the end, provide a brief analysis of what you changed and why

Format your response as:
=== PROPOSED PROMPT ===
[The full rewritten prompt]
=== END PROPOSED PROMPT ===

=== ANALYSIS ===
[What you changed and why, referencing specific corrections]
=== END ANALYSIS ===`;

  const correctionLines = correctionRules.map((r, i) => {
    const scope = r.is_location_specific
      ? `Location-specific: ${r.location}${r.other_applicable_locations?.length ? ` (also: ${r.other_applicable_locations.join(', ')})` : ''}`
      : 'Universal (all properties)';
    return [
      `${i + 1}. Correction:`,
      `   Original: "${r.original_text}"`,
      `   Corrected: "${r.corrected_text}"`,
      `   Rule: "${r.rule}"`,
      `   Type: ${r.change_type || 'unspecified'}`,
      `   Scope: ${scope}`,
      `   Restaurant: ${r.restaurant_name || 'N/A'}`,
      `   Project: ${r.project_name || 'N/A'}`,
      `   Source: ${r.source} (${r.source === 'system' ? `seen ${r.occurrences}x` : 'human-annotated'})`,
    ].join('\n');
  });

  const docLines = documentExcerpts.map((d) => [
    `### Submission ${d.submission_id}`,
    '**AI Draft (excerpt):**',
    d.ai_excerpt,
    '**Human-Corrected (excerpt):**',
    d.final_excerpt,
    '',
  ].join('\n'));

  const userPrompt = [
    '## Current Prompt',
    currentPrompt,
    '',
    `## This Week\'s Corrections (${correctionRules.length} total)`,
    ...correctionLines,
    '',
    documentExcerpts.length > 0 ? '## Sample Before/After Documents' : '',
    ...docLines,
  ].join('\n');

  console.log(`   Total prompt size: ~${(systemPrompt.length + userPrompt.length).toLocaleString()} chars`);

  // 5. Call LLM
  console.log('\n5. Calling LLM for prompt rewrite...');
  const llmResult = await callLLM(systemPrompt, userPrompt);
  console.log(`   Model: ${llmResult.model}`);
  console.log(`   Tokens: ${llmResult.usage?.total_tokens || 'N/A'}`);

  // 6. Parse response
  const promptMatch = llmResult.content.match(/=== PROPOSED PROMPT ===([\s\S]*?)=== END PROPOSED PROMPT ===/);
  const analysisMatch = llmResult.content.match(/=== ANALYSIS ===([\s\S]*?)=== END ANALYSIS ===/);

  const proposedPrompt = promptMatch ? promptMatch[1].trim() : llmResult.content.trim();
  const llmAnalysis = analysisMatch ? analysisMatch[1].trim() : '';

  if (!proposedPrompt) {
    throw new Error('LLM returned empty proposed prompt');
  }

  console.log(`   Proposed prompt length: ${proposedPrompt.length} chars`);
  console.log(`   Analysis length: ${llmAnalysis.length} chars`);

  // 7. Generate diff
  const promptDiff = generateDiff(currentPrompt, proposedPrompt);

  // 8. Store proposal in Supabase
  console.log('\n6. Storing proposal in Supabase...');
  const dateRange = correctionRules.map((r) => new Date(r.created_at));
  const minDate = new Date(Math.min(...dateRange)).toISOString().split('T')[0];
  const maxDate = new Date(Math.max(...dateRange)).toISOString().split('T')[0];

  const { error: insertError } = await supabase.from('prompt_proposals').insert({
    cycle_id: cycleId,
    current_prompt: currentPrompt,
    proposed_prompt: proposedPrompt,
    prompt_diff: promptDiff,
    correction_rule_count: correctionRules.length,
    submission_count: submissionIds.length,
    date_range_start: minDate,
    date_range_end: maxDate,
    llm_analysis: llmAnalysis,
    llm_model: llmResult.model,
    status: 'pending',
  });

  if (insertError) {
    throw new Error(`Failed to store proposal: ${insertError.message}`);
  }

  // 9. Mark correction rules as consumed
  console.log('7. Marking correction rules as consumed...');
  const ruleIds = correctionRules.map((r) => r.id);
  const { error: updateError } = await supabase
    .from('correction_rules')
    .update({ prompt_cycle_id: cycleId, consumed_at: new Date().toISOString() })
    .in('id', ruleIds);

  if (updateError) {
    console.warn(`Warning: Failed to mark rules as consumed: ${updateError.message}`);
  }

  // 10. Also save locally for reference
  const outDir = path.join(repoRoot, 'tmp', 'prompt-rewrite', cycleId);
  await fsp.mkdir(outDir, { recursive: true });
  await fsp.writeFile(path.join(outDir, 'proposed_prompt.txt'), proposedPrompt);
  await fsp.writeFile(path.join(outDir, 'analysis.txt'), llmAnalysis);
  await fsp.writeFile(path.join(outDir, 'diff.txt'), promptDiff);

  console.log(`\nDone! Proposal stored for cycle ${cycleId}`);
  console.log(`Local files saved to: ${outDir}`);
  console.log('\nReview and approve the proposal at: /learning/prompt-proposal');
}

run().catch((error) => {
  console.error(`\nPrompt rewrite failed: ${error.message}`);
  process.exit(1);
});
