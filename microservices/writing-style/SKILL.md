---
name: writing-style
description: Victor's house style for prose, the rules every reply, doc, README, commit message, PR description, and SKILL.md he reads should follow. Use whenever writing or editing text for Victor, even a short reply, and when reviewing someone else's draft against his style.
---

# writing-style

Victor's house style. It holds rules, not a template, so apply them to whatever you are writing.

## Sentences

- Write short declarative sentences. One thought per sentence, ended with a period.
- Use active voice and name the actor. "The loader parses the file", not "the file is parsed".
- Prefer the plain word. Use, help, many, if. Not leverage, facilitate, numerous, in the event that.
- Write whole sentences with their articles and verbs. No arrows, symbol-speak, or verbless fragments.
- Use one term per concept. Pick a name for a thing and repeat it, even when it feels repetitive.

## Punctuation

- Never use a long dash. End the sentence or use a comma.
- Use a colon only before a list or an example, never as a connector in the middle of a sentence.
- Use straight quotes, sentence-case headings, and bold only for a lead-in that ends in a period.
- No emojis.

## Claims

- Every claim carries its evidence or its label in the same sentence. Say whether it was measured, inferred, or a guess.
- Name the source, the command, or the number. "Transcribing ten minutes takes about 30 seconds on this Mac", not "transcription is fast".
- Do not write a link, citation, or quote you did not read.
- Write instructions that stay true. No "as of now" or "currently" for something that will change, and no dates inside a rule.

## Cut on sight

- Filler. "In order to" becomes "to". Delete "it is important to note that".
- Hedging stacks. "Could potentially possibly" becomes "may".
- Chatbot phrases and praise. "Great question", "I hope this helps", "Let me know if".
- AI vocabulary. Crucial, delve, enhance, pivotal, robust, seamless, showcase, testament, underscore, vibrant.
- "Not just X, but Y", forced groups of three, and endings like "the future looks bright".
- Adverbs that prop up a weak verb. Give the number or a stronger verb.
- A sentence that could appear unchanged in another project's docs. It says nothing about this one.

## Shapes

- A reply leads with the answer, then the evidence. Frame the impact for the person who uses the work before any detail of how it was built.
- A doc or PR description says why the change exists, what it leaves out, what it could break, and how it was proved, in that order, with `##` headings.
- A commit subject follows `type(scope): subject`, imperative, with no trailing period. The body does not restate the subject.
- A SKILL.md description says in the third person what the skill does and when to use it, with the words a person would type. Keep the body under 500 lines and put exact commands in code blocks.
- A code comment explains only a non-obvious why the code cannot show.

Before you hand text over, reread it once against the punctuation and cut lists. Fix what you find in place.
