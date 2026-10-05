# Learning from feedback, explained

Date: 2026-09-30.

This describes two connected features for the chat assistant: it can learn a
standing rule from your written feedback, and once a question has been
answered and checked, asking it again gives you back the exact same answer
instead of a re-guess.

## The problem this solves

Sometimes the assistant gets a question wrong, but not because it's
guessing blindly. It's the kind of wrong where it half-knows it isn't sure —
in Business expert mode this shows up as "medium" confidence rather than
"high." A good example: "What was our net revenue in fiscal year 2025?" There
are two things buried in that sentence the assistant has to guess at unless
someone tells it otherwise — what "fiscal year" means for this business, and
what "net revenue" is supposed to include or exclude. Get either one wrong
and the number is wrong, even though the query ran cleanly and returned a
tidy-looking figure.

Today, once you point that out, the correction only helps that one
conversation. Ask the same kind of question again next week, in a new
session, and the assistant makes the same guess again. This feature closes
that gap.

## What "learning" means here

When you leave a note on a rated part of an answer — "our fiscal year starts
in February, not January" — the assistant reads that note and writes down a
short, general rule for itself: not "the answer to this question is X," but
a standing fact, like an entry in a shared notebook that gets read before
every future answer on that data. Think of it as the assistant keeping its
own notebook of house rules, and checking that notebook every time before it
answers, the same way a new analyst would keep notes on "how we define
things here" after being corrected by a manager a few times.

You can always see, edit, or switch off every rule it has written down, in
the Knowledge tab, tagged "From feedback." Nothing is hidden and nothing is
permanent — if a learned rule turns out to be wrong or overly broad, you fix
or disable it there, the same as you would any other piece of curated
knowledge.

## Did we fine-tune the model? No.

"Fine-tuning" means re-training the underlying AI model on examples so the
training changes its behavior permanently. We didn't do that, and didn't
consider it a close call. A few sentences of evidence:

A direct comparison found that giving a model the right facts to read
(retrieval) beat fine-tuning it on those same facts, by a wide margin — about
88% accuracy versus about 51% on a task involving genuinely new information.
Separately, researchers found that fine-tuning a model on facts it didn't
already know doesn't reliably teach it those facts — it tends to make the
model *more* prone to making things up elsewhere, which is the opposite of
what we want from a correction. On top of that, the specific models we use
(GPT-5 and similar) aren't even offered for this kind of fine-tuning by
OpenAI — their own guidance calls for dozens of examples at minimum, and a
handful of thumbs-down comments over a few weeks is nowhere near that. A
notebook of written rules, by contrast, takes effect on the very next
question, costs nothing to test, and can be undone with one click if it
turns out wrong. There was no upside to the slower, more expensive, less
reversible option.

## How "same question, same answer" is guaranteed

This is a separate promise from learning, and it needed its own solution,
because it turns out you can't get it for free from the AI model itself.

Here's the surprising part: even when a provider is asked to be as
deterministic as possible — the AI equivalent of "give your most literal,
least random answer" — it still doesn't reliably give the same answer twice.
A research team at Thinking Machines Lab ran the same question through an AI
model 1,000 times under those "most deterministic" settings and got 80
different worded answers back, not one. The cause isn't randomness in the
usual sense — it's how the provider's servers happen to batch requests
together at that moment, which is completely outside anyone's control as a
customer of that service. So "just tell it to be consistent" was never going
to work, no matter which model we used.

Instead, the assistant remembers its own checked answer. When you ask the
exact same question again, it doesn't go back to the AI model and hope for
the same wording — it pulls up the answer it gave and verified before,
quietly re-runs the same underlying database query to make sure the
underlying numbers haven't moved, and if they match, hands you back that
exact same answer. It only thinks the question through again from scratch
when something has actually changed: new learned knowledge that applies to
that question, or the data itself moving. And even then, if the new
calculation lands on the same numbers as before, it keeps the old wording
rather than restating the same thing in slightly different words for no
reason — it only visibly changes the answer when the numbers actually change.

## Walking through the demo

This is what it looks like in the app, step by step, using the fiscal-year
example above on a test "Retail" dataset:

1. **Ask, with Expert mode on:** "What was our net revenue in fiscal year
   2025?" The assistant answers with a number and says plainly which parts
   it had to guess: "Fiscal year: treated as the calendar year." The
   confidence badge is not high — it's telling you, honestly, that it had to
   guess at what "fiscal year" and "net revenue" mean here.
2. **The answer is wrong**, because it guessed the calendar year (its guess
   at "net revenue" happened to be sensible, but it was still only a guess).
   You give it a thumbs-down on the two parts that were guesses, with two
   short notes: what the fiscal year actually is, and what "net revenue"
   actually means (never mentioning the answer itself — just the rule).
3. **Start a brand-new session** and ask the exact same question.
4. **This time it's right, and confidence reads high.** A small tag reads
   "Updated after learning" — because the numbers genuinely changed once the
   assistant applied what it was taught.
5. **Ask it again**, same question, same session or a new one. This time you
   see "Same answer · re-verified" — it didn't think it through again, it
   pulled up the checked answer and confirmed the data hadn't moved since.
6. **Ask a related but different question** — "how many orders did we take
   in fiscal year 2025?" — which nobody corrected directly. It gets this one
   right too, on the first try, because what you taught it was a general
   rule about the fiscal calendar, not a one-off fix for the revenue
   question.

## What happened when we ran it (30 September 2026)

We ran the whole walk-through automatically against a copy of the app's
data, with GPT-5:

- **First answer, before any notes:** $389,641.99 — wrong (that is the
  calendar year). The badge came out **low**, not medium, because the
  assistant's own double-check read "net revenue" a different way (using the
  order total, which includes tax and shipping) and the two disagreed. We
  then renamed that confusing column to "amount charged" so the double-check
  isn't tempted by it; in two earlier tries without that disagreement the
  badge was medium (0.76 and 0.79). We haven't re-run it since the rename.
- **Your two notes** turned into five short rules in the Knowledge tab (for
  example "Fiscal year (FY)", "Net revenue (merchandise)").
- **New session, same question:** $401,306.11 — **right, high confidence**,
  tagged "Updated after learning."
- **Asked again in another new session:** word-for-word the same answer,
  tagged "Same answer · re-verified", and no AI call at all.
- **The related question nobody corrected** ("How many orders did we take in
  fiscal year 2025?"): **right, high confidence**, first try.
- **A plain control question** (which category sold most units in March
  2025): right both times and identical on the repeat — but its badge said
  low. That was a flaw in the double-check (it only returned the winner,
  the answer listed the whole ranking, and it called that a disagreement);
  it's fixed now.

One behaviour change came out of this: the very first time, the assistant
didn't answer at all — it asked "What's your fiscal year boundary?", and
none of the four options it offered was your real calendar. In Expert mode
it now answers under the most common convention and says so, because in
Expert mode you review every assumption anyway, and a correction you make
once is remembered for good — a clarifying question only helps that one
conversation. It still asks when the *data* is ambiguous (two people with
the same name, say).

## Did it cost anything?

About 17 AI calls for the whole automated walk-through. A repeated question
costs nothing — it is answered from the stored, re-checked answer.

## What to watch

- **Learning lift** (the headline): of the wrong-answer case and its related
  follow-up question, how many flip from wrong to right, and from medium to
  high confidence, after the two corrections. The target is both of them.
- **Repeat consistency** (the floor that must never slip): asking an
  already-checked question again, with nothing new to learn, must return the
  identical answer every time — not a slightly different rewording, not a
  different number.

## Honest limits

- **A comment that only says "wrong" teaches nothing.** For the assistant to
  write down a rule, your note has to say *why* it was wrong, not just that
  it was. A bare thumbs-down is still useful — it removes that answer as
  "approved" — but it doesn't add anything to the notebook.
- **A learned rule can itself be wrong**, especially if a note was unclear or
  overly specific. Every rule the assistant writes is visible in the
  Knowledge tab, so it's worth a glance after teaching it something,
  especially early on.
- **A reworded question counts as a new question.** The "same answer every
  time" guarantee is deliberately strict — it only applies to the exact same
  wording (small differences in spacing, capitalization or punctuation are
  fine). Ask it a different way and it reasons about it as a new question,
  which protects against the guarantee accidentally applying to a question
  that only sounds similar but means something different.
- **The very first answer to a brand-new question still comes from the
  model**, guesses and all. Learning only helps starting from the second time
  a related question comes up — it doesn't make the first answer to
  something genuinely new any smarter.
