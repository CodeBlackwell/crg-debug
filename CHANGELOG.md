# Changelog

All notable changes to the crg-debug plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- **A rejected run of a fix's own new test no longer costs the fix** (`crg-debug.js`). 0.34.1
  set aside an added test command that ran no test only when a baseline command had been
  rejected the same way. On a later run the baseline held just the command that works; the
  agent re-running the gate still ran the wave's new test file as a plain `pytest <file>`,
  which that machine rejects with exit 4, and a fix that was right on all four of its branches
  was put back. An added command that ran no test and names only test files this run's own
  fixers reported is now left out of the verdict and counted as not checked, whatever the
  baseline held: such a command cannot show an existing test breaking. A command that names
  any other file or directory, names a failing test or prints a passed count is judged as
  before.
- **A test command that ran nothing is no longer taken for the starting point of the fix phase**
  (`crg-debug.js`). When a baseline test command exits red and its runner prints no passed
  count, it is run once more without the files that would not load, and the run that prints a
  count becomes the baseline every later gate repeats. On isort two test files import packages
  the image lacks, so pytest stopped before running a test. The script accepted that, the suite
  first ran after wave 1, and 8 tests that fail on the untouched repo were read as broken by
  the fixes: 11 fixes were taken back and five later waves were put back whole, for 30 bugs
  left unfixed. Replaying that run's gate reports against a baseline that ran, waves 2 to 6
  have no new failure. A second attempt that gives no count either leaves the run as it was
  and logs it, since a runner that prints no count cannot be told from one that ran nothing.
  A command that ran no test beside one that did is not run again: it is left out of the
  repeated commands (see Changed), and its exit code is still read.

### Changed
- **A baseline command that ran no test is not repeated after each wave** (`crg-debug.js`).
  When the regression baseline reports one command that ran tests and another the runner
  rejected, only the first is handed to the agent that re-runs the gate, and the log says how
  many were left out. The rejected command's exit code is still read, so the 0.34.1 rule
  works as it did. A baseline in which no command ran a test is kept whole.
- **A merged finding keeps every place it stands for** (`crg-debug.js`). When the merge agent
  groups several findings as one bug, the script keeps the first and used to drop the others
  whole. Where the same defect sat on several lines of one function, the surviving row named
  one of them and the fixer fixed one. The kept row now carries the place and stated cause of
  each row it replaced (`alsoAt`, at most 8 places, 300 characters each), the saved ledger
  holds it, and a fixer's bug row lists them as `alsoReportedHere` (its own file, to check and
  fix) or `alsoReportedElsewhere` (context only). Reviewers see the row as before. Which rows
  are kept and dropped is unchanged: over 71 recorded merges of 4,408 findings the kept rows
  are the same, and 540 of them gain places.
- **A fix run lists the confirmed findings it did not attempt** (`crg-debug.js`, skill). A
  finding one reviewer confirms and the other refuses is saved as confirmed and marked
  `conflicted`, and the fix phase skips it. Until now it was in neither `fix.fixed` nor
  `fix.unfixed`, and one log line was all that said so: on isort 27 of 117 confirmed findings
  went missing from the result that way. Every fix result now carries `fix.conflicted`, each row
  with the refusing reviewer's `conflictNote` and a reason, and the closing line counts them.
  When every confirmed finding is conflicted the fix phase reports `fix.notStarted` instead of
  returning no fix result. Nothing about which findings are fixed has changed.

## [0.34.1] - 2026-11-21

### Fixed
- **The ledger is read and written on a node older than 11** (`crg-debug.js`). The two small
  programs that read and write the ledger called `Array.flatMap`, which node gained in version
  11. They run on the node of the machine that holds the repository, and on one with node
  10.24 a fix run from a saved ledger stopped at its first step with "could not read/parse
  ledger"; a full run there could not have saved its ledger either. Both programs now build
  the same lists with `concat`, and print the same bytes as before on a current node.
- **A test command the runner rejects no longer costs a wave its fixes** (`crg-debug.js`). On
  a project whose test options name a plugin the machine lacks, a plain `pytest <files>` exits
  4 before it runs a test. When the regression baseline held such a command beside one that
  works, the agent re-running the gate ran each wave's new test files in both forms, the
  rejected one was read as a test the fix had broken, and every wave was put back: nine fixes
  in three waves in one run, each of which had passed its own test. A re-run row is now set
  aside when it is not a baseline command, ran no test (red, no test named, no passed count),
  and exited with a code a baseline command already gave the same way before any fix. Such
  rows are logged, counted in `fix.regressionGate.unrun`, and named in the closing line. Any
  other red row is judged as before. Over the gate relays of 30 earlier runs this changes
  three verdicts, the three waves of that run.

## [0.34.0] - 2026-11-19

### Changed
- **"Intentional" defers a finding only when the reviewer cites the line that says so**
  (`crg-debug.js`, methodology). A Verify reviewer who calls a finding intentional now names the
  doc, comment or test line behind the call (`intentEvidence`), and says whether it ran the case
  (`reproduced`) and whether a fix is worth taking (`worth`). The confirm reviewer is skipped
  only after an intentional refute that cites a line; an uncited one no longer ends the review.
  Replaying 91 findings that earlier click runs had deferred, reviewers called 20% of them
  intentional against 84% on 0.33.0, and confirmed 49 against 7, including three planted bugs
  0.33.0 confirmed none of. In a full click run, detection confirmed 8 of 13 planted bugs
  against 4, and the fix run resolved 7 against 5, for about a fifth more spend. The extra
  confirmations are mostly real but minor defects, so Fix gets more work, and on a large repo
  Verify reaches the 1,000-agent limit sooner. A finding called intentional with nothing cited,
  that a reviewer reproduced and rated worth taking, also goes to Fix marked `rescued`; no
  reviewer rated one worth taking in these trials, so that route has not yet fired.

## [0.33.0] - 2026-11-18

### Fixed
- **A run from a saved ledger can read it again** (`crg-debug.js`). 0.32.0's ledger programs
  escaped line-break characters with backslash escapes, and an agent retypes each program into
  a JSON tool call. On a click fix run both reading agents wrote the escapes unescaped, so the
  program no longer parsed, six tries in six, and the run stopped before fixing anything.
  Neither program holds a backslash now; the characters they need are built from their codes.
  0.32.0 is affected on every run started from a saved ledger (`fromLedger`), including
  the detect-then-fix hand-off.
- **Fix-phase agents run tests without a terminal, to a file, under a time limit**
  (`crg-debug.js`). Every fix, gate, regression and checks agent now writes each command to a
  file in its own `mktemp -d` directory and runs it as `timeout 590 sh … < /dev/null > log 2>&1`,
  then reads the log. They no longer pipe a run into `tail`, background it, or wait on and kill
  processes by name. On a click fix run, three regression checks each sat twelve minutes on a
  suite that passes in a second, about 37 of the run's 52 minutes.
- **A fixer's test may not wait for input, and one bug's own test runs under two minutes**
  (`crg-debug.js`). The twelve-minute hangs were a fixer's own test: it opened a
  pseudo-terminal and read it, and whether the read returned depended on timing, so its gate
  passed and later whole-suite runs blocked on it. Fixers are now told a test must never read a
  terminal, stdin or an unwritten pipe without its own timeout, and a bug's gate runs its test
  under a 120 s limit, so a test that can block fails and its bug does not close.
  Measured on the same click ledger, its fix run went from 52 minutes to 12, fixing 49 bugs
  against 48, at the same cost.

## [0.32.0] - 2026-11-16

### Changed
- **Verify runs the refute reviewer first and the confirm reviewer only when it can still
  matter** (`crg-debug.js`). A finding either reviewer calls intentional is deferred whatever
  the other says, so after an intentional refute the confirm reviewer is not started. Every
  finding lands in the bucket it did before; on three recorded click runs this skips 201, 153
  and 60 confirm reviewers, 37 to 44% of reviewer spend. Verify does not take longer: fewer reviewers queue for the same slots. The run logs how many were skipped.
- **Verify reviews in rounds until the agents or the findings run out** (`crg-debug.js`). Each
  round takes the highest-ranked findings that fit with room for both reviewers, so a refute
  is never started without room for its confirm; the agents an intentional refute leaves
  unspent go to the next round. Before, the budget reserved two reviewers per finding up
  front, and a click detection left 93 findings unreviewed with 168 agents unused.

### Added
- **Each stage of `/crg-debug` can run on its own model** (`crg-debug.js`, the skill, the
  methodology). `--discover-model`, `--verify-model` and `--fix-model` put the finders, the
  reviewers and the fix phase on the model named; `--model` keeps its meaning and is the
  fallback for every stage. The Workflow takes them as one arg, `stageModels`, an object keyed
  `graph`, `map`, `discover`, `verify`, `fix` whose values are a model name, or `null` /
  `'session'` to inherit the session model. Every agent runs on the model of the phase it
  belongs to; a phase the map leaves out runs on `model`, and with no map every agent runs on
  the model it ran on before. An unknown key or an unusable value is refused before any agent
  starts, since a mistyped stage would otherwise run on the wrong model and be reported as the
  right one. The two retries that leave the cheap model on purpose (`setup-retry`,
  `map-retry`) still inherit the session model. `fromLedger` and `fromFindings` runs honour
  the same map. Prose mode follows the same rule for its `Agent` calls.
- **The ledger and the Workflow's return record the model of every phase** (`crg-debug.js`):
  `models: {graph, map, discover, verify, fix}`, each a model name or `'session'`, on every
  run, with or without `stageModels`. The ledger's `model` field is unchanged. The opening log
  line lists the five when any of them differs from `model`.
- **Verify can be replayed on its own** (`crg-debug.js`). A new inline arg, `fromFindings`,
  takes up to 200 finding rows from a prior run and verifies exactly those: Graph still runs
  (reviewers query it), Map, Discover and the semantic merge are skipped, the ledger is
  persisted as usual, and the return carries `mode: 'verify-from-findings'`. It cannot be
  combined with `fromLedger` or `fix:true`, and an unusable list is refused whole rather
  than trimmed, so a replay never reviews a finding the original run did not produce.

- **A run from a ledger finishes the review** (`crg-debug.js`, the skill). `fromLedger` no
  longer needs `fix:true`. If the ledger lists findings under `unreviewed`, the run reviews
  them first (the same reviewers, the same rule), moves each row to the bucket it earns and
  saves the ledger again; with `fix:true` it then fixes what is confirmed, and with fix off
  that is all it does (`mode: 'review-from-ledger'`). A ledger with nothing unreviewed goes
  straight to the fix phase as before.
- **The ledger carries its own row counts** (`crg-debug.js`): `counts: {confirmedBugs, deferred,
  rejected, unreviewed}`, written by the script when it builds the ledger and again when a run
  from a ledger saves it. `crg-debug.ledger-slice.mjs` keeps the confirmed count true for the
  ledger it narrows, and adds no `counts` to a ledger that had none.
- **`fixOnly`, for a caller whose bugs were chosen at a gate** (`crg-debug.js`). With
  `fromLedger` and `fix:true`, `fixOnly: true` fixes exactly the ledger's confirmed rows: its
  `unreviewed` rows are not reviewed, are returned as they were, and the file is not rewritten.
  It is refused before any agent starts when it is not a boolean or when the run would not
  fix from a ledger. A run that does not pass it is unchanged.
- **The return says what a run used and whether its ledger was written** (`crg-debug.js`):
  `agents: {started, limit}`, `ledgerSaved`, `unreviewed`, and `stats.deferred`,
  `stats.rejected`, `stats.unreviewed`.

### Changed
- **The reviewer prompt and the survivor rule are now unit-tested helpers** (`reviewerBrief`,
  `bucketVerdicts`) inside the pure-helpers block. No wording or bucketing rule changed: the
  prompt is pinned byte for byte and the precedence between `intentional`, confirm and refute
  is covered branch by branch.
- **Stored reasons are one line of at most 600 characters** (`crg-debug.js`): `deferReason`,
  `refutationReason` and `conflictNote`. The size of the ledger Verify will produce has to be
  known before Verify runs, to set the right number of agents aside for writing it.
- **A run from a ledger returns only the deferred and rejected rows it moved there itself**
  (`crg-debug.js`); the ledger's totals are in `stats`. It used to return every such row,
  which meant relaying them.
- **A sliced ledger carries no unreviewed rows** (`crg-debug.ledger-slice.mjs`). The slice's
  `unreviewed` is empty and its `counts.unreviewed` is 0; the ledger it was cut from is not
  touched. A slice is a choice of bugs to fix, so a fix run from one has nothing to review.
- **Writing the ledger takes two agents where it took one, for a ledger that fits one piece**
  (`crg-debug.js`): the writer, and the command that checks and assembles (`persist:1`,
  `persist:assemble`). Reading a small ledger is still one agent.

### Fixed
- **A ledger row holding U+2028, U+2029 or U+0085 is written and read whole**
  (`crg-debug.js`). JSON leaves those characters raw; JavaScript reads the first two as line
  ends, so the harness split the row inside the agent's brief and the write program's
  pattern stopped at it. Such a row could not reach the disk however it was copied, and on a
  click detection one made the whole ledger write fail. Both ledger programs now escape the
  three characters, which parses back to the same value.
- **A reason over 600 characters is cut at a word and ends `[cut]`** (`crg-debug.js`). A
  reason cut mid-word ("does not apply, becau") was a row the writing agent kept "finishing",
  dropping its closing quote and brace on every retry. Reasons also turn those three
  characters into spaces, like the other line breaks.
- **A commit undone for its message is tried once more** (`crg-debug.js`). On click a commit
  agent added a Co-Authored-By trailer despite the brief; the script undid the commit as
  designed, and a fix that had passed every gate was left uncommitted. A commit whose files
  are right and whose message is not the composed one is now committed once more with the
  same message after the un-commit; a second bad message ends as before ("twice"). Stray
  files still get no second try.
- **A fix whose own test fails once a blamed fix is gone costs that fix, not the wave**
  (`crg-debug.js`). After the regression gate takes the blamed fixers back, a test still
  failing may be one that a standing fix of the same wave wrote, because that fix leaned on a
  change just undone. On click the whole wave of 10 bugs went back for one such test, 8 of
  which broke nothing. When every test still failing is named by a standing bug's own test
  command, that bug's fixer goes back too (no strike, and its retry is not thrash) and the
  gate checks again. The wave goes back whole only for a failure no bug in it owns.
- **One file has one fixer** (`crg-debug.js`). A ledger can name a file both absolute and
  repo-relative, and the fix phase grouped bugs by the raw string, so a live click run put two
  fixers on `core.py` at once. Taking one back for a broken test restored the file under the
  other, its fresh test failed, and the whole wave of 36 bugs went back. Every bug's file is
  now made repo-relative as it enters the fix queue.
- **A test of a bug that did not close never reaches a commit** (`crg-debug.js`, the
  methodology). A live click run committed the tests of eight bugs that never closed: their
  fixers wrote them into a test file a closed sibling declared, the commit staged that file
  whole, and the branch ended red. Those tests then read as newly failing in the next wave
  and cost two fixes that had broken nothing. The fix brief now asks for one new test file
  per bug; after each wave the script puts back the test files of the bugs that did not
  close and drops them from every allowlist, and a closed bug whose test sits in one of them
  is not kept and gets one single-bug attempt (the second time it is unfixed, so it cannot
  loop). A test inline in a source file is left alone.
- **The test of a fix taken back is an open bug's test** (`crg-debug.js`). A bug a wave does
  not keep, whatever took it back, has its test command marked red, so a later wave's
  regression gate does not blame that test on another fix and the final gate files it under
  `openBugTests` rather than `newFailures`.
- **crg-build, crg-ralph and crg-ui check the commit message that landed** (the three
  workflows). The same hole crg-debug had: a commit agent free to append a trailer and a
  script that read back only the files. Each brief now forbids any trailer and asks for
  `git log -1 --format=%B HEAD`; a message that is not the composed one takes the existing
  un-commit path. crg-ui gains the `commitMessageOk` gate it lacked. crg-integrations never
  commits and is unchanged.
- **A run bigger than the Workflow's 1,000 agents no longer loses its findings or its ledger**
  (`crg-debug.js`). A sweep of 300 findings reached the limit inside Verify: the runtime
  refused the remaining reviewers, 70 findings nobody had read were filed as rejected with
  "both reviewers failed to return a verdict", the agent that writes the ledger was refused
  too, and the fix run that followed ingested nothing and fixed nothing. The script now counts
  every agent it starts and never asks for one the run cannot have.
  - Verify reviews as many findings as two reviewers each allow once the ledger write is set
    aside, highest severity first, then highest confidence. The others are returned and
    saved in a new bucket, `unreviewed`, each with `unreviewedReason: 'agent limit'`.
  - A finding whose reviewers both returned nothing is `unreviewed` with `'no verdict'`. It
    is never rejected or deferred: a null verdict is not a verdict. A finding with one live
    reviewer is judged as before.
  - The fix phase starts no wave it could not finish in the worst case with the final gate
    still to run. It keeps the fixers that fit; the bugs left are in `fix.unfixed` with the
    reason `agent limit`, not as failed fixes. When not even one wave fits it does not
    start, and writes nothing.
  - Discover cannot use the agents the ledger write needs: 64 are held back while it runs,
    and a finder past that is not started and is logged as such.
- **The ledger is no longer handed to one agent whole, in either direction** (`crg-debug.js`).
  A live ledger was 409 KB; one agent wrote all of it byte for byte and one agent returned all
  of it. It now travels in pieces of at most 16,000 characters. Agents write a piece, or relay
  what a fixed `node` command printed; the script decides that a write or a read was whole
  from lengths, seals and row counts the agent was never shown. A part that is not what was
  sent is written once more and a piece that fails its seal is read once more; after that
  the write is reported as failed, in the words it always was, and a read that is not whole
  stops the run. The file is written only when the assembled text has the seal the script
  computed, so a failed write leaves whatever was there. A run from a ledger no longer relays
  deferred and rejected rows at all: it counts them, and its re-save lays the changed
  sections over the file. `ledger.json` is still one JSON document with the fields it had,
  plus `unreviewed` and `counts`. `node` must now be on the PATH of the agents' shell.
- **A reader that rewrites one row no longer stops a run from a ledger** (`crg-debug.js`). A
  fix run could not read a 102 KB ledger of 53 confirmed and 42 unreviewed rows: of its seven
  16,000-character pieces one failed its seal on all four attempts over two runs. The agent
  relaying it was not miscopying characters. It wrote the piece out again with one row made to
  look like its neighbours, dropping `"severity":"Low",` from the only row that had it (and
  once adding it to a row that had none), the same way every time, so asking again changed
  nothing and the run stopped with nothing fixed.
  - The read command prints a row to a line, each with its section, its place and a seal
    over all of it. The script checks every row on its own, so a relay that alters one row
    loses that row and keeps the others.
  - Rows travel in batches of at most 16,000 characters. A batch that brings no row is asked
    for once more; after that each row still missing is asked for alone, twice at most.
    Alone, a row has no neighbours to be made to look like.
  - A row that still does not arrive is left out of the run, stays in the file, is logged,
    and is listed in the return's `unread` as `{bucket, index}`. When the run saves the
    ledger again it keeps those rows by place (the write command's new `keep`) and records
    `unread` in the file; before this a row the run did not hold would have been written out
    of the ledger.
  - The run still stops, naming the path, when none of the rows it came for arrived, when
    the toolchain or the baseline failures did not (a fix would be gated against nothing),
    and when it is `fixOnly` and a confirmed row is missing: that caller chose exactly those
    bugs and follows each through fixed or unfixed.
  - `ledger-slice` leaves `unread` out of the ledger it narrows, where the places would
    point at other rows.
  The write direction was left as it was then, and is covered by the next entry.
- **A fix commit carries only the message the script composed** (`crg-debug.js`). A live
  run's commit agent appended `Co-Authored-By: Claude …` to every commit, as its own
  instructions told it to: the brief asked for the message verbatim and the script read
  back only the files that landed. The brief now forbids any trailer, the agent reports
  `git log -1 --format=%B HEAD`, and a commit whose message is not the composed one is
  taken back and reported like a commit with stray files. `crg-build`, `crg-ralph`,
  `crg-ui` and `crg-integrations` commit through agents the same way and are not yet
  checked.
- **A writer that alters one row no longer loses the ledger** (`crg-debug.js`). A sweep of
  281 findings reached the end of Verify and wrote nothing: the agent writing piece 22 of 24
  changed one row of it on both tries, so the piece failed its seal twice, the ledger was
  refused, and the fix run that followed had nothing to read. The ledger is now written as
  it is read, a row to a line, each line carrying its slot, its place and a seal over them
  and the row. The program that puts the parts together keeps every row that came through
  whole and names each that did not; only those are sent again, alone when there are at
  most four of them (with no neighbour to copy from), packed into pieces when there are
  more, at most twice. A retry adds part files and never overwrites one. A written file is
  believed only beside a seal the program prints from the write's own seal. The file on
  disk is unchanged. Writing a ledger now holds back 10 more agents for the retries.
- **Verify no longer discards every verdict** (`crg-debug.js`). A live sweep of 115 findings
  started 230 reviewers, received 230 verdicts, and filed all 115 findings as unreviewed
  with `no verdict`; a run from that ledger did the same again. The script matched each
  finding to its reviewers' answers by the finding object it had sent into `parallel()`,
  and the runtime hands back a copy, so no lookup ever matched. Findings are now matched by
  their place in the list, a number carried out of the thunk (`verdictRows`), and
  `firstToReview` returns places, not findings. The test doubles had returned the very
  objects they were given, which is why the suite could not see it: in every test that
  drives a whole run, `parallel()` now returns a JSON copy, and in the crg-debug run tests
  so does every agent.
- **A proposal carries the fixer's stated ground again** (`crg-debug.js`). The same mistake in
  the fix phase, found once the doubles returned copies: the fixer's result was looked up by
  the array of bugs it had been given, so on a live run `needsDecision[].fixerClaim` always
  read "none given". It is looked up by file.
- **crg-farm and crg-ralph fix only the bugs their gate showed** (the two skills, the farm
  methodology, `crg-debug.farm-bypass.js`). Since a run from a ledger began to review the
  ledger's `unreviewed` findings before fixing, a fix run handed a detection ledger could
  confirm a bug and fix it in the same breath: past GATE-TRIAGE, past the security
  classification, and in the bypass harness on into an unattended draft PR. crg-farm now
  always cuts the ledger to the selection, also when that is every confirmed bug, and every
  fix invocation in crg-farm, crg-ralph and the bypass harness passes `fixOnly: true`. The
  bypass harness's first pass took the detection ledger as it was; its retry ledgers held
  only the unfixed bugs and never carried unreviewed rows.
- **A hollow ledger stops a run from a ledger; it is no longer an empty one** (`crg-debug.js`).
  A fix run was handed a 148 KB ledger of 33 confirmed bugs. The agent that returned it was
  cut off part-way, and on its second try submitted no confirmed rows, no rejected rows and
  one deferred row holding a note that the ledger had not been copied. That satisfied the
  schema, so the run logged "0 confirmed · 1 deferred · 0 rejected" and finished clean with
  nothing fixed. Ingest now stops, with an error that names the path and the reason, when:
  - the answer is not the output of the read command (an object shaped like a ledger is not);
  - the row counts, the count of rows that are findings, or the ledger's own `counts` come
    back without the seal the command printed for those three lines;
  - a row in any bucket has no `file` or no `rootCause`: it is a note, not a finding, and is
    refused rather than counted;
  - the file does not hold the rows its `counts` say it holds, in any bucket;
  - the confirmed and unreviewed rows do not arrive whole.
  The read that reports the counts is asked once more before the run gives up, as each piece
  already was. A ledger written before `counts` existed is accepted on its rows and seals
  alone, and the run logs that it could not be checked against counts. Rows deleted from a
  ledger by hand leave its `counts` false and the ledger refused; `ledger-slice` is the way
  to narrow one. A `ledger-slice` installed before this change does not update `counts`, so
  re-run `bin/crg-deterministic` before crg-farm's next scoped fix.

## [0.31.2] - 2026-08-13

Closes the last vacuous shape of the crg-build wave gate that 0.31.1 left open.

### Fixed
- **An npm-scope package name no longer counts as a gate package** (`crg-build.js`). A
  toolchain row's `package` is a path prefix relative to the app root, so `@acme/web`
  matches no file on disk — it gated nothing while making the toolchain look populated, and
  the wave passed on "nothing in scope". Scope-named rows are discarded, and a toolchain
  left with no usable package holds every wave exactly as an empty one does.

### Added
- **The wave gate says which packages it consulted.** A bare name (`web` where the directory
  is `apps/web`) is indistinguishable from a real prefix — no check can reject it — so build
  mode now logs the gate packages at entry, and every wave that passes on "no package covers
  these files" logs the touched set alongside the packages consulted. A misconfigured
  toolchain reads as a misconfigured toolchain instead of a suspiciously effortless campaign.

## [0.31.1] - 2026-08-13

0.31.0 swept "a dead agent is not a passing verdict" through crg-debug, crg-ralph,
crg-integrations and crg-ui — and missed `crg-build.js`, which had the same defect in the
same place. Found by a review that landed after the release.

### Fixed
- **A dead wave gate no longer commits the wave** (`crg-build.js`). Routing `waveGateAgent`
  through `tryAgent` turned an abort into `wg === null`, and `waveGateClean(wg && wg.results, …)`
  fed that `null` into the branch written for the honest "no package covers these files"
  case. The two are both silence and only one is evidence, so the null case no longer
  reaches the helper.
- **An empty toolchain is unable-to-gate, not gated-and-green** (`crg-build.js`). With no
  toolchain rows, no file is under any package, so *every* wave in the campaign read clean
  and nothing said so. `toolchain` is now `required` in `BUILD_LEDGER_SCHEMA` — an ingest
  agent returning only `gaps` could previously make the whole run's gating vacuous — and an
  empty one is logged once, up front, as the reason waves will be held.
- **A toolchain package of `.` covers every touched file** (`crg-build.js`). Same
  `underFence(f, ['.'])` blind spot fixed in `crg-ralph.js` in 0.31.0: `normPath('.')` is
  `'.'`, which prefix-matches nothing, so the single-package repo — the common case — took
  the vacuous path for every file.
- **A survey whose ledger never persisted now fails loudly** (`crg-build.js`). The write
  agent's result was discarded and `Survey complete: ledger persisted` logged regardless.
  GATE-SPEC shows the human that file and `auto-approve` reads it off disk, so a dead write
  left someone approving a *prior* run's gaps. It now throws, like Phase 0 already does.

### Changed
- `underFence` joins the shared-prelude parity set — it became a byte-identical twin across
  `crg-build.js` and `crg-ralph.js` in 0.31.0 with nothing pinning it.
- The survey brief pointed at a "Toolchain discovery" section of the crg-build methodology
  that did not exist. It exists now, and specifies the contract the wave gate depends on:
  `package` is a path prefix relative to the app root (`.` for the root itself), never a
  package name — `@acme/web` matches nothing on disk and silently gates nothing.

## [0.31.0] - 2026-08-13

One defect class, found in `crg-debug.js` in 0.29.0 and swept through the rest of the
fleet: **`agent()` throws as well as returning `null`**, and every workflow was written as
if it only ever returned `null`. A schema-gated call that exhausts its StructuredOutput
retry cap throws, which walks straight past `if (!x)` guards and `.filter(Boolean)` — so
one serialization glitch could destroy phases that had already succeeded.

Chasing it surfaced a second, closely related class that `tryAgent` alone does not fix: a
contained agent returns `null`, and **a `null` verdict was being read as a passing one**.
A dead gate is not a green gate; a dead commit relay is not a failed commit; an un-commit
that never reported is not an un-commit. Each of those was a place where the script logged
a guarantee it had no evidence for.

### Fixed
- **`agent()` failures are contained in every workflow.** `tryAgent` — one `try/catch` that
  logs and normalizes a throw to `null` — now wraps every top-level call in
  `crg-debug.js` (9 wrappers), `crg-build.js`, `crg-integrations.js`, and `crg-ralph.js`.
  `crg-debug.farm-bypass.js` gets `bestEffort` for its telemetry calls, where a throw in
  pure bookkeeping used to take down a run whose real work had succeeded.
- **A dead wave gate no longer reads as a clean wave** (`crg-ralph.js`). `waveClean` fell
  back to "was anything touched in a gate package?" when the gate reported no rows. That is
  right for a gate with nothing to run and wrong for a gate that died — both are silent.
  A second bug compounded it: `underFence(f, ['.'])` is `false`, so for the common
  single-package repo the fallback said "nothing in scope" for *every* file, and a dead
  wave gate was *always* clean.
- **A dead commit relay no longer reads as "nothing was committed"** (`crg-ralph.js`). The
  commit agent runs `add`/`commit`/`rev-parse` *before* it reports, so the likely shape of a
  failure is a commit that landed with a dead relay — and none of the script's verdicts
  (allowlist, porcelain, message) ever ran on it. The wave now stops and names the branch
  instead of letting later waves stack commits on an unverified one.
- **An un-commit that never reported is recorded as unconfirmed** (`crg-ralph.js`,
  `crg-debug.js`). Both discarded `uncommitAgent()`'s return and logged "un-committed, work
  stays in tree" regardless, leaving a rejected out-of-fence commit on the run branch while
  telling the human it was gone. New shared helper `uncommitOk` gates the claim on the
  reset's own exit code.
- **The crg-ui assemble gate no longer mismatches by construction** (`crg-ui.js`,
  `crg-ui.measure.mjs`). The script cross-checked the tool's ledger seal against the keys it
  measured cell-by-cell, but the tool ingests *every* `*.measure.json` in the captures dir —
  which is never cleaned — so the ledger legitimately held more keys and a correct run was
  thrown away as `assemble-mismatch`. `assemble` now takes `--cells` and ingests exactly the
  cells the run measured. That also closes the real hazard underneath: an orphan capture
  file from a renamed cell used to enter `allKeys`, the no-regression baseline a repair run
  slices, where a stale key makes a genuine new regression read as pre-existing.
- **An unclassified security finding takes the advisory track**
  (`crg-debug.farm-bypass.js`). The check was `!secCheck || !secCheck.securitySensitive`, so
  a classifier that failed outright rejoined the unattended commit → push → public draft PR
  pipeline. Only an affirmative `securitySensitive === false` does now.
- **`--maxTier` is an absolute cap** (`crg-debug.farm-bypass.js`). A model recommending
  `opus` under `--maxTier sonnet` used to run at `opus`; the recommendation is now clamped,
  and the escalation stop compares tier *indices* rather than string equality.
- **An unparseable Figma variables dump reports `unknown`, not `gap`**
  (`crg-ui.prep-figma.mjs`) — "we could not read this" is not the same finding as "this is
  missing", though both still block the packet.

### Changed
- Prelude parity now searches the whole workflow rather than the pure-helpers block. Several
  copies legitimately live below the markers (`isSafeAbs` in three workflows), so the
  block-scoped lookup silently resolved one copy and compared nothing; `found.length < 2` is
  an assertion instead of a skip. `tryAgent` and `uncommitOk` joined the shared-prelude set.

### Added
- ~250 tests (389 total, up from 294 across 33 files). The new resilience suites eval and
  execute the real workflow bodies with faked sandbox globals rather than asserting on
  mocks, and every guard above is mutation-tested: reintroducing the defect fails a test.



`/crg-debug` could not sweep a repo that has no build step — including this one. Found by
pointing it at itself and watching it refuse.

### Fixed
- **An absent build step is no longer read as a broken environment.** The unfarmable bail
  fired on `if (envFailures.length)` — *any* env-kind baseline failure aborted the run. But
  `SETUP_SCHEMA`'s own `kind` description instructs the agent to classify "a build command
  not applicable to this project type (e.g. a plugin/integration never meant to be
  packaged)" as `env`. So the bail was contradicting the schema that produced its input, and
  any repo whose build/typecheck steps are absent *by design* was unsweepable. This repo is
  one: `npm run build` and `npm run typecheck` do not exist, `npm test` is green over 321
  tests, and the run bailed anyway.
  The bail now asks the question that actually matters — **is there still a way to gate a
  fix?** `gateUnusable(toolchain, envFailures)` returns true only when no test command
  exists at all, or when every test command is itself among the env failures. One working
  gate keeps the run alive; the env failures are logged as absent-or-not-applicable steps.
  This does not weaken the tuya-local `uv build` protection it was written for: env-kind
  failures were already excluded from the bug queue upstream (`baselineFailures` is
  code-only), so nothing environmental can be seeded as a bug either way.

### Added
- 5 tests: a missing build step with tests present is survivable, no test command anywhere
  is fatal, a test command that itself failed on env is fatal, one working gate among
  several broken ones suffices, and an empty test string is not a gate.

## [0.29.0] - 2026-08-13

A validated fix wave could be committed in a state that does not build. Found by
inspecting a real wave this harness had just committed, not by reasoning about the code.

### Fixed
- **The wave commit allowlist dropped the supporting files a fix depended on.** `commitWave`
  built its allowlist from `[bugFile(bug), fix.testFile]` only. But a fix legitimately edits
  more than the bug's own file — a shared type, a helper, a barrel export — and the gate
  compiles and runs GREEN with those edits present in the working tree. The commit then
  excluded them, so the branch carried a fix referencing a declaration that never landed:
  ```
  src/pages/SessionReview/SessionReviewPage.tsx(227,34): error TS2339:
    Property 'retention_days' does not exist on type 'PersonalSessionItem'
  ```
  The wave was reported closed, gated, and committed. It did not typecheck. The workflow
  already had what it needed — fix agents return `filesTouched`, and it was being collected
  for the final gate's blast radius (`touchedFiles`) — it simply never reached the commit.
  `filesTouched` is now keyed per bug and threaded into `commitWave`, so a wave commits the
  same file set the gate validated. This stays an allowlist: it widens only for bugs that
  actually **closed**, and only to files the agent **declared**, never to whatever it left
  in the tree. An attempted-but-unclosed bug's edits cannot ride along.
- The allowlist is now the pure helper `waveAllowlist`, inside the tested block per the
  repo's own rule, rather than logic buried in a closure no test could reach.

### Added
- 6 tests: allowlist composition, closed-only widening, line-suffix/absolute-path
  normalisation and dedup, safe degradation on missing maps, agreement with
  `commitFilesOk` (allowlist and post-commit verifier must not disagree, or a legal commit
  gets un-committed as "stray files"), and a structural check that **both** `commitWave`
  call sites thread a support map — mutation-verified to fail when either is dropped.

## [0.28.0] - 2026-08-13

0.27.0 fixed the prose leak where it was first seen, in Phase 1. The very next run hit the
identical defect in Phase 0 and died again — so the diagnosis was right but the fix was
scoped to the symptom rather than the shape. This generalizes it. Suite is 315 tests.

### Fixed
- **The prose leak is now named and mitigated at both load-bearing submits.** The trigger is
  not "two or more properties" as 0.27.0 assumed — it is a **long free-text string property
  immediately followed by an array-of-objects property**. At that boundary the model closes
  the JSON string and reverts to the raw tool-call wire format for the next field, inside the
  string's own value. Observed twice on Haiku 4.5, same day, same shape:
  ```
  {"overview":      "…Risks: …</overview>\n<parameter name=\"targets\">[{…}]"}
  {"resolvedScope": "…1388 nodes.</resolvedScope>\n<parameter name=\"toolchain\">[{…}]"}
  ```
  Phase 0 cannot drop to one property — `graphStats`, `toolchain` and `baselineFailures` are
  all required — so **`SETUP_LEAN_SCHEMA` drops the prose instead**: `resolvedScope`,
  `provisioned` and `containerImage` go, leaving no prose/array boundary to leak at. Scope
  degrades to a full-repo sweep; the other two are reporting, not control flow. Both setup
  schemas share `TOOLCHAIN_ROW` / `BASELINE_ROW`, so a recovered submit is a strict subset of
  the full contract rather than a divergent one.
- **Retries escalate off the model that leaked.** `setup-retry` and `map-retry` now pass
  `model: undefined` to inherit the session model instead of repeating on the cheap default.
  A second attempt at the same shape on the same model that just failed it five times is a
  coin flip. Both retries also carry a shared `PROSE_LEAK` directive naming the actual
  mis-serialization — the harness feedback only ever says "missing property X", which is
  what let the model repeat the identical shape to the cap.
- The Phase 0 retry tells the agent the graph build and baseline are already done, so the
  recovery re-reports rather than re-running a container provision and a full build.

### Added
- 8 more regression tests: `SETUP_LEAN_SCHEMA` is a strict prose-free subset with identical
  `required`, both setup schemas share row identity, both retries escalate the model and
  carry the directive, and two end-to-end cases drive a failing Phase 0 through recovery and
  through double-failure abort against the real workflow body.

## [0.27.0] - 2026-08-13

Two unrelated tracks. A structural pass over `lib/` — judged on DRYness, logical order, and
lean factor — where the duplication turned out to be small (~12 lines) and the real debt was
collided names, misfiled functions, and four files over the 200-line rule. No behavior change
there, and the two riskiest transforms were proven byte-identical rather than argued.

Then a real defect, found the hard way: a `/crg-debug` sweep died at Phase 1 and threw away a
Graph phase that had already succeeded, because one agent could not serialize a two-property
tool call and nothing in the script was written to survive an agent that *throws* rather than
returns `null`. Suite is now 307 tests, all green.

### Added
- **`test/agent-resilience.test.mjs`** — 13 tests pinning the containment contract: both agent
  failure shapes collapse to `null`, a thrown non-`Error` and an absent label are handled, the
  failure is logged rather than swallowed, no bare `await agent(` survives outside the wrapper,
  and the Map fallback's schemas stay single-property and drift-free.

### Changed
- **Every `lib/` filename is now its installed filename.** `ui-measure.mjs` →
  `crg-ui.measure.mjs`, `corpus.mjs` → `crg-agentsmd.corpus.mjs`, and so on for all 24. The
  directory self-sorts by owning command, and because source specifiers already match the
  flattened install, **`bin/crg-deterministic` no longer rewrites a single import with `sed`** —
  it copies `lib/` with one glob. Adding or splitting a lib file no longer requires an enabler
  change, which retires a standing stale-install bug class.
- **One exported name, one meaning across `lib/`.** Four different `validateProfile`
  functions became `validateAppProfile` / `validateMatrixProfile` / `validateRalphProfile` /
  `validateUiProfile`; two unrelated `keyOf`s became `bugKeyOf` / `cellKeyOf`; two unrelated
  `assembleLedger`s became `assembleRulesLedger` / `assembleUiLedger`. `bugKeyOf` was renamed
  on **both** halves of its byte-identical twin with `workflows/crg-debug.js` so the pair stays
  greppable. Zero exported names are now defined in two files.
- **Four oversized files split; every file is under 200 lines.** `ui-measure.mjs` 494 → 134
  (+ `crg-ui.oracle.mjs`, `crg-ui.normalize.mjs`, `crg-ui.seal.mjs`); `ui-prep.mjs` 432 → 175
  (+ `crg-ui.prep-audit.mjs`, `crg-ui.prep-figma.mjs`, `crg-ui.prep-packet.mjs`);
  `ralph-plan.mjs` 224 → 100 (+ `crg-ralph.prd.mjs`, with the 90-line `renderPrd` decomposed
  into three renderers); `corpus.mjs` 217 → 157 (+ `crg-agentsmd.inventory.mjs`). Every CLI
  contract — subcommand names, flags, positional order, stdout shape, exit codes — is unchanged;
  each tool keeps its single dispatcher so no workflow tool path moved.
- **Both crg-ui seals now live in one module, `crg-ui.seal.mjs`.** `sealOf` and `itemsSeal` are
  the two byte-identical workflow twins, so co-locating them puts the parity surface in one file.
  Both bodies verified byte-identical to their pre-split originals.
- **Misfiled functions rehomed.** `pollUntilUp` out of the Figma-pairing file into
  `crg-ui.waitup.mjs`; `scoreUx` out of the profile validator into `crg-build.scoreux.mjs`. The
  `waitup` CLI subcommand stays reachable at the same tool path.
- **`corpus.mjs write-file` no longer overloads its `repoRoot` positional** to mean "target
  path". Same subcommand, same guards, honest variable name.

### Removed
- `computeLift` (an exported, separately-tested name for one subtraction) and `parseShas`
  (exported only to feed the line below it) are inlined. Their coverage was folded into the
  `aggregateLift` and `contaminationClean` tests rather than dropped — the subtraction is now
  pinned on a non-zero case it never had before.

### Fixed
- **A single agent's malformed tool call no longer discards a whole `/crg-debug` run.**
  Observed on a 201-file dashboard sweep: the Map agent JSON-encoded `overview` and then
  appended the raw wire format — `</overview>\n<parameter name="targets">[…]` — *inside that
  string*, so `targets` arrived as prose. Validation rejected it, and the retry feedback
  ("must have required property 'targets'") reported the missing field but never the
  mis-serialization, so the model reproduced the identical shape all five attempts. `agent()`
  then **threw** on the retry cap — and `crg-debug.js` was written throughout as if `agent()`
  only ever returns `null` (`if (!x) throw`, `.filter(Boolean)`), so the throw walked past
  every guard and destroyed a Graph phase that had already succeeded. Three changes:
  - `tryAgent` normalizes both failure shapes to `null` and logs the label + cause. Every
    top-level `agent()` call in `crg-debug.js` routes through it, which makes the guards that
    were already written actually reachable. A structure test enforces that no bare
    `await agent(` survives outside the wrapper.
  - The Map phase falls back to `TARGETS_SCHEMA`, a **single-property** submit. The glitch
    structurally requires two or more properties — there has to be a second `<parameter>` tag
    to leak. Both schemas share one `TARGET_ITEM` row so the fallback cannot drift.
  - Both the fallback trigger and the abort test `targets.length`, not truthiness: a submit
    that validates with `targets: []` is as useless to the finders as a failed one, and
    `if (!map)` alone let it through.
- Ledger persistence reports honestly. It was a fire-and-forget `agent()` whose failure both
  killed the run and, had it not, would have logged a persist that never happened — leaving
  `fix-from-ledger` to silently re-fix a stale ledger.

### Known
- The containment fix is scoped to `workflows/crg-debug.js`. The other seven workflows still
  carry 63 unguarded `await agent(` calls between them (`crg-debug.farm-bypass.js` 15,
  `crg-agentsmd.js` 12, `crg-integrations.js` 11, `crg-ui-prep.js` 9, `crg-ralph.js` 8,
  `crg-build.js` 5, `crg-ui.js` 3) and are exposed to the same class of failure. Calls inside
  `parallel()`/`pipeline()` thunks are already safe — the runtime resolves a throwing thunk to
  `null` — so the exposure is the top-level calls only.
- `crg-build.scoreux.mjs` has no production caller. `/crg-build` Stage 6 describes exactly the
  merge it implements but does the arithmetic in prose instead of invoking it — an inversion of
  the "agents claim, the script decides" rule. Left as a flagged follow-up, not silently fixed.
- `workflows/crg-agentsmd.js` declares an `estTokens` field in its inventory schema that
  `buildInventory` never populates (it returns `trainCommentTokens`). Pre-existing; unrelated to
  the identically-named helper that moved.

## [0.26.0] - 2026-08-12

Structural cleanup across the eight workflow scripts, plus a DRY pass over
`crg-debug.js`. No behavior change was intended; the one real defect found is under
Fixed.

### Added
- **`test/workflow-structure.test.mjs`** — cross-workflow invariants that were previously
  only conventions: `meta.phases` titles match `phase()` calls exactly, the shared prelude
  and `GATE_SCHEMA` stay byte-identical everywhere they are declared, every `*_SCHEMA` is
  declared inside the `pure-helpers` block, that block evaluates standalone, and the
  section spine is present with no duplicate headers. Suite is now 293 tests.

### Fixed
- **Eight phase titles never grouped in the progress display.** `crg-integrations` and
  `crg-ui` declared repair-mode phases as `'Fix (repair)'`, `'Verify (repair)'` and so on
  in `meta.phases` while the code called `phase: 'Fix'`. The runtime matches titles
  exactly, so each ran as an orphan group and the declared entries never lit up. Code now
  uses the declared titles, and the mismatch is a test failure rather than a silent one.

### Changed
- **`normPath` unified on the prefix-safe form.** Three variants existed; the one in
  `crg-ralph` also stripped trailing slashes, which is load-bearing there — Army fences
  name directories (`shared/src/trader_shared/`), and without the strip the containment
  check compares against a doubled separator and quietly matches nothing. That form is
  now canonical everywhere.
- **Same-name-different-contract schemas renamed.** `crg-agentsmd`'s `GATE_SCHEMA` carries
  an extra code-vs-env discriminator and is now `GATE_KIND_SCHEMA`; the function-local
  `GATE_SCHEMA` in `crg-integrations` reports merged clusters and regressions and is now
  `REGRESSION_GATE_SCHEMA`, hoisted alongside the other schemas. `isSafeAbsPath` in
  `crg-debug` is now `isSafeAbs`, matching the other three workflows.
- **Schemas consolidated into the `pure-helpers` block** in all eight workflows (60
  declarations plus the constants they reference), and the section-header spine
  standardized — `crg-ui` and `crg-ui-prep` previously had one header apiece.
- **`crg-debug.js` de-duplicated.** Three ad-hoc groupers collapsed into generic
  `groupBy`/`dedupBy`; `claimedFiles` renamed `assignedFiles` to match the vocabulary
  the finder briefs already use; the residual-pass brief, ledger pointer, prior-failure
  note and containerized-test note extracted to named constants instead of being pasted
  into two briefs apiece; the residual brief's file cap named
  (`RESIDUAL_CLAIMED_CAP`) rather than left as a bare 120. `allGreen` centralizes the
  gate read and keeps the empty-result guard — zero rows is not a pass.
- **`keyOf` parity with `lib/ledger-slice.mjs` is now tested**, not just documented. The
  two are the ledger-slicing identity; drift silently drops bugs from an escalation or
  gate-triage re-fix run.

## [0.25.0] - 2026-07-31

Wave-shape control and honest stop reporting, both earned by the first BUILD run over
the 54-story dogfood PRD.

### Added
- **`maxPerWave` arg** (clamped 1..16, default 8) for both pack sites — the plan-time
  pack and the build loop's per-round repack. It was hardcoded to 4, so widening a wave
  meant editing the script. The default is 8 rather than the ceiling because N is the
  blast radius of one red wave-regression gate: that failure holds back every story in
  the wave *and* stops the build. Measured on the 54-story PRD, returns flatten well
  before the ceiling — N=4 packs 20 waves, N=6 and N=8 pack 17, N=12 and N=16 pack 16.
  The residue is dependency depth and fence collisions, which no cap can widen.

### Fixed
- **A build halted by `dirtyStop` blamed the wave cap.** Every remaining story was
  marked `wave cap (N) reached` even when the loop stopped mid-run with waves to spare,
  sending the reader hunting a limit that was never hit. The recorded reason is now the
  actual one.

### Known gap
- Toolchain commands generate lockfiles (`uv.lock`, `package-lock.json`) that no critic
  predicts, because they are not source files. Unfenced and ungitignored, they read as
  stray edits and trip `dirtyStop` after an otherwise green wave. Workaround: name the
  lockfile in the fence of the story owning its manifest. The principled fix — capture
  the dirty-tree baseline after one toolchain warm-up run, so toolchain output is
  baseline rather than stray — is not implemented here.

## [0.24.1] - 2026-07-31

Three PLAN defects earned by the second `/crg-ralph` dogfood: ingesting a 58-story
hand-authored Army PRD, roughly double the size of the first run's.

### Fixed
- **`maxWaves` was clamped to 12**, silently capping a plan at 48 stories (12 waves x 4
  per wave). A 54-story pack placed 33 and stranded the rest in `deferredByCap` — no
  error, just a quietly truncated plan. The ceiling is now 64; the default stays 8.
- **`packStories` left each story's own `dependsOn` untouched** while resolving its
  internal graph, so the persisted plan disagreed with the graph the packer actually
  used. A dep naming a blocked story dangled and failed `ralph-plan validate` with
  `unknown story id`; edges dropped to break a cycle were likewise persisted as if they
  still constrained order. The resolved graph is now published back onto each story, so
  the plan is self-consistent by construction. The validator's rule was correct and is
  unchanged.
- **The `persist` agent burned two round trips** whenever `plan.json` already existed —
  the write tool rejects an unread file, and the prompt never said to expect one. On a
  120KB plan that is pure latency in the slowest step of PLAN.

## [0.24.0] - 2026-07-21

`/crg-ralph` — the constructive sibling of `/crg-debug` — plus measure-tool fixes
earned by its first dogfood run (SPICE FOREX Phase 1) and the crg-ui runs alongside it.

### Added
- **`/crg-ralph` — graph-compiled Army construction** (the constructive sibling of
  `/crg-debug`; `docs/crg-ralph/design.md` built). PLAN: decompose a feature request —
  or ingest an existing hand-authored Army PRD dir (`PRD.md` + `agents/*-agent.md`) —
  into stories whose predicted touch sets are attacked by a per-story adversarial
  critic, then packed by deterministic JS into dependency-layered, fence-disjoint
  waves with community lanes and hub-first ranking; the plan persists to
  `.crg-ralph/plan.json` (tool-validated by exit code) and feature-mode emits a
  standard Army PRD dir the `ralph` CLI can run unchanged. GATE-PLAN is a hard human
  gate. BUILD: parallel lane builders per wave under prefix-aware fence allowlists
  (Army owned paths are directories) enforced in JS, blind command/browser criteria
  gates whose exit codes the script reads, a strictly-upward model ladder whose
  escalations carry the failed attempt's gate evidence, and a commit per green wave
  (explicit paths, no-attribution message gate, diff-tree ⊆ fence, porcelain
  accounting against the tree baseline) followed by graph re-ingest. The skill then
  composes a crg-debug detect-only sweep over the run's diff, gated fixes via
  `fromLedger`. Never pushes.
- **PRD-ingest fidelity rules shaped by the first dogfood target** (SPICE
  `PRDs/32-forex-phase1`): prose acceptance criteria travel VERBATIM as the builder
  checklist; machine criteria are synthesized honoring the PRD's own wave gates and
  local-test caveats (a suite the PRD says cannot run locally becomes its prescribed
  compile/parse check; deploy/remote-host checks are never synthesized — they surface
  as manual acceptance items); PRD invariants + pinned contracts are fenced into
  every builder brief; declared waves become implicit prior-wave dependencies the
  packer verifies, serializing any within-wave fence overlap the hand-authored plan
  missed.
- `lib/ralph-plan.mjs` (`validate`, `validate-profile`, `emit-prd`) + installed as
  `crg-ralph.plan.mjs`; `workflows/crg-ralph.js`; `skills/crg-ralph/`
  (SKILL.md + methodology.md); enabler installs all three. Tests:
  `test/ralph-plan.test.mjs`, `test/crg-ralph-helpers.test.mjs` (packer, fences,
  ladder, git-plumbing readers extracted from the shipped workflow).

### Fixed
- **crg-ralph dogfood hardening** (first live run, SPICE FOREX Phase 1 — each fix
  earned by a real failure):
  - the human-approved profile toolchain is now authoritative end to end: PLAN
    persists it into plan.json over the setup agent's discovery, BUILD's wave/final
    gates run only its commands, and both story-sourcing prompts receive it as the
    ground truth on what runs locally (the first run's wave gate ran a *discovered*
    `mypy src` the profile had nulled, and the ingester synthesized a pytest
    criterion for a package the profiler had proven locally broken);
  - the wave gate judges the DELTA against plan-time `baselineFailures` (passed in
    by the skill): a failure the gate matches to a known baseline failure is
    reported `preexisting`, never blocking — a red baseline can no longer hold
    every wave hostage after the human knowingly approved building over it;
  - reproduction (TDD RED) now fails only when NO command criterion was observed
    red — a single already-green row (a compile guard on an existing file) is a
    polarity-invalid criterion, not staleness; stale / not-reproduced stories get
    their reported edits restored instead of being trusted to have "touched
    nothing" (the porcelain accounting caught three builders' real edits after
    their stories were killed on one green compile guard);
  - `unbuilt` bookkeeping deduplicated (a red wave gate recorded held stories
    twice: once drained, once dependency-cascaded).
- **crg-ui: phantom-element pairing rejected by the measure tool.** The DOM
  collector now captures `textLength` + `childCount`, and `pairNodes` refuses to
  pair an empty tagged element (no text, no children) with a Figma node that has
  content — a bare `data-component` div at the right coordinates no longer counts
  as the element existing; it stays `missing-element`. Old captures without the
  content fields pair as before. The fix brief states the rule and warns that
  `position:fixed` at the expected box is a new bug, not convergence.
- **crg-ui: nested Figma coordinates normalized correctly.** MCP `get_metadata`
  dumps carry x/y relative to the immediate PARENT, so `normalizeFigma` now
  accumulates ancestor offsets when walking nested children (REST-style dumps
  with `absoluteBoundingBox` still subtract the frame origin). Previously every
  depth≥2 expected box stayed parent-relative, poisoning the ledger's geometry
  deltas for nested nodes.

## [0.23.0] - 2026-07-09

Lessons from the first live `/crg-ui` repair run (SPICE public dashboard), where fix
units consistently escalated and two constructive builds were reverted as false
"regressions". Verified by replaying the run's recorded verify key sets through the
new judge: both class-flip reverts become progress signals, the KPI-strip unit goes
green at sonnet (saving two opus shots), and the one genuinely destructive fix is
still caught.

### Added
- **Escalation carries evidence, everywhere there is a ladder.** In `crg-ui`'s repair
  ladder the escalated tier's brief now includes the failed attempt's verdict
  (unresolved / transitioned / regressed keys, the failed agent's own note) and the
  dirty-tree disclosure — the tree still contains the failed attempt's uncommitted
  edits; inspect, then amend or discard. In the farm bypass, both climb paths pass a
  `priorFailure` evidence blob (non-zero final-gate rows + unfixed reasons) into the
  next `crg-debug` invocation, and `crg-debug` fences it into every fix brief
  (`args.priorFailure`, optional). Pattern source: `crg-integrations`' `priorSig`.
- **Containment unit grouping (`crg-ui`).** Repair units are now union-find over name
  edges PLUS containment edges: a missing-element container's expected box absorbs
  contained discrepancies of any class (creating a container reflows everything inside
  it — one root cause, one fix, one verify). Tolerance-slack epsilon,
  smallest-enclosing-container, deterministic tiebreaks, and a unit-size cap that
  skips (never truncates) oversized merges. The SPICE KPI strip — 1 container + 7
  children as 8 separate units — becomes one unit.
- **Fix briefs point at the on-disk source of truth.** `crg-ui` fix briefs name
  `capture/<slug>.figma.json` (the complete expected geometry), explain
  frame-relative ≡ viewport coordinates and pair-and-be-judged-at-tolerance tagging,
  and warn that earlier units' commits may have changed the live state. `crg-debug`
  briefs name `.crg-debug/ledger.json`, `crg-build` the gap ledger, and
  `crg-integrations` its ledger + normalized matrix.
- Repair args accept `allowlistedKeys` (the measure return now exposes them; `slice`
  prints them with their own `allowlistSeal`) — blessed deviations fold into the
  no-regression baseline so a fix that incidentally materializes an allowlisted node
  is not damage.

### Fixed
- **The class-flip regression trap.** The verify judge (`compareMeasures`) now matches
  regressions by NODE, not class-qualified key. A unit node re-classified by the fix
  (`missing-element` → `layout`: the element now exists but is off) is a *transition*
  — red with feedback to the next tier, never a revert-triggering regression. The
  same flip on a NON-unit baseline node is a tolerated *warning* recorded on the
  unit. A node flipping TO `missing-element` (an existing element destroyed) and any
  brand-new failing node remain regressions. Token/unknown keys keep exact-key
  semantics; keys parse by cell prefix, immune to `::` in token or screen names.
- **A dead subagent no longer kills a run.** The live run died on an unhandled
  `agent({schema}) completed without calling StructuredOutput` throw; every
  sequential repair/measure agent call is now wrapped — a terminal agent error spends
  that tier's shot or fails that cell, and the run continues.
- The end-of-ladder revert now checks out the UNION of every tier's touched files
  (tiers inherit the previous attempt's edits; reverting only the last tier's files
  left earlier edits dirty and tripped the tree-dirty stop).
- One-strike relays hardened: the `assemble` cross-seal gets one retry with a
  sharpened warning (previously immediate `assemble-mismatch`), and the measure /
  prep-scorecard retries now tell the agent it is a retry and why.

## [0.22.0] - 2026-07-09

### Added
- **`/crg-ui-prep` harnessed** — the prep walkthrough gets the same deterministic leg
  as the other four skills, and its output becomes a machine-checked hand-off:
  - *New tool core `lib/ui-prep.mjs`.* Every scorecard status is a computed fact:
    `audit-repo` (framework/dev scripts, `data-component` coverage, raw-hex count
    outside token files, render-seam greps, routes from router source, Storybook,
    graph freshness vs HEAD — non-computable judgments like the auth seam come back
    `unknown` with raw evidence, never guessed), `audit-env` (uv/Playwright by exit
    code; figma `whoami` + DPR supplied by the audit agent), `normalize-figma-audit`
    (frame pairing + exact sizes, variable count, code-token name mirroring via
    `figmaVarToCssVar`, component census, Code Connect coverage — over VERBATIM MCP
    dumps), `scorecard` (merges computed facts into prep.json — `done`/`descoped`/
    `n/a` are settled human decisions and are NEVER downgraded; `unknown` never
    overwrites; sealed over `id=status`), `record` (prep.json's only writer),
    `verify <item>` (one item's audit check as an exit code; `2.5 --captures a,b`
    byte-compares two captures), and `packet` / `verify-packet` (below).
  - *New `workflows/crg-ui-prep.js`.* AUDIT fans out repo+env audits then the figma
    transcription, and the scorecard relay is proven by recomputing its seal from the
    relayed items (mismatch → one retry → `audit-mismatch`). PROPOSE returns one
    structured read-only artifact per gap (rename table, variable map, complete
    unified diff + file list, exact commands) for the skill's wizard gates — item 1.1
    (bootstrap design generation) is never proposed by the harness; the skill owns it
    behind the bless gate. APPLY executes gate-approved proposals passed back
    byte-exact, fences the touched files to the proposal (violation → revert →
    failed), verifies each gap with the prep tool's exit code, and records green
    items via the `record` tool. PACKET assembles and verifies the ready packet.
  - *The ready packet.* `.crg-ui/prep-packet.json` = profile + attestations + pairing
    under ONE FNV-1a seal recomputed from the LIVE files at verify time. `/crg-ui`'s
    Stage 0 now runs `verify-packet` first: exit 0 → intake skipped entirely
    (perfect-user Story 9 as an exit code); any drift in profile, allowlist, prep
    items, or pairing fails the seal and falls back to the normal GATE-PROFILE.
    Profile-critical open items block the packet; cosmetic gaps ride along visibly as
    `openGaps`.
  - *Skill dispatch + dogfood fixes.* `skills/crg-ui-prep/SKILL.md` gains the
    execution-mode dispatch (Workflow when installed, `--prose` fallback running the
    same tool via Bash), wave-based gap loop (PROPOSE → wizard gates → APPLY), a
    plain-language rule for gate copy (no "codemod"-class jargon in door labels), and
    explicit mirror-the-app vs design-something-new doors at the 1.1 bootstrap gate
    with the parallel-generation + assembly-QA pattern documented.
  - Enabler installs `crg-ui-prep.js`, `crg-ui-prep.checklist.md`, and
    `crg-ui.prep.mjs` (imports rewritten to the installed tool names). Tests:
    `test/ui-prep.test.mjs` + `test/crg-ui-prep-helpers.test.mjs` (seal parity with
    `ui-measure.mjs`, merge semantics, packet tamper cases, proposal fence).

### Fixed
- **`crg-ui.js` variables agent invented node ids.** `get_variable_defs` requires a
  nodeId; the brief said "call it for the file", so agents guessed ids (`1:1`, `1:0`)
  and the run bailed `figma-unreachable`. The brief now anchors the call on the first
  profile cell's frame id (variables are file-scoped — any profile frame anchors them).
  Found live on the first end-to-end SPICE measure run.
- **`crg-ui.js` slice relay gets one seal-checked retry.** A haiku relay of a 17-object
  slice substituted one discrepancy's ledger `id` for its `key`; the seal check caught
  it and (correctly) refused to repair, but the run died on the first miss while the
  scorecard/measure relays already had a retry. The slice brief now warns against the
  id-for-key substitution and retries once before refusing.

## [0.21.0] - 2026-07-09

### Changed
- **`/crg-ui` determinism parity with `/crg-debug`** — both legs (deterministic
  Workflow and prose fallback) now run the same protocol to a T, and every number
  comes from a tool:
  - *Tool core grew the whole capture-to-ledger path.* `lib/ui-measure.mjs` gains
    `normalize-vars` / `normalize-figma` / `normalize-dom` (agents transcribe raw MCP
    dumps VERBATIM; the tool does all math — depth≤2 walk, named-node filter,
    absolute→frame-relative coords, canonical shapes), `assemble` (the tool writes the
    ledger; ids become cell-qualified `<slug>.d-nnn`), `slice` (repair entry from a
    prior ledger — never agent transcription), `measure --breakpoint/--out`, and
    `sealOf` — an FNV-1a seal over the sorted discrepancy keys printed with every
    measure/assemble/slice output. `lib/ui-map.mjs` gains `waitup` (dev-server
    readiness by exit code) and `bless` (ONE command appends an intentional deviation
    to the profile and rewrites `allowlist.json` from it). New `lib/ui-collect.js`:
    the static DOM collector evaluated verbatim in the browser — never re-derived per
    run. The `crg-deterministic` enabler installs it as `crg-ui.collect.js`.
  - *Discrepancy keys now include the breakpoint* (`screen::breakpoint::class::subject`)
    — the no-regression baseline is collision-free across breakpoints.
  - *`crg-ui.js` hardened at every edge.* DOM captures run strictly SEQUENTIALLY (the
    shared Playwright browser made the old per-cell pipeline a capture race); figma
    transcriptions still fan out. Every tool relay is seal-checked in JS (mismatch =
    mangled relay → one retry, then the cell fails); the hand-written persist agent is
    replaced by a tool `assemble` whose seal must match the seal of the script's own
    relayed keys; the `fromLedger` ingest agent is replaced by a seal-checked `slice`
    relay (`approvedKeys` joins `approvedIds`). Repair records a porcelain tree
    baseline at branch setup, post-verifies every commit against the fence allowlist
    via `git diff-tree` (violation → `reset --hard HEAD~1`, unit unfixed), and stops
    the run `tree-dirty` when the tree cannot be restored to baseline — no later
    verify is trustworthy on a polluted tree.
  - *`methodology.md` rewritten as the executable playbook* (crg-debug form): an
    Execution-mode dispatch (deterministic / prose / `crg-ui-converger`), the tool-core
    table, the key/id contract, and a phase-by-phase playbook with exact commands —
    prose mode now runs the tools directly via Bash instead of improvising from a
    one-paragraph summary.
- **`crg-ui-converger` agent** — the `crg-debugger` analog for crg-ui: sequential,
  isolated, methodology-driven, for orchestrators that cannot nest subagents. Refuses
  to improvise without the methodology + measure tool; fixes only explicitly-approved
  discrepancies; never pushes.

## [0.20.0] - 2026-07-09

### Added
- **`/crg-ui-prep` — the perfect-user walkthrough.** Turns any user into
  `docs/crg-ui/perfect-user.md`'s Story 9 user (zero-question GATE-PROFILE, two gates
  total). AUDIT computes every checklist item before asking anything (env scan, repo
  agent, Figma scan through the pairer); GATE-PLAN scopes the work (all / `--top5` ★
  items / subset); the GAP LOOP closes gaps in dependency-sorted leverage order —
  Figma-side items generated via the figma MCP (frame renames to
  `<Screen> / <Breakpoint>`, variable creation + binding, code-token name mirroring,
  componentization, Code Connect, export marks), repo-side items as approved diffs
  (`data-component` codemod off the CRG component list, deterministic render seams,
  routes manifest, auth seam), environment items as verified guide steps. Every item
  gets crg-ui's three-door gate (supply / apply / descope-explicitly), every outcome
  persists in `.crg-ui/prep.json` (resumable; re-runs never re-ask), and no Figma
  mutation ever happens without the complete change table approved first (view-only
  files degrade to a generated designer brief). EXIT assembles a draft
  `.crg-ui/profile.json` validated by `ui-map.mjs`, mirrors descopes into
  `allowlist.json`, and states the exit test plainly: which GATE-PROFILE questions
  remain, if any. `--audit-only` stops at the scorecard. Skill-only (main loop, no
  Workflow — the flow is a gate per item by design): `skills/crg-ui-prep/SKILL.md` +
  `checklist.md` (per-item contract: audit check, fix path, mode, effort, loop order).

## [0.19.0] - 2026-07-08

### Added
- **`/crg-ui` — a graph-driven Figma convergence harness** (v0.1: geometry + token +
  typography layers, React, converge mode). The Figma file is the oracle, the live app is
  the subject, and a deterministic measure tool is the judge:
  - *MEASURE (read-only, default).* Validate the persisted profile, build/update the
    code-review-graph, capture each screen × breakpoint cell (Figma frame geometry +
    variables via the figma MCP; live DOM rects + `:root` tokens via Playwright at the
    frame's exact viewport), and run `lib/ui-measure.mjs` per cell — the tool computes
    every delta; agents relay its JSON verbatim and never eyeball a bounding box. Stops
    with a keyed, severity-ranked ledger (`layout | token | typography | missing-element`)
    at `<repoRoot>/.crg-ui/ledger.json`. Pairing is deterministic name-matching (Figma
    node name vs `data-component`), and it never guesses: ambiguous names land in
    `unmatchedFigma`/`unmatchedDom` as mapping debt.
  - *REPAIR (human-approved discrepancies only).* Sequential per-component fix units (the
    dev server serves one working tree) with a class-routed model ladder — token/typography
    start `haiku`, layout/missing start `sonnet`, one shot per strictly-higher tier, capped
    by `--max-tier`. Each unit verifies by re-capture + re-measure in real code: green =
    the unit's keys vanished AND no key outside the baseline appeared (a fix that breaks a
    neighbor is red). Green units commit on a `crg-ui/fix-*` branch from a fence-checked
    file allowlist; red units revert. **Never pushes.**
  - *Gates + persistence.* GATE-PROFILE (one pre-filled conversation; `<Screen> /
    <Breakpoint>` frame pairing via `lib/ui-map.mjs`, three-door rule for every missing
    input, bootstrap gate when no Figma file exists — the oracle is never invented
    silently), GATE-LEDGER (approve / subset / mark-intentional — blessed deviations
    persist to the profile + allowlist and never re-flag), GATE-DONE. Prose mode runs the
    same methodology in the main loop; `crg-deterministic` installs the Workflow + tools.
  - Planning docs (user stories, perfect-user checklist, implementation plan) under
    `docs/crg-ui/`.

### Changed
- `.mcp.json` now pins the MCP dependency to `code-review-graph-codeblackwell>=2.4.0`
  (previously unpinned — a stale uvx cache could silently serve an old build).

## [0.18.1] - 2026-07-06

### Fixed
- **crg-integrations: missing inline profile now hard-fails instead of silently degrading.** The
  workflow reads `args.profile` (scripts cannot read files, so `profilePath` never hydrates it);
  invoking with only `profilePath` used to run with an empty profile — no under-dev partition, no
  fences — and a dogfood run classified an entire declared under-dev host as four regression
  clusters. Now it throws with instructions to pass the profile object inline.
- **crg-integrations: ingest fingerprint step survives Bash cwd resets.** The ingest agent's
  fingerprint command now carries an explicit `cd <cwd> &&` prefix (subagent Bash calls don't share
  cwd), and the prompt tells the agent to fall back to the ingest tool's own `fingerprint` field
  before declaring it empty — a cwd-reset used to bail the whole triage with `fingerprint-missing`
  even though the matrix carried a valid fingerprint.

## [0.18.0] - 2026-07-06

### Added
- **`/crg-integrations` — a graph-driven triage & repair harness for a project's host × scenario
  integration matrix** (the grid a docs widget / SDK / embed runs against many host frameworks). Two
  gated machines over one methodology, mirroring `/crg-build`'s two-entry shape:
  - *TRIAGE (read-only, default).* Phases 0–5: register/refresh the code-review-graph (unconditional —
    no CRG opt-out; a build/update failure bails `graph-failed`), ingest the red cells, retry away
    flakes (0 tests ran is never a pass), cluster by normalized failure signature, classify each
    cluster **regression | drift | under-dev | flake** with a JS prefilter ahead of the model, and
    screen screenshot failures through an **asymmetric pixel-stat veto** (large or concentrated
    change = regression; everything else is unconfirmed until a vision agent confirms drift — the
    numbers only rule drift out, never declare it).
    Halts on an `oracle-red` matrix — nothing downstream is trustworthy while the golden oracle is red.
    Stops with a `.crg-integrations/ledger.json` and `status:'triaged'`. **Drift is never
    auto-re-baked** — the `--update-snapshots` command is emitted into a human-gated queue.
  - *REPAIR (gated).* Phases 6–10 over human-approved regression clusters: CRG-driven diagnosis into a
    fence-checked brief, a fix in an isolated worktree inside a per-host fence (shared-file fixes are
    `needs-human`, never auto-edited), a re-run verify judged by **exit code AND parsed ran-test
    count**, and a full-matrix regression gate on a `crg-integrations/fix-*` run branch. **Never
    pushes.**
  - *Genericity seam.* All hot-path logic runs over one normalized reference matrix shape
    (`schemaVersion: 1`); a project with a different runner supplies a one-line `matrixAdapter` convert
    command. `lib/integrations-profile.mjs` validates the profile (placeholder presence per command,
    non-empty fences, the drift bar) — `node integrations-profile.mjs validate <path>` exits 0/1.
  - *Contract risks enforced in code, not prose:* grep is built and shell-quoted by the Workflow from
    a `grepTemplate` (regex-escaped values — injection/vacuous-pass defense); the verify judge rejects
    0-tests-ran; the fence check re-verifies `git diff --name-only` after every fix; the drift bar is
    a unit-tested pure helper. New `test/integrations-helpers.test.mjs` (25 tests) covers the pure
    helpers and the validator.
  - The `crg-deterministic` enabler now also installs `crg-integrations.js`,
    `crg-integrations.methodology.md`, and `crg-integrations.profile.mjs`.

## [0.17.0] - 2026-07-03

### Added
- **`/crg-agentsmd` packaged (M4): SKILL.md + README + enabler complete.** The skill routes the
  two-stage run (mine → score+draft, chained; `--mine-only` / `--score-only` / `--score-sample` /
  `--ab` flags) to the installed Workflow with a prose fallback, and carries the honest instrument
  framing the pilot earned: measured on one repo, the mined draft covered 24% of held-out review
  corrections vs 12% for a length-matched generic placebo, and a 3-PR implementation A/B showed no
  lift over placebo — it documents measured reviewer norms; it is not demonstrated to make agents
  build better code. The enabler now also installs the A/B harness lib. The draft is never
  committed, never posted; upstream contribution stays a human act, scores quoted honestly.
- **Validation rerun of the condensed pipeline** (same repo, same corpus): 19 agents total vs the
  pilot's ~43, score leg 731k → 441k tokens, and holdout coverage improved to 24.1% (kept 10 rules,
  39-line draft). Honest miss: mine-leg tokens barely moved (930k) — mining cost tracks corpus
  volume, not miner count.

### Changed
- **`/crg-agentsmd` condensed to measured yield — roughly half the agents and tokens of the
  pilot runs, same invariants.** The pilot paid for the measurements; this spends to them:
  - *Miners 12 → 5, modalities 5 → 3.* Code-invariants and docs miners produced zero rules that
    survived scoring across twelve runs; they are context for verification and synthesis now, not
    rule sources. Review-comments (7 of 9 kept rules), diff-evolution, and git-archaeology remain.
  - *Verify's two judgment fleets merged into one.* Counterexample hunt and restatement detection
    need the same rule text and repo neighborhood; one attacker per scope-batch (8 rules) now
    answers both, halving the judgment agents and the duplicate context reads.
  - *Holdout judges 10 → 3* (64-comment batches; the cost is per-comment reasoning, per-agent
    setup was pure overhead), judges take explicit index lists, and `reason` text is only emitted
    when credit is given. New `scoreSample` arg judges an unbiased stride sample for cheap
    iteration runs. A deterministic drop-replies prefilter was evaluated and rejected: 6 of the
    pilot's 21 covered comments were replies.
  - *Ceremony agents collapsed.* rules-fragment persist + ledger assemble, ledger ingest + holdout
    extraction, and score + stamp each run as one gate agent instead of two (score-path ceremony
    5 agents → 3). Ingest validates the rule list per-line by index instead of trusting the
    agent's self-reported count.
  Estimated clean full run: ~1.4M tokens / ~45 agents → ~700–900k / ~20; score-only rerun 16
  agents → 7.

## [0.16.0] - 2026-07-03

### Changed
- **Per-wave branch commits are now the DEFAULT for `/crg-debug` fix runs — universally, in every
  flow (Workflow, prose mode, `/crg-build` STABILIZE, `/crg-farm --auto-bypass`).** The old
  never-commit contract left validated waves as one undifferentiated working-tree blob: no rollback
  point when wave N regresses wave 1, no fix→bug attribution in the diff, dirty trees that block
  chained runs — and, decisively, the TDD tests each wave writes stayed **untracked and therefore
  invisible to the graph** (CRG indexes only git-tracked files), so `tests_for`/blast-radius gate
  queries could never see them. Now the fix phase:
  - creates (or reuses) a `crg-debug/fix-<slug>` branch off the current HEAD — the slug is a
    deterministic hash of the bug set, so resumes and farm tier-retries land on the same branch;
    the user's own branch is never committed to, and pre-existing uncommitted changes stay
    untouched in the tree (waves stage only their own files by explicit path);
  - commits each wave only after its per-bug close gates are green, restricted to the closed bugs'
    own source + test files, and verifies in JS what actually landed (`commitFilesOk` allowlist
    subset + `commitMessageOk` no-attribution gate — messages are built from file names only, so
    bug prose citing e.g. CLAUDE.md can never trip or leak into them); a bad commit is un-committed
    (`reset --mixed HEAD~1`) with the work left in the tree;
  - **re-ingests the graph (`code-review-graph update`) after every wave commit**, so later waves,
    per-bug gates, and the final blast-radius gate query a graph that matches the tree — this also
    closes the gap where `fromLedger` runs never refreshed the graph at all (the branch-setup agent
    now does status/build/update up front);
  - never pushes, ever. `commit:false` opts back into the legacy working-tree-only mode; branch
    setup failure degrades to it automatically rather than committing on the user's branch.
- `/crg-build` wave commits now also re-ingest the graph after each commit, and its
  GATE-STABILIZE-COMMIT reflects the new reality (review/merge the fix branch instead of committing
  loose dirt).
- `/crg-farm --auto-bypass`: tier-escalation reset now hard-resets the throwaway clone and deletes
  `crg-debug/fix-*` branches (a dirty-file checkout alone no longer suffices); PR-prep squashes the
  wave commits into the one clean human-sounding commit it always shipped (with a fallback for
  `commit:false`/legacy trees).

## [0.15.0] - 2026-07-03

### Added
- **`/crg-agentsmd` — farm a demonstrably accurate AGENTS.md from a repo's review history
  (`workflows/crg-agentsmd.js`, `lib/corpus.mjs`, `lib/agentsmd-score.mjs`,
  `skills/crg-agentsmd/methodology.md`).** Existing AGENTS.md generators read the code and emit
  plausible-sounding rules; maintainers dismiss them because they restate what any reader sees
  instead of the tacit properties that shape the code. This pipeline mines where tacit knowledge
  actually fossilizes — PR review threads (a maintainer correcting a contributor is a labeled rule
  violation), first-push-vs-merged diff evolution, revert/fixup git archaeology, code invariants,
  and existing docs — then makes every rule earn its place twice:
  - *Accuracy gates rules*: every candidate needs verbatim cited evidence at the JSON-schema
    boundary, then survives three adversarial attacks — a counterexample hunt over the current
    tree (which also refutes any rule whose quoted evidence doesn't exist at its ref), an
    executability check whose exit codes the script reads, and a restatement detector that demotes
    exactly the derivable-from-one-file failure mode.
  - *Effectiveness gates the file*: a stratified ~20% of reviewed PRs is held out at corpus time
    (enforced structurally — miners only ever see train-split files), and batched judges replay
    every held-out human review correction against the surviving rules ("would an agent that had
    READ this rule have avoided the code that drew this comment?" — mechanism match, not topic
    overlap). Zero-predictive rules are cut; the synthesized draft orders rules by measured
    coverage. The deterministic scorer (`agentsmd-score.mjs`) owns all math; judges only emit
    structured credit rows.
  A thin fossil record returns `thin-corpus` instead of padding with guesses. The draft is written
  beside the ledger and never committed or posted. No SKILL.md yet, but the `crg-deterministic`
  enabler installs the workflow, methodology, and helper modules (stamped with the plugin commit);
  runs via `Workflow({scriptPath})` with explicit `methodologyPath`/`corpusToolPath`/`scoreToolPath`.
  The `fromLedger` seam re-runs Score+Compress from a persisted ledger without re-mining.
- **Fan-out cost gates (`assertFleet`).** The first pilot ballooned to ~90 verify agents because
  per-rule attack agents multiplied by a data-dependent rule count nobody evaluated before
  spawning. Every fan-out now logs its agent arithmetic (`8 cx + 3 rs + 2 cmd = 13 agents`) and
  throws past `maxPhaseAgents` (default 40) — a phase can no longer scale its fleet silently.
  Verification is batched by design: ~6 same-scope rules per counterexample attacker, ~20 rules
  per restatement judge, ~20 holdout comments per scoring judge.
- **Per-role model tiers.** `minerModel`/`judgeModel` default to `model`, `mechModel` (persists,
  executability, corpus prep, score gate) defaults to haiku, and `synthModel` inherits the session
  model — the permanent synthesized artifact gets the strongest leg while mechanical steps run cheap.
- **`corpus.mjs` hardening.** A one-result `gh pr list` probe fails bad field names in seconds
  before any long paginated pull; raw `--slurp` pages land on disk before parsing so a parse
  failure never costs a re-download; `write-file` writes stdin to disk verbatim so persist agents
  heredoc large JSON instead of a model re-typing it as output.
- **A/B effectiveness eval (`lib/agentsmd-ab.mjs`, behind `abEval:true`).** The retrodictive score
  asks whether the rules would have prevented past corrections; the A/B asks whether the FILE
  changes what an agent produces. Three blinded arms — no file, a length-matched generic placebo,
  the mined AGENTS.md — implement K held-out merged PRs (default 3, richest review threads first)
  from the base commit; lift = mined − placebo. Built to five constraints two production retros
  paid for: arm workspaces are contamination-clean by construction (`git archive` of the base tree
  into a fresh single-commit repo — the merged fix and the `.crg-agentsmd/` answer key are
  structurally unreachable, and prep throws otherwise); fleet arithmetic is asserted before both
  the smoke and the grid; every diff lives on disk with agents relaying only compact numbers;
  a script-owned smoke gate (1 PR × mined arm, non-empty diff + finite similarity) must pass
  before the full grid may launch; and arm/judge agents never run the cheap tier. Scoring is
  CLI-owned Jaccard diff-similarity to the merged human diff plus a rubric judge anchored only to
  that PR's real review comments; the seeded-sham property (placebo fed as "mined" ⇒ ~zero lift)
  is unit-tested. `abOnly:true` evaluates the AGENTS.md already on disk without re-scoring.
- **Fragment persistence + install stamp.** The mined ledger is assembled deterministically on
  disk (`corpus.mjs assemble`: inventory + rules fragments → ledger.json) with a script-side count
  invariant, and `bin/crg-deterministic` now installs `/crg-agentsmd` stamped with the plugin
  commit — a stale `~/.claude/workflows/` install is visible in any run's first log line.

### Fixed
- **Score-phase data transport: heavy JSON never transits an agent.** The first scored pilot was
  invalidated silently — an ingest agent asked to "return the ledger exactly" truncated 43 rules
  to 2 in its structured return, and every holdout judge credited against the 2-rule list. The
  scorer CLI now owns the judged-rule index space (`rules`/`stamp` subcommands, summary-only
  `score` stdout); agents relay compact summaries guarded by count invariants that throw on any
  truncation, and the synthesis agent reads `scores.json` from disk.
- **Environment gaps no longer disprove command claims.** The pilot cut three real rules because
  `nix-shell`/`pre-commit` don't exist on the host — the same code-vs-env failure class crg-debug's
  baseline already classifies. The executability gate now returns `failureKind: code|env` (with a
  script-side stderr override that doesn't trust the agent's classification); env failures keep the
  rule flagged `unverifiedCommand`, and the scorer rescues previously env-cut rules into the judged
  list, where they survive only on earned holdout coverage. `judgedRules()` preserves the flag so
  workflow and scorer stay index-aligned.

## [0.14.2] - 2026-07-02

### Fixed
- **`/crg-farm --auto-bypass` no longer races same-repo candidates over one working tree.** The
  bypass harness fanned every capped candidate through a single flat pipeline, but the clone cache
  is keyed by repo — so in scoped mode (all candidates one repo) three pipelines shared one working
  tree and one git HEAD. Concurrent branch/commit/push stomped each other: only one PR survived and
  the rest reported phantom success (one run shipped a fix its own gate had rejected). Candidates
  are now grouped by repo and run sequentially within a repo, still concurrently across distinct
  repos. The shipped result reports the branch the harness computed, never an agent's self-report,
  so a candidate's PR can't be misattributed. In scoped mode this also drops peak concurrent
  container builds from three to one.
- **Farm runs now close themselves.** Every run appended a `run` record but never a `run-end`, on
  either exit path (early RECON bail or normal completion), leaving every run permanently "open".
  Both paths now append the `run-end` so history compaction can archive a finished run's telemetry.

### Added
- **Lossless history compaction (`lib/farm-db.mjs`: `compact` + `reconcile`).** The farm history is
  one append-only JSONL scanned on every query, and ~3/4 of its bytes are write-only telemetry
  (`candidate`, `gate`, `stage`) the hot path never reads. `compact` moves a closed run's telemetry
  to an append-only `history-archive.jsonl`, keeping only the cross-run records (`pr`, `buildability`)
  and any open run live — so dedup and demotion still resolve against a lean live file. It never
  deletes: a pre-commit guard aborts unless every original record is either kept or archived, and
  `reconcile` proves `live ∪ archive` equals everything ever written. `gate-waits` reads across the
  archive so audits survive. Maintenance incantation when the live file grows: `backfill-run-ends &&
  compact`.

## [0.14.1] - 2026-07-02

### Added
- **AI-welcome contribution greenlist (`skills/crg-farm/greenlist.json`, reference only).** A
  curated list of projects whose own docs welcome AI-agent contributions, as a human aid for
  choosing where to point `/crg-farm`. Each entry tags its `evidenceType` — an *explicit-welcome*
  (docs state AI contributions are welcome) is real consent; an *agent-file* (repo merely ships
  `AGENTS.md`/`copilot-instructions.md`) is a strong implicit signal but not consent (`libsdl-org/SDL`
  ships an `AGENTS.md` that *bans* AI PRs). Carries two authoritative registries to cross-check
  against and an `avoid` list of explicit bans. Nothing in the harness reads it — RECON, ranking,
  and the PR channel are unchanged; it stays reference-only until a real need to weight or gate on
  it appears.

## [0.14.0] - 2026-07-02

### Added
- **Feed-forward resource caps on every gate container (`--cpus=4 --memory=6g`).** The concurrency
  cap bounds candidate *count*, not build *weight* — three concurrent heavy gates (a `dotnet` /
  `gradle` / `cargo` build each forks many compiler processes) still oversubscribed the host; one
  uncapped run drove a 12-core machine to load 200+ and had to be killed. Every containerized
  install/toolchain/gate command now carries a fixed CPU + memory cap, bounding worst-case load to
  ~`CANDIDATE_CAP × cpus` at the container boundary where the resource is actually spent. The cap is
  a constant, not derived from live load: the Workflow script has no shell to sample the machine and
  a probe agent would add load and lag a spike — deterministic feed-forward beats a latent feedback
  loop. Static heavy-toolchain serialization is documented as the next lever if caps prove
  insufficient; runtime load-sensing is explicitly rejected.
- **Recon-time security exclusion for `/crg-farm --auto-bypass` (`--no-security`, or "not
  security" in the query).** Skips security-sensitive candidates during RECON so a wildcard run
  fills its slots with directly-PR-able functional bugs. This is a heuristic pre-filter only; the
  authoritative security decision remains TRIAGE's `secCheck` + the advisory track.
- **In-process verbosity — transitions, decisions, and agent assignments are logged.** A `note()`
  helper streams every stage transition and decision (with its *why*) to the `/workflows` narration,
  and a `mark()` helper mirrors the key ones as pollable farm-DB `stage` records — so a run's
  progress is trackable at a glance without waiting for it to finish.

### Changed
- **Concurrency lowered from 5 to 3** (candidate cap and in-flight pipeline cap). Combined with the
  per-container resource caps, this keeps a wildcard run within a single host's headroom.

### Fixed
- **Fix-quality gates hardened after a stopped run surfaced unshippable fixes.** Two guards added to
  the crg-debug methodology: a **dead-code guard** (Phase 4 diff review) — every symbol the fix
  newly declares must have a call site in reachable production code, so an added-but-unused helper
  can't ride along in a "green" diff; and a **repro-must-compile guard** (TDD RED) — a test that
  fails to *compile* (wrong language version, a feature the repo's toolchain can't parse, an
  undefined symbol) is not a valid RED, so a bug whose repro the repo can't express is marked
  *suspected* rather than forced through.

## [0.13.0] - 2026-07-01

### Added
- **Farmability prior — `/crg-farm --auto-bypass` demotes predictably-unbuildable repos before the
  top-5 cap.** Wildcard runs were spending every slot on repos a slim container can't build
  (C++/premake, Android/Gradle, giant RN monorepos) and shipping nothing. RECON now scores a cheap,
  no-clone farmability prior per candidate from repo metadata (language, build manifests, size) and
  from prior `unfarmable` verdicts recorded per `repo::env`, then sinks low-prior and
  previously-unbuildable candidates below comparable-impact farmable ones. The prior is a
  third-order sort key and the final demotion + cap are enforced in JS, so it over-selects farmable
  repos without ever hard-excluding one — a demoted repo still runs when fewer than five farmable
  candidates exist. New farm-DB record type `buildability` lets the farm learn a repo's env
  verdict across runs instead of re-deriving it.

### Fixed
- **Container env provisioning: the deps volume is now mounted on every toolchain command.** The
  setup agent installed language deps into the `crg-deps-<slug>` volume but could run the baseline
  typecheck without the `-v crg-deps-<slug>:/work/<depDir>` mount, so installed binaries (`tsc`,
  `pytest`, `eslint`) went missing and an unbuildable env was misread as a broken build
  (`Expensify/App` handed off unfarmable on `tsc: not found`). The dep dir is pinned at install, the
  mount is required on every command, and a `not found` failure self-corrects — re-add the mount and
  rerun before classifying env vs code.

## [0.12.0] - 2026-07-01

### Added
- **`/crg-build` — a readiness-campaign track that reuses the crg core for building instead of
  debugging.** One invocation boots the target app (skill-owned daemons: the Workflow never starts
  or stops a server — it returns `status:'app-down'` and the skill restarts), surveys readiness
  gaps across seven dimensions (`stability, completeness, consistency, polish, reachability, docs,
  launch-blockers`) with dimension-disjoint surveyors — the browser-driving ones serialized over
  the single Playwright MCP instance — adversarially verifies every gap (refute = already-done /
  intentional / out-of-scope; confirm must also refine every acceptance criterion into a testable
  `command` or `browser` check), then persists a ranked readiness ledger for **GATE-SPEC**. Build
  mode (`fromLedger` + `approvedGapIds`) packs approved gaps into dependency-ordered, file-disjoint
  waves (`packWaves`: greedy earliest-fit, deterministic cycle-break toward the earlier-ranked gap,
  dep-deferred cascade) and closes each gap only when **Gate A** (every command criterion re-run
  blind, exit codes judged by the script) AND **Gate B** (a serialized headless browser gate —
  `browserVerdict` in JS over httpStatus / non-allowlisted console errors / screenshot / assertions,
  one retry after an infra-shaped failure, two → `app-down`) both pass. Each green wave is
  committed per subrepo with a script-verified allowlist (`commitFilesOk` ⊆ check), a
  script-composed message, and the no-attribution rule enforced in code (`commitMessageOk` — a
  violating commit is reverted with `git reset --mixed`). Never pushes. New files:
  `skills/crg-build/{SKILL.md,methodology.md}`, `workflows/crg-build.js`, `lib/build-profile.mjs`
  (`validateProfile` / `autoApprove` — the `--auto-bypass` GATE-SPEC replacement: High|Medium
  impact, S|M effort, `launch-blockers` always excluded, top-12 cap / `scoreUx` — two-scorer merge,
  mean or min-on-disagreement), plus extraction-pattern test suites
  `test/crg-build-helpers.test.mjs` and `test/build-profile.test.mjs`. The campaign loop (PROFILE →
  STABILIZE via composing crg-debug per subrepo → BOOT → SURVEY → GATE-SPEC → BUILD → UX-REVIEW →
  LOOP) lives in the skill; campaign state reuses `farm-db.mjs` unchanged via
  `CRG_FARM_DB=<appRoot>/.crg-build/campaign.jsonl`. The enabler now also installs `crg-build.js`,
  `crg-build.methodology.md`, and `crg-build.profile.mjs`.

## [0.11.1] - 2026-07-01

### Changed
- **crg-debug/crg-farm commits and PR bodies no longer carry any AI/Claude/Anthropic attribution.**
  The co-author trailer previously added to every commit (`Co-Authored-By: Claude Opus 4.8 ...`)
  is gone from the git/PR policy in `skills/crg-debug/methodology.md`, `skills/crg-farm/methodology.md`,
  `agents/crg-debugger.md`, and the `--auto-bypass` harness's commit/PR-shipping prompt in
  `workflows/crg-debug.farm-bypass.js`. Commit messages and PR bodies are now written in plain
  contributor prose and cadence — no tool credit, no session link, no emoji — to avoid the stigma
  against AI-assisted submissions on repos `/crg-farm` opens PRs against.

## [0.11.0] - 2026-07-01

### Changed
- **`/crg-farm`'s security advisory track now picks a channel instead of always compiling a formal
  report.** A live run confirmed the gap: a mechanical, one-line-fixable shell-injection bug whose
  real-world reachability required an attacker to already control the target's own monitoring
  infrastructure got escalated straight into a multi-page GHSA report — the maintainer rejected it,
  pointing out the fix could have been a one-line PR with one sentence of motivation, "as
  communication from human to human." New gate **`GATE-DISPATCH-CHANNEL`** fires after a *quick*
  PoC-VERIFY/TRACE-EXPLOIT-PATH pass (TRACE-EXPLOIT-PATH now also produces a **marginal-risk
  verdict**: does exploiting this require a precondition that already implies far more compromise
  than the bug itself grants?) and a new **CHECK-CONTRIB-POLICY** step (fetches the target repo's
  own `CONTRIBUTING.md`/`SECURITY.md` and checks for a private-reporting requirement or PR
  conventions to honor). It picks `pr-with-motivation` — apply the fix and route through the
  **normal** GATE-DIFF → PR-PREP → GATE-SUBMIT pipeline, PR body/commit message capped at 1-3
  human-voiced sentences, no report prose — only when the fix is mechanical, the marginal risk is
  small, AND the repo's policy doesn't forbid it; any one unfavorable signal falls back to
  `advisory-report` (SEVERITY-CALIBRATE, now explicitly conservative, → COMPILE-REPORT, now short by
  default → `GATE-ADVISORY-REVIEW`, disk-only, never transmitted). `GATE-SECURITY-ROUTE` is
  unchanged (it only decides whether a bug is security-sensitive at all); the channel decision is
  new and separate, and deliberately asymmetric — the safe branch is the fallback, not the PR
  branch. `GATE-SUBMIT` still never auto-passes under any flag, so a security-sensitive bug still
  only ever reaches a maintainer via the same draft-then-human-submits path every other bug uses.
- **`/crg-farm --auto-bypass`'s harness can now run the whole security-dispatch decision itself,
  unattended** — restoring (and improving on) the capability an interim design briefly removed.
  Rather than trusting a model's summary of its own judgment, the channel decision is computed in
  plain JS (`isDispatchSafe()` in `workflows/crg-debug.farm-bypass.js`) from structured booleans an
  agent call returns (PoC verdict, fix-mechanicality, marginal-risk, contribution-policy) — the
  model reports signals, the code decides. `pr-with-motivation` candidates rejoin the exact same
  fix/PR-prep code path as any other bug (still stops at a **draft**, still never crosses
  `GATE-SUBMIT`); everything else falls back to a short, conservative, disk-only report exactly like
  the prose path. Re-added `ADVISORY_SCHEMA`(now `SECURITY_ASSESS_SCHEMA`)/the `Advisory` pipeline
  phase/the `advisory-compiled` outcome that an interim version of this change had removed.

## [0.10.1] - 2026-07-01

### Fixed
- **`/crg-farm --auto-bypass` no longer silently drops a candidate whose pipeline stage errors.**
  When a per-candidate stage threw (e.g. a subagent completed without returning structured output),
  `pipeline()` nulled that slot and `settled.filter(Boolean)` discarded it — the candidate vanished
  from the run's outcome entirely, reading as if it never ran. The run aggregation now recovers
  dropped slots by index (`settled` is index-aligned with the capped candidates) and surfaces each
  as `outcome: 'errored'` with the candidate's original repo/issue identity and a reason, kept
  distinct from `handedOff`. Added an `errored` bucket to the summary and the workflow return.

## [0.10.0] - 2026-07-01

### Changed
- **Security-sensitive bugs are now auto-routed to the advisory track under `/crg-farm
  --auto-bypass`** (previously they were excluded and handed off untouched, requiring a separate
  `--prose` re-run to get a report). The bypass harness now runs the full advisory track itself in a
  new **Advisory** pipeline stage — PoC-VERIFY → TRACE-EXPLOIT-PATH → SEVERITY-CALIBRATE →
  COMPILE-REPORT — auto-passing `GATE-ADVISORY-REVIEW` to `save-only`. It writes the report to
  `~/.claude/crg-farm/advisories/` and stops there. **The safety invariants are unchanged:**
  security-sensitive candidates still never enter FIX/PR-prep, and the harness never files, emails,
  commits, PRs, or otherwise transmits the report — the deliverable is the on-disk report only.
  `GATE-SUBMIT` is still never crossed by any flag. The prose path is unchanged (a human reviews the
  report at `GATE-ADVISORY-REVIEW`). Implemented in `workflows/crg-debug.farm-bypass.js`; the
  `--auto-bypass` docs in `skills/crg-farm/SKILL.md`, `skills/crg-farm/methodology.md`, and
  `README.md` were updated to match.

## [0.9.0] - 2026-07-01

### Added
- **Per-repo buildability provisioning for `/crg-farm` (`--env`, GATE-BUILDABILITY).** crg-debug
  gains an `env` mode: `--env container` (the harness default) provisions a **dedicated, cached
  Docker environment for each candidate repo** before TRIAGE — a slim base image for its stack,
  `apt`-hand-installed system deps (installed iteratively: build, see what's missing, install,
  retry), language deps in a persistent named volume, source bind-mounted, and every toolchain
  command wrapped to run inside it. The image is **fingerprinted by the repo's manifests/lockfiles
  and reused as-is unless deps change**, so an env is never rebuilt needlessly (cost is once per
  repo, not once per run). `--env none` keeps the prior host-as-is behavior and stays the standalone
  `/crg-debug` default, so plain `/crg-debug` is unchanged.
- **Baseline classification: environment vs. code.** Every baseline build/typecheck failure is
  tagged `code` (a genuine source defect — seeded as a bug, as before) or `env` (a missing
  tool/dep/system library, a build not applicable to the project, or Docker unavailable — NOT a
  bug). **Any residual `env` failure ⇒ the candidate is `unfarmable`:** crg-debug returns early and
  the `--auto-bypass` harness hands it off cleanly (no fix, no PR, no invented bug) instead of
  climbing tiers against an unbuildable tree. This fixes the failure class where an un-provisioned
  environment (e.g. `uv build` on a repo that was never a library) was mistaken for a code bug and
  produced a rejected PR. See `crg-debug.methodology.md` §Environment provisioning & baseline
  classification and `skills/crg-farm/methodology.md` §Environment provisioning.

### Tested
- New `test/buildability.test.mjs` runs the **real** `crg-debug.js` control flow with stubbed
  runtime globals, asserting env-kind failures route to `unfarmable` (both `container` and `none`
  modes) while code-kind failures flow into discovery. New `test/live-provision.test.mjs` exercises
  the actual Docker recipe end-to-end on a fixture repo — fingerprint-labeled image build, deps in a
  named volume, green containerized baseline, fingerprint reuse, and the host-edit→container-visible
  loop — and self-skips when the Docker daemon is down.

## [0.8.0] - 2026-07-01

### Added
- **Security advisory track for `/crg-farm`.** Confirmed bugs are classified against a fixed
  vulnerability checklist (injection, auth/authz bypass, secrets exposure, SSRF/path-traversal,
  insecure deserialization, crypto misuse, memory-safety) at the same pass as complexity scoring.
  Flagged bugs never enter the normal PR pipeline — a new `GATE-SECURITY-ROUTE` (soft) diverts
  them into a dedicated track: PoC-VERIFY (write and actually run a non-destructive proof of
  concept against the real cloned code), TRACE-EXPLOIT-PATH (hop-by-hop taint trace from
  attacker-reachable input to the vulnerable sink, with an explicit reachability verdict),
  SEVERITY-CALIBRATE (recompute severity from evidence, independent of any label an upstream
  agent attached), and COMPILE-REPORT (a Markdown report written under the new
  `lib/farm-db.mjs advisory-path` — always outside any cloned repo's working tree). A new
  `GATE-ADVISORY-REVIEW` gates the compiled report — HARD by default, auto-passable to
  `save-only` under `--auto-bypass` (prose path only), and this tool never files, emails, or
  otherwise transmits the report on the human's behalf under any option, auto-passed or not. The
  `--auto-bypass` **harness** (`workflows/crg-debug.farm-bypass.js`) never attempts this track
  itself — it classifies the same way inside its own Triage stage and excludes/hands off any
  security-sensitive candidate wholesale rather than partially proceeding, since PoC/exploit-path
  judgment stays in the prose path where a human reviews the report. New `advisory` farm-DB
  record type. See `skills/crg-farm/methodology.md` §Security classification & the advisory
  track.
- **Exact human-wait tracking for `/crg-farm` gates.** A new `gate-asked` farm-DB record is
  appended immediately before each non-auto/non-bypass `AskUserQuestion`, paired with the
  existing `gate` decision record. `node lib/farm-db.mjs gate-waits '<filter>'` matches the two
  per `farmRunId`+`gate`+`repo` and returns `waitMs` — the actual time a question sat in front of
  the human — instead of a gap inferred from neighboring records, which previously conflated
  agent work (diff prep, PR pushes) with human think time. No backfill for pre-existing runs:
  there's no proxy timestamp for when an already-answered question was first shown.
- **`/crg-farm` run duration tracking.** A new `run-end` farm-DB record type closes out each
  `farmRunId` with `startedAt`/`endedAt`/`durationMs` — appended via
  `node lib/farm-db.mjs close-run <farmRunId>` at TRACK on the happy path, or right after any
  `abort` gate decision. `node lib/farm-db.mjs backfill-run-ends` retroactively reconstructs
  `run-end` records for runs that predate this (`endedAt` = the latest `ts` among that run's own
  records, marked `backfilled:true`); it's idempotent and skips any `farmRunId` already closed.

### Fixed
- **`GATE-ESCALATE`'s recommended default was undefined.** `escalate-tier` is now explicitly
  `(Recommended)`, with the same "skip `gate-asked` under `--auto`" behavior documented for
  `GATE-RECON`/`GATE-TRIAGE`.

## [0.7.0] - 2026-06-30

### Added
- **`--auto-bypass` — a fully unattended `/crg-farm` run through commit and an opened draft PR.**
  A separate, standalone flag from `--auto` (never implied by it, never inferred from prior
  approvals): it auto-passes every gate up through `GATE-DIFF` (commit) and a HARD-promoted
  `GATE-ESCALATE` on regression — which climbs to the next, strictly higher tier, **never a retry
  of the tier that just failed**. Every tier gets exactly one shot, always; a `haiku` start can
  still climb through two regressions (to `sonnet`, then `opus`) before running out of ladder.
  Truncates ranked candidates to the top 5 (§Ranking) and runs their TRIAGE→FIX→PR pipelines
  concurrently, capped at 5 in-flight. `GATE-SUBMIT` is never bypassed by any flag — every PR this
  opens **stops at draft**; flipping one to ready-for-review stays a deliberate, separate human
  action. A regression that's still unclean once `maxTier` itself has regressed drops that
  candidate from PR-prep and marks it `handed-to-human` in the run's closing report instead of
  committing an unclean diff. Every gate decision it auto-passes is logged `bypass:true` (never
  `auto:true`), keeping the audit trail able to distinguish a human "yes" from `--auto`'s
  soft-gate defaults from a fully unattended bypass. See `skills/crg-farm/methodology.md`
  §Auto-bypass mode.
- **`workflows/crg-debug.farm-bypass.js` — the harness-held option for `--auto-bypass`.** A new
  deterministic Workflow, installed by the existing `crg-deterministic` enabler, that owns RECON
  (dedup + rank + the top-5 cap), TRIAGE, FIX/escalation, and PR-prep in real JS instead of prompt
  compliance — the top-5 cap, the 5-way concurrency cap, and the one-shot-per-tier escalation rule
  are all enforced in code (a strictly-climbing tier function that cannot return the tier it was
  just called with), not trusted to a model self-policing them across up to 5 parallel repos.
  Composes the existing `crg-debug.js` Workflow unmodified via the `workflow()` nesting primitive
  for both TRIAGE and FIX passes, so the underlying detect/fix engine is identical between prose
  and harness auto-bypass. `/crg-farm --auto-bypass` prefers it automatically once installed;
  `--prose` forces the prompt-driven path (needed for a scoped `/xplore` sweep, which a Workflow
  agent can't run). See `skills/crg-farm/methodology.md` §Auto-bypass mode → "Prose vs. harness".

## [0.6.0] - 2026-06-30

### Added
- **`/crg-farm` RECON ranks fresh candidates by impact × review-likelihood.** Previously GATE-RECON
  showed an unordered dump of fresh candidates, which stopped being triageable once a themed or
  wildcard search returned 20+ results. RECON now pulls two signals per distinct repo —
  `stargazerCount` (blast-radius proxy) and the last 5 merged-PR timestamps (review-cadence proxy:
  tight spacing means active review, a stale gap since the last merge demotes a repo even if its
  historical cadence looked fast) — and combines them with an impact read of the issue body itself
  (data-loss/security/safety-relevant bugs outrank functional breakage, which outranks cosmetic
  ones). Candidates sort impact-first, review-likelihood as tiebreaker/demotion, with the signals
  recorded on each `candidate` farm-DB row (`rankSignals`). Because a ranked list commonly exceeds
  the 4-option cap on a gate, `select-subset` at `GATE-RECON` is now a two-step pick: the ranked
  list posted as plain text, then a compact cut-point follow-up (Top-5/Top-10/Top-N/Custom). See
  `skills/crg-farm/methodology.md` §Ranking.

## [0.5.1] - 2026-06-30

### Fixed
- **`/crg-farm` no longer defaults RECON to the current-directory repo.** The skill's `repoRoot`
  resolution silently fell back to `git rev-parse --show-toplevel`, so an unscoped invocation would
  farm bugs in whatever repo happened to be the working directory instead of sourcing candidates
  from GitHub. RECON now resolves a mode from `direction`: **scoped** (a named repo, or `--issue`)
  runs `/xplore` against that repo as before; **themed** (free-text topic, no repo) and **wildcard**
  (no direction at all) run a cross-repo `gh search issues` instead, since `Explore` agents can't
  reach remote GitHub. `repoRoot` is no longer resolved up front — each candidate's repo is
  cloned/synced lazily via a new persistent clone cache at `~/.claude/crg-farm/repos/<owner>/<repo>`
  once it survives `GATE-RECON`, and candidates sharing a repo are batched into one `--detect-only`
  triage pass. See `skills/crg-farm/methodology.md` §Sourcing candidates and §Clone cache.

## [0.5.0] - 2026-06-30

### Added
- **`/crg-farm` — a bug-farming loop over crg-debug.** A `user_invocable` main-loop orchestrator
  that sources real open bugs, triages them cheaply, escalates model capacity only where repair
  struggles, and ships draft PRs — with formal human approval at every consequential boundary. It
  *calls* crg-debug as a primitive (zero Workflow changes). Stages: RECON (`/xplore`) → dedup →
  TRIAGE (`--detect-only`) → FIX (`--from-ledger`, escalating haiku→sonnet→opus) → PR-prep. See
  `skills/crg-farm/`.
- **Two-pass duplicate-fix check in RECON** — before any triage spend, each candidate is verified
  as genuinely open AND not already being fixed: pass 1 dedups against our own farm history; pass 2
  checks the upstream repo (`gh issue view` / `gh search prs` / `gh pr list`) and classifies each
  candidate fresh / in-flight / already-fixed, dropping the latter two so the farm never produces a
  duplicate PR for a bug someone else already has in flight.
- **Named-Gate Protocol** — five repeatable approval gates (RECON, TRIAGE, ESCALATE, DIFF, SUBMIT)
  via `AskUserQuestion`. `GATE-DIFF` (working-tree→commit) and `GATE-SUBMIT` (fork→upstream) are
  HARD stops that `--auto` never bypasses; soft gates auto-pass under `--auto`.
- **Orchestrator-driven model escalation** — reads the Workflow's `ret.fix` return, narrows the
  ledger to just the unfixed bugs (`lib/ledger-slice.mjs`), and re-invokes `--from-ledger` at the
  next tier, so a stronger model only ever re-runs the hard bugs. Branches on failure channel
  (RED-not-observed vs a regressing final gate).
- **Farm database** — `lib/farm-db.mjs`, a global append-only JSONL at
  `~/.claude/crg-farm/history.jsonl` recording every run, candidate, gate decision, fix attempt,
  and PR across all repos. Enables cross-run candidate dedup (never re-work a shipped bug) and a
  full audit trail. `CRG_FARM_DB` overrides the path.
- `lib/ledger-slice.mjs` + `lib/farm-db.mjs` — standalone importable + CLI helpers (mirroring
  `issue-ref.mjs`), each with a zero-dependency `node --test` suite. Installed next to the workflow
  by the `crg-deterministic` enabler.

### Changed
- **Hardened the TDD RED step** (methodology + fix-agent prompt): a test that asserts the current
  buggy output or expects the reported exception (`assert_raises` on the very error) is INVALID —
  it codifies the bug and falsely "passes" RED. This is the guard the numpy einsum experiment
  showed was needed (the fix agent had degenerated to asserting the symptom).
- **Final gate narrows to the CRG blast radius** of touched files (impact radius + `tests_for` +
  affected flows) instead of running the whole suite — a fix run can no longer hang polling a giant
  test suite while still catching cross-file regressions.

## [0.4.0] - 2026-06-30

### Added
- **`--from-ledger <path>`** — resume from a prior read-only run's `.crg-debug/ledger.json` and skip
  straight to Phase 4 fix waves over the already-confirmed bugs. Enables a serialized
  detect → review → fix hand-off (run `--detect-only`, review the ledger, then fix it). Implies
  `fix=true`.

### Changed
- The deterministic workflow now resolves `methodology.md`'s path at runtime via
  `args.methodologyPath` (passed by the `/crg-debug` skill) instead of having it baked in by `sed`
  at install time — `crg-deterministic` now just copies `workflows/crg-debug.js` unmodified.
- README restyled with badges and section emojis (no content changes).

## [0.3.0] - 2026-06-30

### Added
- **Point the sweep at an issue/ticket.** `--issue <ref>` (or a GitHub ref auto-detected in
  the freeform args — `#n`, `owner/repo#n`, or a full issue URL) fetches the issue via `gh` and
  drives the run from it: the issue resolves the file set *and* is threaded into the discovery
  finders, so they hunt the specific reported symptom rather than just "bugs in these files."
  Non-GitHub trackers (Jira/Linear/…) are supported via a paste fallback — pasted ticket text
  becomes the focus. The issue reference is recorded in the run header, the ledger, and the report.
- `lib/issue-ref.mjs` — a standalone, importable + CLI reference parser the skill calls to classify
  input deterministically (resolving `owner/repo` from the git origin for bare `#n`). Installed
  next to the workflow by the `crg-deterministic` enabler.
- Test suite (`node --test`, zero dependencies): `test/issue-ref.test.mjs` covers every reference
  form; `test/helpers.test.mjs` extracts the workflow's pure-helper block from the shipped source
  and tests it directly (no duplication).

### Changed
- The run model now defaults to **haiku**, overridable with `--model <name>` (`--model session`
  inherits the session model). Centralized in a `resolveModel` helper.
- Issue text is untrusted external input — it only ever reaches an agent through the existing
  `fence()` / `UNTRUSTED` guard, so a crafted issue body cannot steer the run.
- Consolidated the workflow's pure helpers (`fence`, `norm`, `keyOf`, `shortFile`, `bugFile`) and
  argument coercion (`resolveModel`, `clampRounds`, `capText`) into one dependency-free, unit-tested
  block.

## [0.2.1] - 2026-06-29

### Added
- Persist the confirmed-bug ledger to `.crg-debug/ledger.json`.
- Coupled-bug prose fallback: when per-bug fix waves stall on bugs that share one validating test,
  a single holistic prose attempt is made before escalating to a human.

## [0.2.0] - 2026-06-29

### Added
- Opt-in loop-until-dry discovery (`discoveryRounds`): re-run the finders, each round told what is
  already found, until a round surfaces nothing new or the cap is hit.

## [0.1.3] - 2026-06-29

### Changed
- `crg-debugger` subagent inherits the caller's model (was pinned to opus).
- Hold conflicted-verdict findings out of the fix queue.
- Namespaced the enabler binary as `crg-deterministic`.

### Added
- Initial release: graph-driven parallel debugging plugin for Claude Code — build the
  code-review-graph, map hotspots, fan out concern-disjoint finders, adversarially verify, and fix
  confirmed bugs in TDD waves over file-disjoint sets. Nothing is committed.

[0.4.0]: https://github.com/CodeBlackwell/crg-debug/releases/tag/v0.4.0
[0.3.0]: https://github.com/CodeBlackwell/crg-debug/releases/tag/v0.3.0
[0.2.1]: https://github.com/CodeBlackwell/crg-debug/releases/tag/v0.2.1
[0.2.0]: https://github.com/CodeBlackwell/crg-debug/releases/tag/v0.2.0
[0.1.3]: https://github.com/CodeBlackwell/crg-debug/releases/tag/v0.1.3
