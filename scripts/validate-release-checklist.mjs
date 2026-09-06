#!/usr/bin/env node
// AUTH-OPERATIONS-011: "Production readiness MUST be an explicit machine-readable evidence checklist
// covering security configuration, stores, testing, operations, ownership and recovery, never a
// certification or automatic security claim." docs/25-release-readiness-checklist.json is that
// artifact; this script is its freshness/integrity enforcement -- a PR that edits docs/07's release-
// signoff checklist (adds, removes, or reworks an item) without updating the JSON mirror fails here,
// and a JSON edit that claims "verified" without attached evidence fails here too, so the checklist
// can never silently drift from what it claims to cover or be used as a bare, evidence-free
// self-certification.

import { readFileSync } from 'node:fs';

const RUNBOOK_PATH = 'docs/07-administrator-and-operations-runbook.md';
const CHECKLIST_PATH = 'docs/25-release-readiness-checklist.json';
const CHECKLIST_HEADING = '## 15.6 Release signoff (manual evidence only)';
const CHECKBOX_LINE = /^- \[([ x])\] (.+): _+$/;

export function extractRunbookItems(markdown) {
  const startIndex = markdown.indexOf(CHECKLIST_HEADING);
  if (startIndex === -1) throw new Error(`Could not find "${CHECKLIST_HEADING}" in ${RUNBOOK_PATH}.`);
  const afterHeading = markdown.slice(startIndex + CHECKLIST_HEADING.length);
  const nextHeadingIndex = afterHeading.search(/\n#{1,6} /);
  const section = nextHeadingIndex === -1 ? afterHeading : afterHeading.slice(0, nextHeadingIndex);
  const items = [];
  for (const line of section.split('\n')) {
    const match = line.match(CHECKBOX_LINE);
    if (match) {
      items.push({
        description: match[2].trim(),
        status: match[1] === 'x' ? 'verified' : 'unchecked',
      });
    }
  }
  return items;
}

const PLACEHOLDER_TEXT = /^(?:n\/?a|tbd|todo|xxx+|ok|done|complete[d]?|pending|verified|yes|test|placeholder|(.)\1{2,})$/i;

// A single free-text string (a Codex review on this pull request caught) is trivially satisfied by
// any 8+ character placeholder like "completed" or "aaaaaaaa", defeating the "never a certification
// without evidence" guarantee this checklist exists to provide. Structured fields -- who verified it,
// when, and what they actually checked -- are far harder to fake by accident and force a real operator
// to record something concrete rather than an evidence-shaped string.
function evidenceErrors(id, evidence) {
  if (evidence === null || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return [`Item "${id}": status is "verified" but "evidence" must be an object with ` +
      `"verifiedBy", "verifiedAt", and "notes" fields -- a bare string is not accepted.`];
  }
  const errors = [];
  if (typeof evidence.verifiedBy !== 'string' || evidence.verifiedBy.trim().length < 2 || PLACEHOLDER_TEXT.test(evidence.verifiedBy.trim())) {
    errors.push(`Item "${id}": evidence.verifiedBy must be a real operator identifier, not empty or a placeholder.`);
  }
  const verifiedAt = typeof evidence.verifiedAt === 'string' ? new Date(evidence.verifiedAt) : null;
  if (!verifiedAt || Number.isNaN(verifiedAt.getTime()) || verifiedAt.getTime() > Date.now()) {
    errors.push(`Item "${id}": evidence.verifiedAt must be a valid, non-future ISO 8601 timestamp.`);
  }
  if (typeof evidence.notes !== 'string' || evidence.notes.trim().length < 15 || PLACEHOLDER_TEXT.test(evidence.notes.trim())) {
    errors.push(`Item "${id}": evidence.notes must be a real, non-placeholder description (at least 15 ` +
      `characters) of what was actually checked -- not a bare confirmation word.`);
  }
  return errors;
}

export function validateChecklist(runbookMarkdown, checklistJsonText) {
  const errors = [];
  const runbookItems = extractRunbookItems(runbookMarkdown);
  let checklist;
  try {
    checklist = JSON.parse(checklistJsonText);
  } catch (error) {
    return [`${CHECKLIST_PATH} is not valid JSON: ${error.message}`];
  }
  if (!Array.isArray(checklist.items)) {
    return [`${CHECKLIST_PATH}'s "items" must be an array.`];
  }

  const jsonDescriptions = checklist.items.map((item) => item.description);
  if (runbookItems.length !== jsonDescriptions.length) {
    errors.push(`Item count drifted: docs/07 §15.6 has ${runbookItems.length} checklist items, ` +
      `${CHECKLIST_PATH} has ${jsonDescriptions.length}.`);
  }
  const maxLength = Math.max(runbookItems.length, jsonDescriptions.length);
  for (let index = 0; index < maxLength; index += 1) {
    const fromRunbook = runbookItems[index]?.description;
    const fromJson = jsonDescriptions[index];
    if (fromRunbook === undefined) {
      errors.push(`${CHECKLIST_PATH} item ${index} ("${fromJson}") has no matching checkbox in docs/07 §15.6.`);
    } else if (fromJson === undefined) {
      errors.push(`docs/07 §15.6 item ${index} ("${fromRunbook}") has no matching entry in ${CHECKLIST_PATH}.`);
    } else if (fromRunbook !== fromJson) {
      errors.push(`Item ${index} text drifted between docs/07 §15.6 and ${CHECKLIST_PATH}:\n` +
        `    docs/07:  "${fromRunbook}"\n    ${CHECKLIST_PATH}: "${fromJson}"`);
    }
  }

  const comparableLength = Math.min(runbookItems.length, checklist.items.length);
  for (let index = 0; index < comparableLength; index += 1) {
    const runbookStatus = runbookItems[index].status;
    const checklistStatus = checklist.items[index].status;
    if (runbookStatus !== checklistStatus) {
      errors.push(`Item ${index} status drifted between docs/07 §15.6 and ${CHECKLIST_PATH}: ` +
        `docs/07 is "${runbookStatus}" but ${CHECKLIST_PATH} is "${checklistStatus}".`);
    }
  }

  for (const item of checklist.items) {
    if (!item.id || typeof item.id !== 'string') { errors.push(`An item is missing a string "id".`); continue; }
    if (item.status !== 'unchecked' && item.status !== 'verified') {
      errors.push(`Item "${item.id}": status must be "unchecked" or "verified", got ${JSON.stringify(item.status)}.`);
    }
    if (item.status === 'verified') errors.push(...evidenceErrors(item.id, item.evidence));
    if (item.status === 'unchecked' && item.evidence !== null) {
      errors.push(`Item "${item.id}": status is "unchecked" but "evidence" is not null -- an item is either ` +
        `unchecked with no evidence, or verified with real evidence; no ambiguous in-between state.`);
    }
  }

  return errors;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const runbookMarkdown = readFileSync(RUNBOOK_PATH, 'utf8');
  const checklistJsonText = readFileSync(CHECKLIST_PATH, 'utf8');
  const errors = validateChecklist(runbookMarkdown, checklistJsonText);
  if (errors.length > 0) {
    console.error(`Release readiness checklist validation failed (${errors.length} issue${errors.length === 1 ? '' : 's'}):`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log(`Release readiness checklist valid: ${extractRunbookItems(runbookMarkdown).length} items, docs/07 and ${CHECKLIST_PATH} agree.`);
}
