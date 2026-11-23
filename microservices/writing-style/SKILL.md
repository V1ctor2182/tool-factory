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
- When you say you checked, list what you checked and what you did not.
- Write instructions that stay true. No "as of now" or "currently" for something that will change, and no dates inside a rule.

## Cut on sight

- Filler. "In order to" becomes "to". Delete "it is important to note that".
- Hedging stacks. "Could potentially possibly" becomes "may".
- Chatbot phrases and praise. "Great question", "I hope this helps", "Let me know if".
- AI vocabulary. Crucial, delve, enhance, pivotal, robust, seamless, showcase, testament, underscore, vibrant.
- "Not just X, but Y", forced groups of three, and endings like "the future looks bright".
- Adverbs that prop up a weak verb. Give the number or a stronger verb.
- A sentence that could appear unchanged in another project's docs. It says nothing about this one.
- Frequency words with no condition. Sometimes, usually, mostly, basically. Give the condition.
- Range words. "And so on", "this kind of", "etc". Give the full list or the count.
- Pointer words with no name. "That one", "this", "the above". Name the thing.

## Shapes

- A doc says how things are now. When something changes, rewrite that part. No log and no change history.
- A doc or PR description says why the change exists, what it leaves out, what it could break, and how it was proved, in that order, with `##` headings.
- A commit subject follows `type(scope): subject`, imperative, with no trailing period. The body does not restate the subject.
- A SKILL.md description says in the third person what the skill does and when to use it, with the words a person would type. Keep the body under 500 lines and put exact commands in code blocks.
- A code comment explains only a non-obvious why the code cannot show.

## Replies

- Lead with the answer. Say what Victor must do in the second sentence, even when it is nothing. Then give the evidence.
- Frame the impact for the person who uses the work before any detail of how it was built.
- Reply to Victor in Chinese. Write what goes in a repo in English, and keep names he must type in English.
- When the work is something Victor can look at, give a link he can click to see it: the page, the preview, or the running app. A pull request link does not count.
- Keep a reply within one screen. For more, publish a page and reply with the conclusion and the link.
- Explain a term the first time it appears, and use at most three new terms in one reply. Leave out commit hashes, branch names, and names an agent made up, unless Victor must type them.
- Give each abstract claim one example with real names and real numbers.
- For a fix, write three sentences: what was wrong, what changed, and whether it works now.
- For a choice, put each option's consequence side by side, then recommend one.
- A table cell holds one item per line, never a paragraph.
- Lay the same kind of thing out the same way every time. Order a flow the way a message moves through it.
- Show a flow, a structure, or data as a diagram or a page.
- After long work, end with four lines: the result, the evidence, the current state, and the one thing he must do.

Before you hand text over, reread it once against the punctuation and cut lists. Fix what you find in place.
