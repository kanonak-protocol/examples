#!/usr/bin/env node
// Evaluates every rb.Question in a Kanonak workspace against the rule bases it
// reaches, prints the reasoning, and checks each answer against the question's
// expectedAnswer and expectedGrounds. The meaning of each term is the one
// documented on it in example.org/rule-bases.
//
//   node evaluator/evaluate.mjs [workspace] [--offline]
//
// Exits 1 when any question's answer differs from what it expects.

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const RB = 'example.org/rule-bases/';
const RDFS_LABEL = 'kanonak.org/core-rdf/label';
const AFFIRMS = RB + 'affirms';
const DENIES = RB + 'denies';

async function loadSdk() {
  try {
    return await import('@kanonak-protocol/sdk');
  } catch {
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    for (const dir of ['@kanonak-protocol/cli/node_modules/@kanonak-protocol/sdk', '@kanonak-protocol/sdk']) {
      const entry = join(root, dir, 'dist', 'index.js');
      if (existsSync(entry)) return import(pathToFileURL(entry).href);
    }
    throw new Error('Cannot find @kanonak-protocol/sdk. Install it with: npm install -g @kanonak-protocol/cli');
  }
}

const localName = (uri) => uri.slice(uri.lastIndexOf('/') + 1);
const flip = (polarity) => (polarity === AFFIRMS ? DENIES : AFFIRMS);

// Dates are xsd.date lexical forms (YYYY-MM-DD), which order correctly as strings.
function addDuration(date, duration) {
  const parts = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?$/.exec(duration ?? '');
  if (!parts) throw new Error(`Unsupported xsd.duration '${duration}'; only PnYnMnD is handled.`);
  const [year, month, day] = date.split('-').map(Number);
  const months = year * 12 + (month - 1) + Number(parts[1] ?? 0) * 12 + Number(parts[2] ?? 0);
  const y = Math.floor(months / 12);
  const m = months % 12;
  const lastDayOfMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const result = new Date(Date.UTC(y, m, Math.min(day, lastDayOfMonth) + Number(parts[3] ?? 0)));
  return result.toISOString().slice(0, 10);
}

function previousDay(date) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// The last day of a period: the day before the same date one period later.
const lastDayOf = (start, period) => previousDay(addDuration(start, period));

class Graph {
  constructor(triples) {
    this.index = new Map();
    for (const { s, p, o } of triples) {
      if (!this.index.has(s)) this.index.set(s, new Map());
      const props = this.index.get(s);
      if (!props.has(p)) props.set(p, []);
      props.get(p).push(o);
    }
  }

  objects(s, p) {
    return this.index.get(s)?.get(p) ?? [];
  }

  uris(s, p) {
    return this.objects(s, p).filter((o) => o.kind === 'uri').map((o) => o.key);
  }

  uri(s, p) {
    return this.uris(s, p)[0];
  }

  literal(s, p) {
    return this.objects(s, p).find((o) => o.kind === 'literal')?.lexical;
  }

  label(s) {
    return this.literal(s, RDFS_LABEL) ?? localName(s);
  }
}

class Evaluator {
  constructor(graph, reasoning) {
    this.g = graph;
    this.reasoning = reasoning;
    this.rules = reasoning.getInstancesOfClass(RB + 'Rule');
    this.memo = new Map();
    this.inProgress = new Set();
  }

  evaluate(caseUri, proposition, date) {
    const key = `${caseUri} ${proposition} ${date}`;
    if (this.memo.has(key)) return this.memo.get(key);
    if (this.inProgress.has(key)) return { answer: RB + 'neither', grounds: [], outcomes: [], cyclic: true };
    this.inProgress.add(key);

    const g = this.g;
    const outcomes = this.rules
      .filter((rule) => g.uri(rule, RB + 'conclusion') === proposition)
      .sort()
      .map((rule) => ({ rule, ...this.fire(rule, caseUri, date) }));

    const fired = outcomes.filter((o) => o.fired);
    for (const o of fired) {
      if (g.uri(o.rule, RB + 'strength') === RB + 'strict') continue;
      const winner = fired.find((x) => x !== o && g.uris(x.rule, RB + 'defeats').includes(o.rule));
      if (winner) o.defeatedBy = winner.rule;
    }

    const live = fired.filter((o) => !o.defeatedBy);
    const reserved = live.filter((o) => g.uri(o.rule, RB + 'reservedTo'));
    const unreserved = live.filter((o) => !g.uri(o.rule, RB + 'reservedTo'));
    const strict = unreserved.filter((o) => g.uri(o.rule, RB + 'strength') === RB + 'strict');
    const deciding = strict.length > 0 ? strict : unreserved;
    const pro = deciding.filter((o) => o.polarity === AFFIRMS);
    const con = deciding.filter((o) => o.polarity === DENIES);

    let answer = 'neither';
    let grounds = [];
    if (pro.length && con.length) [answer, grounds] = ['both', [...pro, ...con]];
    else if (pro.length) [answer, grounds] = ['supported', pro];
    else if (con.length) [answer, grounds] = ['refuted', con];

    const dissent = reserved.filter((o) =>
      answer === 'supported' ? o.polarity === DENIES : answer === 'refuted' ? o.polarity === AFFIRMS : true,
    );
    if (dissent.length) [answer, grounds] = ['needs-judgment', dissent];

    const result = { answer: RB + answer, grounds: grounds.map((o) => o.rule), outcomes };
    this.inProgress.delete(key);
    this.memo.set(key, result);
    return result;
  }

  established(caseUri, proposition, date) {
    if (this.g.uris(caseUri, RB + 'establishes').includes(proposition)) return true;
    return this.evaluate(caseUri, proposition, date).answer === RB + 'supported';
  }

  fire(rule, caseUri, date) {
    const g = this.g;
    const provision = g.uri(rule, RB + 'basedOn');
    const from = g.literal(provision, RB + 'inForceFrom');
    const until = g.literal(provision, RB + 'inForceUntil');
    if (!from || date < from) return { fired: false, why: `${g.label(provision)} not yet in force (from ${from})` };
    if (until && date > until) return { fired: false, why: `${g.label(provision)} no longer in force (until ${until})` };

    const missing = g.uris(rule, RB + 'premise').filter((p) => !this.established(caseUri, p, date));
    if (missing.length) return { fired: false, why: `not established: ${missing.map((p) => g.label(p)).join(', ')}` };

    const polarity = g.uri(rule, RB + 'polarity');
    if (this.reasoning.isInstanceOf(rule, RB + 'DeadlineRule')) return this.deadline(rule, caseUri, polarity);
    if (this.reasoning.isInstanceOf(rule, RB + 'PeriodTransition')) return this.transition(rule, caseUri, polarity);
    return { fired: true, polarity, note: g.label(provision) };
  }

  caseDates(deadlineRule, caseUri) {
    const g = this.g;
    const runsFrom = g.uri(deadlineRule, RB + 'runsFrom');
    const measuredAt = g.uri(deadlineRule, RB + 'measuredAt');
    const start = g.literal(caseUri, runsFrom);
    const at = g.literal(caseUri, measuredAt);
    const absent = [!start && runsFrom, !at && measuredAt].filter(Boolean);
    return { start, at, measuredAt, absent };
  }

  verdict(polarity, at, last, measuredAt, detail) {
    const ran = at > last;
    const when = `${this.g.label(measuredAt).toLowerCase()} ${at} is ${ran ? 'after' : 'within'} the period`;
    return { fired: true, polarity: ran ? polarity : flip(polarity), note: `${detail}; ${when}` };
  }

  deadline(rule, caseUri, polarity) {
    const { start, at, measuredAt, absent } = this.caseDates(rule, caseUri);
    if (absent.length) return { fired: false, why: `case lacks ${absent.map((p) => this.g.label(p)).join(', ')}` };
    const period = this.g.literal(rule, RB + 'period');
    const last = lastDayOf(start, period);
    return this.verdict(polarity, at, last, measuredAt, `${period} from ${start}, last day ${last}`);
  }

  transition(rule, caseUri, polarity) {
    const g = this.g;
    const shortened = g.uri(rule, RB + 'shortenedRule');
    const prior = g.uri(rule, RB + 'priorRule');
    const { start, at, measuredAt, absent } = this.caseDates(shortened, caseUri);
    if (absent.length) return { fired: false, why: `case lacks ${absent.map((p) => g.label(p)).join(', ')}` };
    const entry = g.literal(g.uri(shortened, RB + 'basedOn'), RB + 'inForceFrom');
    if (!(start < entry)) return { fired: false, why: `period began ${start}, not running on ${entry}` };

    const shortPeriod = g.literal(shortened, RB + 'period');
    const priorPeriod = g.literal(prior, RB + 'period');
    const fresh = lastDayOf(entry, shortPeriod);
    const cap = lastDayOf(start, priorPeriod);
    const last = fresh < cap ? fresh : cap;
    const detail = `${shortPeriod} from ${entry} ends ${fresh}, capped by ${priorPeriod} from ${start} ending ${cap}; last day ${last}`;
    return this.verdict(polarity, at, last, measuredAt, detail);
  }
}

function sameSet(a, b) {
  return a.length === b.length && a.every((x) => b.includes(x));
}

async function main() {
  const args = process.argv.slice(2);
  const offline = args.includes('--offline');
  const workspace = resolve(args.find((a) => !a.startsWith('--')) ?? '.');

  const sdk = await loadSdk();
  const repository = await sdk.buildLocalFirstRepository(workspace, undefined, { offline });
  const reasoning = await new sdk.Reasoner().reason(repository);
  const g = new Graph(reasoning.triples());
  const evaluator = new Evaluator(g, reasoning);

  const questions = reasoning.getInstancesOfClass(RB + 'Question').sort();
  let passed = 0;
  let failed = 0;

  for (const q of questions) {
    const caseUri = g.uri(q, RB + 'about');
    const proposition = g.uri(q, RB + 'asks');
    const date = g.literal(q, RB + 'asOf');
    const { answer, grounds, outcomes } = evaluator.evaluate(caseUri, proposition, date);

    console.log(`\n${g.label(q)}`);
    console.log(`  ${q}`);
    console.log(`  case: ${g.label(caseUri)} | asks: ${g.label(proposition)} | as of ${date}`);
    for (const o of outcomes) {
      const status = !o.fired ? 'idle' : o.defeatedBy ? 'defeated' : 'fired';
      const stance = o.fired ? `${localName(o.polarity)}: ${o.note}` : o.why;
      const defeat = o.defeatedBy ? ` [defeated by ${localName(o.defeatedBy)}]` : '';
      console.log(`    ${status.padEnd(9)} ${localName(o.rule).padEnd(28)} ${stance}${defeat}`);
    }
    const cited = grounds.map((r) => `${localName(r)} <- ${g.label(g.uri(r, RB + 'basedOn'))}`);
    console.log(`  answer:   ${localName(answer)}${cited.length ? `\n  grounds:  ${cited.join('\n            ')}` : ''}`);

    const expected = g.uri(q, RB + 'expectedAnswer');
    if (!expected) {
      console.log('  check:    no expected answer');
      continue;
    }
    const expectedGrounds = g.uris(q, RB + 'expectedGrounds');
    if (expected === answer && sameSet(expectedGrounds, grounds)) {
      passed++;
      console.log('  check:    PASS');
    } else {
      failed++;
      console.log(`  check:    FAIL, expected ${localName(expected)} [${expectedGrounds.map(localName).join(', ')}]`);
    }
  }

  console.log(`\n${questions.length} question(s): ${passed} passed, ${failed} failed.`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
});
