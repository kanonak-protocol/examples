# Rule bases as versioned packages: a Kanonak sketch

A thread on r/semanticweb asked whether you can ship a body of rules the way you
ship a library: name, version, the rules, the source text they model pinned
exactly, and dependencies. You'd then hand it facts and a date and get back an
answer with its reasoning. The thread gave two test cases:

- **French prescription.** A debt falls due in 2000 and the creditor sues in
  2015. Under the 1804 Civil Code the 30-year period is still running, so the
  claim is not time-barred. Under the 2008 reform and its transition rule, five
  years run from 19 June 2008 and end on 18 June 2013, so it is time-barred.
  The question's date picks which text applies.
- **Chess.** After a second illegal move the FIDE Laws say the game is lost.
  Add the fact that the opponent cannot mate, and it is drawn instead. "Lost?"
  then becomes "needs the arbiter", because the arbiter may still declare a
  loss as a penalty.

This folder models both cases with the [Kanonak Protocol](https://kanonak.org),
and includes a small evaluator that answers the questions. Kanonak handles the
packaging: names, versions, pinned imports, content hashes, validation and
rendered pages. The evaluator handles the reasoning, which Kanonak does not
do.

## Kanonak in two minutes

Kanonak is an open protocol for publishing ontologies (classes, properties and
the things they describe) as versioned packages. There is no central registry:
each publisher serves its own packages from its own domain.

- **A package is one YAML file per version**, named `*.kan.yml`. Here,
  `rule-bases/1.0.0.kan.yml` is version 1.0.0 of the `rule-bases` package.
- **Everything has a stable address**, `publisher/package@version/name`. For
  example, `example.org/rule-bases@1.0.0/Rule` is the `Rule` class, and its web
  page is `https://example.org/rule-bases/1.0.0/Rule`.
- **The first key in a file is the package header.** It declares the
  publisher, the version and the imports. Each import gets a short alias that
  is local to that file: in these files `rb.Rule` means "the `Rule` from
  whatever this file imports as `rb`".
- **Schema and data live in separate packages.** A schema defines the model
  (what a `Rule` is). Data packages hold instances of it (actual rules, cases
  and questions).
- **`kanonak validate` resolves every reference.** It fetches imported
  packages over HTTPS. A typo or a missing import is an error, not a silent
  string.

The best way to learn more is the Kanonak skill for Claude Code, described
below. It teaches the protocol and points to the official guides.

## Quick start

You need **Node.js 20 or later** with npm, and internet access the first time
you run (to fetch the kanonak.org packages, which are then cached in
`~/.kanonak`). The commands below work in PowerShell, Git Bash, macOS and
Linux.

**0. Get the example:**

```bash
git clone https://github.com/kanonak-protocol/examples.git
cd examples/versioned-rule-bases
```

Run every command below from this `versioned-rule-bases` folder.

**1. Install the Kanonak CLI** (tested with 6.8.0):

```bash
npm install -g @kanonak-protocol/cli
kanonak --version
```

**2. Validate the packages:**

```bash
kanonak validate --conformance .
```

```
7 file(s) validated. 0 error(s), 0 warning(s), 0 info(s).

Conformance (sh:NodeShape and owl:hasKey evaluation over each document's import closure):
  conforms: true (no findings)
```

Plain `validate` checks that every reference resolves. `--conformance` also
checks the SHACL shapes, such as "every rule cites exactly one provision".
Always use both.

**3. Run the evaluator:**

```bash
node evaluator/evaluate.mjs
```

It takes about ten seconds. For each question it prints every rule that could
apply, whether that rule fired, and why. It then gives the answer, the rules
and articles it rests on, and whether the answer matches what the question
expects:

```
Lost, when the opponent cannot mate?
  example.org/fide-cases/lost-when-no-mate-possible
  case: A second illegal move, opponent cannot mate | asks: Lost by the offender | as of 2024-05-01
    fired     arbiter-may-declare-loss     affirms: FIDE Laws art. 12.9.6
    fired     no-possible-mate-not-lost    denies: FIDE Laws art. 7.5.5
    defeated  second-illegal-move-loses    affirms: FIDE Laws art. 7.5.5 [defeated by no-possible-mate-not-lost]
  answer:   needs-judgment
  grounds:  arbiter-may-declare-loss <- FIDE Laws art. 12.9.6
  check:    PASS
...
7 question(s): 7 passed, 0 failed.
```

It exits with 1 if any answer differs from what its question expects. Add
`--offline` to use only this folder and the local cache.

**4. Browse the packages as web pages:**

```bash
kanonak serve --publisher example.org --watch
```

Open <http://localhost:8080>. Every class, rule, provision and question has
its own page, for example:

- <http://localhost:8080/rule-bases/1.0.0/Rule>
- <http://localhost:8080/french-civil-texts/1.0.0/art-2262-1804>
- <http://localhost:8080/prescription-cases/1.0.0/under-the-current-text>

`--watch` reloads when you save a `.kan.yml` file. Without `--publisher`, the
server runs in open-world mode and the paths gain a publisher segment
(`/example.org/rule-bases/1.0.0/Rule`).

**5. Search by meaning:**

```bash
kanonak search -q "arbiter"
kanonak search -q "limitation period"
```

The first search downloads a small embedding model (about 23 MB) to
`~/.kanonak/models`. Searching itself runs locally.

## Explore with Claude Code and the Kanonak skill

If you are new to Kanonak, the fastest way in is
[Claude Code](https://code.claude.com/docs/en/overview) with the
`kanonak-protocol` skill. The skill teaches the document format, the URI
scheme, the CLI, and where the official modeling guides live, so you can ask
questions instead of reading specs first.

**Install the skill** from this folder (the command comes from the
[kanonak-protocol/skills](https://github.com/kanonak-protocol/skills) repo):

```bash
npx skills add kanonak-protocol/skills --skill kanonak-protocol --agent claude-code
```

This copies the skill into Claude Code's skills folder (`.claude/skills/`).

**Start Claude Code** in this folder and load the skill:

```
/kanonak-protocol learn the kanonak protocol, then walk me through the packages in this folder
```

Some things to ask next:

- "Run the evaluator and explain why 'Lost, when the opponent cannot mate?'
  needs judgment."
- "Show me how a rule is pinned to the exact source text it models."
- "Add a question: a debt due on 1 March 2010, sued on 1 April 2016. Is it
  time-barred? Validate, then run the evaluator."
- "What would it take to publish these packages under my own domain?"

Once installed, Claude can also pick up the skill by itself when you work with
`.kan.yml` files. Typing `/kanonak-protocol` makes sure it is loaded.

## What's in this folder

| Package | Kind | What it holds |
|---|---|---|
| `rule-bases` | schema | The generic model: `Provision`, `Rule`, rule strength (strict or defeasible), priority (`defeats`), rules reserved to an authority, `Case`, `Question`, and the five answers |
| `french-civil-texts` | data | Article wordings from the Code civil and the 2008 reform statute, with in-force dates |
| `prescription-rules` | rule base | The three prescription rules, each citing one article. The texts package is imported at one exact version |
| `prescription-cases` | data | Two debts' facts and four questions with expected answers |
| `fide-law-texts` | data | FIDE Laws of Chess (2023) art. 7.5.5 and 12.9.6 |
| `fide-rules` | rule base | The four chess rules |
| `fide-cases` | data | Two game situations and three questions |
| `evaluator/evaluate.mjs` | program | Answers every question and checks it |

Each chain reads: texts → rules → cases. Every package also imports
`rule-bases`.

Each file is short and readable. A good order is `rule-bases`, then
`fide-rules`, then `fide-cases`.

### How the pieces carry the thread's ideas

- **Rules pinned to source text.** Each rule's `rb.basedOn` names one
  provision, such as `french-civil-texts@1.0.0/art-2262-1804`. Rule packages
  import their texts with `match: '='` (one exact version), and published
  Kanonak versions can never be edited, so the cited wording cannot change
  underneath a rule. `kanonak hash <file>` prints a package's content hash.
- **Two clocks, kept apart.** The package version (`1.0.0`) tracks changes to
  the model. Legal time is data: each provision has `inForceFrom` and
  `inForceUntil`, and each question has an `asOf` date. Both wordings of the
  Civil Code live in one graph, and the question's date chooses between them.
- **Closed rule sets.** Each rule base lists its rules with `owl.oneOf`. That
  makes the set of rules an answer was drawn from explicit, and adding a rule
  means a new version.
- **Answers are not booleans.** They are `supported`, `refuted`, `both`,
  `neither` and `needs-judgment`.

## How the evaluator decides

The meaning of each term is written on it in `rule-bases`, as `rdfs.comment`.
The evaluator implements those comments:

1. **Edition.** A rule can fire only if its provision is in force on the
   question's `asOf` date.
2. **Premises.** A rule fires when all its premises are established: given in
   the case, or supported by another rule.
3. **Deadline rules** compare dates. The period's last day is the day before
   the anniversary, so five years from 19 June 2008 end on 18 June 2013. If the
   case lacks a date, the rule does not fire.
4. **Priority.** A defeasible rule is set aside when a rule that `defeats` it
   also fires. A strict rule cannot be set aside, and it overrides opposing
   defeasible rules.
5. **Answer.** The answer is `supported`, `refuted`, `both` or `neither`
   depending on which rules remain for and against. If a rule reserved to an
   authority (such as the arbiter) disagrees with that result, the answer
   becomes `needs-judgment`.

The evaluator reads the graph through the Kanonak SDK installed with the CLI,
so references resolve exactly as `kanonak validate` resolves them.

## Try it yourself

- **Watch the date pick the edition.** In `prescription-cases/1.0.0.kan.yml`,
  change `under-the-current-text`'s `rb.asOf` to `2008-06-18`. Run the
  evaluator: the 2008 rules go idle, the 1804 rule fires, and the check fails
  because the answer flipped to `refuted`.
- **Watch priority matter.** Change `debt-due-2007`'s `pr.actionBroughtOn` to
  `2013-07-01`. That is after 18 June 2013, so the transition rule now supports
  the bar.
- **Break a citation.** Change a rule's `rb.basedOn` to an article that does
  not exist. `kanonak validate .` names the exact reference it could not
  resolve.
- **Add your own question.** Copy one of the `rb.Question` blocks, give it a
  new kebab-case name, and change the facts or date.

Undo your edits afterwards, or the checks will keep failing.

## Caveats

- **`example.org` is a placeholder publisher.** Nothing here is published. To
  publish, use a domain you control.
- **The source texts were transcribed for a demonstration.** Parts of the FIDE
  wording were checked against the FIDE Handbook; the French articles were not
  checked against Légifrance. Do not rely on them as law.
- **The evaluator is a sketch.**
  - Rules are propositional: "lost by the offender" does not say which player.
  - Deadline and transition rules are understood by the evaluator's code, not
    expressed in the data.
  - Circular premises evaluate to `neither`.
  - Only durations of years, months and days are handled.
- **The day count follows the thread's example**, not a verified reading of
  French law on computing periods.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Cannot find @kanonak-protocol/sdk` | Install the CLI globally (step 1). The evaluator uses the SDK that comes with it. |
| `validate` fails on network errors | Make sure you can reach `https://kanonak.org`. After one successful run, add `--offline`. |
| A page 404s under `kanonak serve` | Without `--publisher example.org`, paths need the publisher first: `/example.org/...`. |
| `search -q` fails with an install hint | Its optional model runtime (`@huggingface/transformers`) is missing. Run the command the hint prints. |
