import { z } from "zod";

import type { Refused } from "./actions.ts";

// Every refusal the api sends, by stable code. The value is the English message with {param} slots; the web translates
// by code (apps/web/messages, namespace `errors`) and falls back to the message the api sent. A test holds the web's
// English and Vietnamese entries to this list, slot for slot. {detail} carries a sentence the engine wrote (English).
export const REFUSALS = {
  // Transport
  badRequest: "{detail}",
  serverError: "Server error",
  unauthorized: "Unauthorized",
  tooManyActions: "Too many actions. Slow down.",
  tooManyPages: "Too many pages. Slow down.",
  importRefused: "Import refused",
  adminKeyWrong: "Wrong admin key",
  // Seats and permissions
  screenReadOnly: "The table screen is read-only",
  notYourCharacter: "Not your character",
  noPermission: "You don't have permission to do that",
  gmOnly: "Only the GM can change that",
  onlySpend: "You can only spend {what}",
  creatorsOnly: "Only creators can start a game",
  linkInvalid: "Invalid or revoked link",
  // Games, sessions
  gameNotFound: "Game not found",
  gameArchived: "This game is archived",
  archiveFirst: "Archive the game before deleting it",
  typeNameToDelete: "Type the game's name to delete it",
  sessionRunning: "A session is already running",
  noSessionRunning: "No session is running",
  sessionNotFound: "Session not found",
  startSessionFirst: "Start a session first",
  sessionPaused: "Start a session to continue",
  noRuleset: "This game has no ruleset yet",
  // Members, invites
  inviteExpired: "This invite has expired or was already used. Ask your GM for a new one",
  inviteNotFound: "Invite not found",
  inviteNeedsAccount: "This invite needs an account. Sign in first",
  inviteNoCharacter: "Invite has no character",
  inviteCharacterLimit: "This invite has made {limit} characters, its limit. Ask your GM for a new one",
  gameCharacterLimit: "This game already has {limit} characters, its limit. Ask your GM to make room",
  onlyInvitePlayers: "You can only invite players",
  pickCharacterToInvite: "Pick a character to invite",
  roomInviteNoCharacter: "A room invite isn't for one character",
  gmSeatNeedsAccount: "A GM seat needs an account",
  signInFirstOrGuest: "Sign in first, or join as a guest",
  signInToKeepDraft: "Sign in to keep a draft",
  signInToTakeOver: "Sign in to take over a room",
  pickOrNameCharacter: "Pick a character, or name a new one",
  characterTaken: "That character is already taken",
  memberNotFound: "Member not found",
  userNotFound: "User not found",
  leaveInstead: "Leave the room instead of removing yourself",
  ownerNotRemovable: "The owner can't be removed; they can hand the room on",
  onlyOwnerRemovesGm: "Only the owner removes a GM or co-GM",
  ownerIsGm: "The owner is always a GM",
  noSeatHere: "You hold no seat here",
  handOnFirst: "Hand the room on before you leave it",
  alreadyOwner: "They already own this room",
  onlyMemberTakesOver: "Only a member can take over the room",
  noOffer: "There is no offer for you to accept",
  // Ruleset and packs
  rulesetNotFound: "Ruleset not found",
  charactersUseOtherVersion: "Characters here already use another version of the ruleset",
  detachPacksFirst: "Detach the packs written for the other ruleset first",
  charactersBuilt: "Characters here are built with this ruleset, so it stays pinned",
  pickRulesetFirst: "Pick the room's ruleset first",
  packNotFound: "Pack not found",
  notAPackId: "Not a pack id",
  packNotAttached: "That pack isn't attached",
  packTakenDown: "This pack was taken down by an admin",
  packDeleted: "This pack is deleted: import it again to use it",
  privatePackGmOnly: "A private pack can only be used in a room you run as GM",
  packWrongRuleset: "This pack is written for another ruleset",
  entryNotInPack: "That entry isn't in a pack attached to this game",
  entryUnreadable: "That entry can't be read",
  notPlaceable: "{name} isn't something that takes a place at the table",
  // Characters and values
  characterNotFound: "Character not found",
  noSuchEntity: 'This ruleset has no "{entity}" to create',
  needTypeFirst: "Ask the GM to create this character with its type first",
  nothingToBuild: "This ruleset has nothing to build for that",
  alreadyBuilt: "Already built. Ask the GM to correct a value",
  buildProblems: "Those answers don't build a character\n{detail}",
  notBuilt: "{name} isn't built for this ruleset yet",
  wholeNumber: "{what} takes a whole number",
  countWholeNumber: "A count takes a whole number",
  setNotAdjusted: "{what} is set, not adjusted",
  takesList: "{field} takes a list",
  badFieldValue: "{field} doesn't take that value",
  fieldInvalid: "{label}: {detail}",
  notACondition: "That isn't a condition",
  notConditionHere: "That isn't a condition on this character",
  conditionGone: "That condition is gone",
  noBounds: "{resource} has no bounds",
  noResourceHere: "This character has no {resource} to change",
  cannotWrite: "That value can't be written",
  cannotRead: "That value can't be read back",
  noField: '{name} has no field "{field}"',
  noCondition: 'No condition "{condition}" in this ruleset',
  lacksCondition: "{name} doesn't have that condition",
  noRest: 'No rest called "{event}"',
  noOperation: 'No operation "{primitive}.{op}"',
  opNoPermission: '"{primitive}.{op}" declares no permission',
  notRunThisWay: '"{primitive}" isn\'t run this way',
  hpThroughDamage: "HP changes through damage and heal",
  // The engine's own refusals (rules-engine RefusalCode): {detail} is the engine's sentence.
  unknownPrimitive: "{detail}",
  unknownOp: "{detail}",
  badParams: "{detail}",
  badInput: "{detail}",
  unknownActor: "{detail}",
  unknownResource: "{detail}",
  noEncounter: "{detail}",
  wrongState: "{detail}",
  outOfTargets: "{detail}",
  // Codex
  entryNotFound: "Entry not found",
  needSecretsScope: "GM notes need the secrets scope",
  giveTitle: "Give the entry a title",
  pickAudience: "Pick who sees it",
  // Undo
  nothingToUndo: "Nothing to undo",
  cantUndoKind: "Can't undo that kind of step yet",
  undoGone: "Can't undo: {target} is gone.",
  undoChanged:
    "Can't undo: {target} changed after this step (now {now}, the step left {left}). Undo the later steps first.",
  // Encounters
  noEncounterRunning: "No encounter is running",
  encounterRunning: "An encounter is already running",
  alreadyInFight: "{name} is already in the fight",
  notInFight: "That isn't in the fight",
  combatantNotInFight: "That combatant isn't in the fight",
  rerollUnsupported: "This ruleset re-rolls initiative every round, which the tracker doesn't run yet",
  nobodyActed: "Nobody has acted yet",
  firstTurn: "This is the first turn of the fight",
  alreadyFirst: "Already first",
  alreadyLast: "Already last",
  notSeated: "This ruleset has no first player to set",
  phaseStart: "Use Undo to go back a phase",
  noSuchPhase: "That phase is not in this ruleset",
  notSimultaneous: "Only in a phase played at once",
  alreadyDone: "Already done",
  noScoring: "This game has no scoring",
  coopNoScore: "A cooperative game has no scores to correct",
  resultNotFound: "Result not found",
  noSeatedScores: "No initiative scores in seat order",
  sameInitiativeOnly: "Only combatants with the same initiative swap places",
  roundWholeNumber: "The round is a whole number",
  turnSetNotAdjusted: "The {turn} is set, not adjusted",
  orderFromInitiative: "The order is set from the initiative scores in the tracker",
  // Tests
  noSuchTest: 'No Test "{test}" in this ruleset',
  testNotHere: "That Test isn't at this table",
  testClosed: "That Test is closed",
  testProblem: "{detail}",
  callProblem: "{name}: {detail}",
  poolNoAdvantage: "A Dice pool has no advantage",
  cantCallTest: "Couldn't call the Test",
  notCalled: "That character wasn't called",
  alreadyReported: "Already reported. Ask the GM if it needs to change",
  badAdvantage: '"{advantage}" isn\'t advantage, disadvantage or none',
  // Books, relayed to the player who asked
  bookScreenNone: "The table screen shows no book pages.",
  bookNotServed: "The GM isn't serving that book.",
  bookBusy: "The GM's tablet is busy. Try again in a moment.",
  bookNoReply: "No reply from the GM's tablet.",
  bookMalformed: "That page request is malformed.",
  bookRenderFailed: "The GM's tablet couldn't render it.",
} as const;

export type RefusalKey = keyof typeof REFUSALS;
export const RefusalKey = z.enum(Object.keys(REFUSALS) as [RefusalKey, ...RefusalKey[]]);

/** Values that fill the {slots}: names and numbers, never markup. */
export type RefusalParams = Record<string, string | number>;
// A relayed refusal (from the GM's tablet) is untrusted: short values only.
export const RefusalParamsSchema = z.record(z.string().max(40), z.union([z.string().max(200), z.number()]));

/** The refusal as it travels: a socket ack, or the body of a REST error. `message` is the English text. */
export type RefusalBody = { code: RefusalKey; message: string; params?: RefusalParams };

export function refusalMessage(code: RefusalKey, params?: RefusalParams): string {
  return REFUSALS[code].replace(/\{(\w+)\}/g, (slot, name: string) => String(params?.[name] ?? slot));
}

export function refusalBody(code: RefusalKey, params?: RefusalParams): RefusalBody {
  return params ? { code, message: refusalMessage(code, params), params } : { code, message: refusalMessage(code) };
}

/** A refused ack: the body plus `error`, the same text for older web builds. */
export function refused(code: RefusalKey, params?: RefusalParams): Refused {
  const body = refusalBody(code, params);
  return { ok: false, error: body.message, ...body };
}
