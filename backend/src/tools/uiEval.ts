/**
 * Accuracy harness: how close does a generated layout get to the hand-written
 * one it is meant to replace?
 *
 * For each captured golden (see golden.ts) it pulls out the data model, hands
 * the uiAgent the same data plus a one-sentence goal, and scores what comes
 * back. The goal deliberately says what the screen is *for* and which actions
 * exist — never how to arrange it. Describing the arrangement in prose would
 * just be hand-writing the screen again in a different language, and would
 * make the score meaningless.
 *
 * Run: npx tsx src/tools/uiEval.ts [--runs=3] [--only=flights,portfolio]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ComponentDef, Envelope } from '../types';
import { validateLayout, _internals } from '../orchestrator/uiAgent';
import { generateJSON } from '../llm';

const GOLDENS = join(__dirname, '../../goldens');
const OUT = join(GOLDENS, 'generated');

/** What each screen is for, and what it may do. Not how it should look. */
const GOALS: Record<string, string> = {
  flights: 'The traveller searched for flights. Show them the options so they can compare and pick one. Available action: selectFlight, context { flightId }.',
  hotels: 'The traveller searched for hotels in a city. Show them the options so they can compare and pick one to see its rooms. Available action: viewRooms, context { hotelId }.',
  rooms: 'The traveller picked a hotel and is choosing a room for a stay with known dates and guests. They must be able to review the hotel, compare rooms, adjust the booking details, and book. Available action: bookRoom, context { roomId, checkIn, checkOut, adults, children }.',
  trip: 'The traveller has booked a trip. Show them a confirmation summary of everything booked and what it cost.',
  doctors: 'The patient described a symptom and needs to choose a doctor. Show the matching doctors so they can compare and pick one. Available action: viewDoctor, context { doctorId }.',
  doctorBookingForm: 'The patient picked a doctor and now has to book an appointment. Collect the patient details the booking needs and let them confirm. The confirm button must not work until name, phone, date and time are filled in. Available action: confirmAppointment, context { doctorId, patientName, patientAge, patientGender, patientPhone, patientEmail, reason, preferredDate, preferredTime }.',
  portfolio: 'The user asked for their financial portfolio. Give them a dashboard of where they stand: income, spending, how it splits, how it has moved over six months, what they spent recently, and progress towards their savings goals.',
  myRecords: 'The user asked to see their saved travel plans. Show the plans so they can pick one to open. Available action: viewRecordDetail, context { recordId }.',
  appointments: 'The user asked to see their upcoming doctor appointments. Show them each appointment clearly enough to act on.',
};

/* ------------------------------ golden I/O ------------------------------ */

function setPath(obj: any, path: string, value: any) {
  const parts = path.split('/').filter(Boolean);
  if (!parts.length) { Object.assign(obj, value); return; }
  let cur = obj;
  for (const p of parts.slice(0, -1)) cur = (cur[p] ??= {});
  cur[parts[parts.length - 1]] = value;
}

function loadGolden(name: string): { data: any; components: ComponentDef[] } {
  const envelopes: Envelope[] = JSON.parse(readFileSync(join(GOLDENS, `${name}.json`), 'utf8'));
  const data: any = {};
  let components: ComponentDef[] = [];
  for (const env of envelopes) {
    if ('updateDataModel' in env) setPath(data, env.updateDataModel.path ?? '', env.updateDataModel.value);
    if ('updateComponents' in env) components = env.updateComponents.components;
  }
  return { data, components };
}

/* ------------------------------- scoring ------------------------------- */

function typeCounts(components: ComponentDef[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of components) m.set(c.component, (m.get(c.component) ?? 0) + 1);
  return m;
}

/** Weighted Jaccard over component-type counts: 1.0 means the same mix of
 * components in the same proportions, regardless of ids or ordering. */
function typeSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let inter = 0, union = 0;
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(k) ?? 0, y = b.get(k) ?? 0;
    inter += Math.min(x, y);
    union += Math.max(x, y);
  }
  return union === 0 ? 1 : inter / union;
}

/** Every data field a layout actually puts on screen, by leaf name — the
 * "did it show the same facts" measure, and the one that matters most. */
function boundFields(components: ComponentDef[]): Set<string> {
  const out = new Set<string>();
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    for (const [k, v] of Object.entries(n)) {
      if (k === 'path' && typeof v === 'string') {
        const leaf = v.split('/').filter(Boolean).pop();
        if (leaf && !/^\d+$/.test(leaf)) out.add(leaf);
      } else walk(v);
    }
  };
  components.forEach(walk);
  return out;
}

function maxDepth(components: ComponentDef[]): number {
  const byId = new Map(components.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const depth = (id: string): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    const c = byId.get(id);
    if (!c) return 0;
    const kids: string[] = [];
    const ch = (c as any).children;
    if (Array.isArray(ch)) kids.push(...ch.filter((k) => typeof k === 'string'));
    else if (ch?.componentId) kids.push(ch.componentId);
    if (typeof (c as any).child === 'string') kids.push((c as any).child);
    const panels = (c as any).panels;
    if (panels) kids.push(...Object.values(panels).filter((v): v is string => typeof v === 'string'));
    const d = kids.length ? Math.max(...kids.map(depth)) : 0;
    seen.delete(id);
    return d + 1;
  };
  return depth('root');
}

/** Actions the golden fires, and whether the generation wired them up too —
 * a screen that renders beautifully but drops the Book button is a failure. */
function actionNames(components: ComponentDef[]): Set<string> {
  const out = new Set<string>();
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if ((n as any).event?.name) out.add(String((n as any).event.name));
    Object.values(n).forEach(walk);
  };
  components.forEach(walk);
  return out;
}

/* ------------------------------ the run ------------------------------ */

interface Score {
  /** False when the model returned nothing at all — a 403, a rate limit, a
   * timeout. That is an infrastructure failure, NOT a layout-quality result,
   * and the report must never average the two together. */
  generated: boolean;
  surface: string; run: number; valid: boolean; errors: string[];
  nodes: number; goldenNodes: number; depth: number; goldenDepth: number;
  typeSim: number; fieldCoverage: number; missingFields: string[]; actionsKept: string;
}

/** Providers meter tokens per minute, and one generation costs a few thousand.
 * Without pacing the later surfaces fail on rate limit and get scored as if the
 * model had produced a bad layout, which would make the whole report a lie. One
 * retry covers a limit we still manage to trip. Tune with --delay. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function scoreOne(surface: string, run: number, delayMs: number): Promise<Score> {
  const { data, components: golden } = loadGolden(surface);
  const goal = GOALS[surface];

  // The LLM layer caches on (instructions, userContent), so repeat runs need a
  // distinguishing line or every run returns byte-identical output and the
  // variance column is a lie.
  const userContent = [
    `GOAL\n${goal}`,
    `DATA MODEL (shape — bind against these paths)\n${JSON.stringify(_internals.shapeOf(data), null, 2)}`,
    run > 1 ? `\n(generation attempt ${run})` : '',
  ].join('\n\n');

  let result = await generateJSON<{ components: ComponentDef[] }>(_internals.INSTRUCTIONS, userContent, 60_000);
  if (!result?.components) {
    await sleep(delayMs * 2);
    result = await generateJSON<{ components: ComponentDef[] }>(_internals.INSTRUCTIONS, `${userContent}\n`, 60_000);
  }
  const gen = result?.components ?? [];
  const { ok, errors } = gen.length ? validateLayout(gen, data) : { ok: false, errors: ['no output from model'] };

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${surface}.run${run}.json`), `${JSON.stringify(gen, null, 2)}\n`);

  const goldenFields = boundFields(golden);
  const genFields = boundFields(gen);
  const missing = [...goldenFields].filter((f) => !genFields.has(f));
  const goldenActions = actionNames(golden);
  const genActions = actionNames(gen);

  return {
    generated: gen.length > 0,
    surface, run, valid: ok, errors,
    nodes: gen.length, goldenNodes: golden.length,
    depth: gen.length ? maxDepth(gen) : 0, goldenDepth: maxDepth(golden),
    typeSim: typeSimilarity(typeCounts(gen), typeCounts(golden)),
    fieldCoverage: goldenFields.size ? (goldenFields.size - missing.length) / goldenFields.size : 1,
    missingFields: missing,
    actionsKept: `${[...goldenActions].filter((a) => genActions.has(a)).length}/${goldenActions.size}`,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const runs = Number(args.find((a) => a.startsWith('--runs='))?.split('=')[1] ?? 1);
  const only = args.find((a) => a.startsWith('--only='))?.split('=')[1]?.split(',');
  const surfaces = Object.keys(GOALS).filter((s) => (!only || only.includes(s)) && existsSync(join(GOLDENS, `${s}.json`)));

  const delayMs = Number(args.find((a) => a.startsWith('--delay='))?.split('=')[1] ?? 35_000);
  const scores: Score[] = [];
  let first = true;
  for (const s of surfaces) {
    for (let run = 1; run <= runs; run++) {
      if (!first) await sleep(delayMs);
      first = false;
      process.stdout.write(`  ${s} run ${run}… `);
      const score = await scoreOne(s, run, delayMs);
      scores.push(score);
      console.log(score.valid ? 'ok' : `INVALID (${score.errors.length} errors)`);
    }
  }

  const pct = (n: number) => `${Math.round(n * 100)}%`;
  console.log(`\n${'surface'.padEnd(20)}${'valid'.padEnd(8)}${'nodes'.padEnd(12)}${'depth'.padEnd(10)}${'type-sim'.padEnd(10)}${'fields'.padEnd(9)}actions`);
  console.log('-'.repeat(78));
  for (const s of scores) {
    console.log(
      `${`${s.surface}${s.run > 1 ? `#${s.run}` : ''}`.padEnd(20)}` +
      `${(s.valid ? 'yes' : 'NO').padEnd(8)}` +
      `${`${s.nodes} / ${s.goldenNodes}`.padEnd(12)}` +
      `${`${s.depth} / ${s.goldenDepth}`.padEnd(10)}` +
      `${pct(s.typeSim).padEnd(10)}${pct(s.fieldCoverage).padEnd(9)}${s.actionsKept}`,
    );
  }
  // Scored only over runs that actually produced something. A surface the
  // provider refused to answer says nothing about layout quality, so folding it
  // in as a 0% would understate the model and hide the real (infra) problem.
  const produced = scores.filter((s) => s.generated);
  const mean = (pick: (s: Score) => number) =>
    produced.length ? pct(produced.reduce((a, s) => a + pick(s), 0) / produced.length) : 'n/a';
  console.log('-'.repeat(78));
  console.log(
    `${'MEAN (of generated)'.padEnd(20)}` +
    `${(produced.length ? pct(produced.filter((s) => s.valid).length / produced.length) : 'n/a').padEnd(8)}` +
    `${''.padEnd(22)}${mean((s) => s.typeSim).padEnd(10)}${mean((s) => s.fieldCoverage)}`,
  );
  const failed = scores.length - produced.length;
  if (failed) {
    console.log(
      `\n${failed}/${scores.length} runs produced no output at all (provider error, rate limit or timeout)\n` +
      'and are excluded from the means above — see the [llm#N] lines for the reason.',
    );
  }

  for (const s of scores.filter((x) => !x.valid || x.fieldCoverage < 1)) {
    if (s.errors.length) console.log(`\n${s.surface}#${s.run} errors: ${s.errors.slice(0, 5).join(' | ')}`);
    if (s.missingFields.length) console.log(`${s.surface}#${s.run} dropped fields: ${s.missingFields.join(', ')}`);
  }
  writeFileSync(join(OUT, 'scores.json'), `${JSON.stringify(scores, null, 2)}\n`);
}

main();
