'use strict';
// ═══════════════════════════════════════════════════════════════
// PERSONALIZED CONTENT — schema + runtime loader interface
//
// This module defines the data shapes for player-specific demo
// content (facts, trials, lures) but does NOT bundle any data with
// source. All content is generated from the player's own local
// workspace at runtime by an archivist-style file reader. Wire
// `loadPlayerFactsFromWorkspace()` to your reader of choice
// (e.g. scanning SOUL.md / MEMORY.md / workspace docs).
//
// Source-controlled files in this repository contain no demo data;
// runtime population is delegated to the consumer.
// ═══════════════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────────────
// SCHEMA
// ───────────────────────────────────────────────────────────────

// PLAYER_FACTS: extracted from the player's workspace by the archivist.
// Each fact:
//   { id: string, source: string (relative path), chunk: string, theme: string }
//
// Themes are coarse buckets the trial/lure generators key on, e.g.:
//   identity | ai_relationship | personal | research | project |
//   values | research_writing | ecosystem | game_design | philosophy |
//   debugging | self_management | design_philosophy
//
// PERSONALIZED_TRIALS: keyed by difficulty (medium | hard).
// Each trial:
//   {
//     prompt: string,               // question shown to the player
//     evidence: string,             // quoted source text shown before the prompt
//     evaluation_guide: string,     // pass/fail criteria for the player's answer
//     confrontation_type: 'good' | 'neutral' | 'hostile',
//     fact_id: string,              // id from PLAYER_FACTS this trial leans on
//   }
//
// PERSONALIZED_LURES: villain temptations that surface player-owned text.
// Each lure:
//   {
//     type: 'BREADCRUMB' | 'BEAUTY_TRAP' | 'REWARD_MIRAGE' | 'FAKE_EXIT',
//     evidence: string,             // text the player sees on the wall / in light
//     source: string,               // relative path it came from
//     villainNarrative: string,     // villain's framing of the evidence
//   }

// ───────────────────────────────────────────────────────────────
// LOADER INTERFACE (stub — wire to your archivist before shipping)
// ───────────────────────────────────────────────────────────────

async function loadPlayerFactsFromWorkspace(workspaceRoot, archivist) {
  // Intended contract:
  //   const facts = await archivist.extractFacts(workspaceRoot);
  //   return facts;  // array of PLAYER_FACTS-shaped objects
  //
  // No facts are bundled with this source file. Without a wired-up
  // archivist this returns an empty array, and the game falls back
  // to its non-personalized trial/lure pools.
  return [];
}

async function generateTrialsFromFacts(facts) {
  // Intended contract: turn each fact into one or more trial objects.
  // Implementation lives with whichever LLM / template engine you use.
  return { medium: [], hard: [] };
}

async function generateLuresFromFacts(facts) {
  // Intended contract: turn each fact into one or more lure objects.
  return [];
}

// ───────────────────────────────────────────────────────────────
// EMPTY DEFAULTS
// Kept exported so existing consumers don't crash on require().
// ───────────────────────────────────────────────────────────────

const PLAYER_FACTS = [];
const PERSONALIZED_TRIALS = { medium: [], hard: [] };
const PERSONALIZED_LURES = [];

module.exports = {
  PLAYER_FACTS,
  PERSONALIZED_TRIALS,
  PERSONALIZED_LURES,
  loadPlayerFactsFromWorkspace,
  generateTrialsFromFacts,
  generateLuresFromFacts,
};
