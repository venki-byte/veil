# Veil

**Understand the paperwork. Keep the personal details.**

Veil is a Chrome web app that explains sensitive paperwork (lab reports, rental and loan
agreements, bank and tax letters) in plain language, without the personal details ever
leaving your device.

Built for #BuildHybridAI 2026 with **Firebase AI Logic** and the **Hybrid Inference SDK**.

> Veil explains documents. It does not give medical, legal or financial advice.

## The problem

A cloud chatbot would explain your blood test or loan letter well. But pasting it in means
sending names, addresses, ID numbers and health details to a server. Many people either
avoid AI for these documents or share more than they should.

## How Veil works

1. **Your device reads the document.** Gemini Nano, running inside Chrome, finds names,
   addresses, IDs and other personal details. Plain code replaces each one with a typed
   placeholder such as `[PERSON_1]`.
2. **The cloud explains the redacted text.** You see exactly what will be sent and can change
   it. A leak guard blocks the request if any hidden value is still in it. Cloud Gemini only
   ever sees placeholders.
3. **Your device puts the names back.** The answer comes back with placeholders. Plain code in
   the browser tab restores the real values for display.

The app shows three columns side by side: **Original** (never leaves the device),
**What leaves this device** (the redacted text), and **Explanation** (real names restored
locally).

## Why hybrid

In Veil the device/cloud split is the privacy mechanism itself, not a fallback. All four
Firebase AI Logic inference modes are used, each for a stated reason:

| Mode | Used for | Why |
| --- | --- | --- |
| `ONLY_ON_DEVICE` | Transcribe a photo, detect personal details | Raw data must never leave. If Gemini Nano is missing, Veil fails visibly rather than leak. |
| `ONLY_IN_CLOUD` | Full explanation of the redacted text | Needs strong reasoning and long context. The input is already redacted and has passed the leak guard. |
| `PREFER_ON_DEVICE` | Quick read, simpler words, explain a term, translate | The input is already redacted, so either path is safe; local is free and instant. |
| `PREFER_IN_CLOUD` | Follow-up questions | Best quality when online; still answers from the device when offline. |

Every result carries a badge showing where it actually ran, read from
`response.inferenceSource`. The **privacy ledger** lists every model call in the session:
the task, the mode requested, where it ran, how long it took, and the exact text sent to the
cloud (or "nothing left this device").

The **Routing** page (`#/routing`) runs one harmless call in each mode so you can check the
routing on your own machine, and includes a live leak guard demonstration.

## What makes it trustworthy

- **One door to the models.** [`src/ai/hybrid.ts`](src/ai/hybrid.ts) is the only file that
  imports `firebase/ai`. There are no direct Prompt API prompts and no direct Gemini API
  calls. The Gemini API key is never in this code; Firebase AI Logic holds it.
- **The leak guard is structural.** Any call that could reach the cloud must pass a registry
  to the wrapper, which checks the outgoing text against every hidden value before sending.
  It is stricter than the redaction step: it also catches different case, different spacing
  and regrouped digits.
- **Photos stay local.** An image can only be passed to an `ONLY_ON_DEVICE` route; the
  wrapper rejects it on any other route.
- **Deterministic substitution.** Models detect; code replaces. The registry
  ([`src/privacy/registry.ts`](src/privacy/registry.ts)) gives the same value the same
  placeholder every time, and restoring values is an exact lookup. It lives in memory only.
- **Nothing from the model is trusted blindly.** A value Gemini Nano reports is only used if
  it really appears in the text.
- **You confirm before anything is sent.** Without Gemini Nano, Veil shows a "reduced
  protection" banner and asks for an explicit confirmation.

## Architecture

```
src/
  ai/
    hybrid.ts        The only file that imports firebase/ai. Routing table, leak guard
                     enforcement, ledger recording, device-model status and setup.
    prompts.ts       Every prompt, in one place.
    schemas.ts       JSON Schemas for structured output, and tolerant parsers.
  privacy/           Deterministic code, fully unit tested. No model calls.
    regex.ts         Emails, phones, IDs, accounts, dates, labelled names and addresses.
    chunk.ts         Splits text into short chunks, far below the on-device token limit.
    spans.ts         Locating values and resolving overlapping findings.
    detect.ts        Pipeline: regex, then Nano per chunk, then merge.
    registry.ts      Typed placeholders: redact and rehydrate.
    leakGuard.ts     Last check before anything leaves the device.
  ledger/            Privacy ledger store and drawer.
  features/          ingest, review, explain, followup, routing, session, workspace.
  firebase.ts        Firebase app and App Check.
samples/             Three synthetic documents. Every person and number is invented.
```

Pipeline: **ingest** (local) → **detect** (regex + Gemini Nano, local) → **registry** (code)
→ **review** (you) → **leak guard** (code) → **explain** (cloud, redacted only) →
**rehydrate** (code) → **follow-up** (redacted with the same registry).

Stack: Vite, React, TypeScript, Tailwind CSS, Firebase JS SDK (AI Logic, App Check, Hosting),
pdf.js for local PDF text extraction, Vitest. There is no custom backend.

## Research this design draws on

- **PAAC: Privacy-Aware Agentic Device-Cloud Collaboration.** The device masks sensitive
  spans, the cloud reasons over typed placeholders, and a deterministic on-device registry
  does all substitution and reversal. This is Veil's core pipeline.
- **Minions (ICML 2025).** Small on-device models do well on narrow jobs over short chunks.
  Veil gives Gemini Nano one job (find spans) on chunks of about 600 tokens.
- **Bridging On-Device and Cloud LLMs for Collaborative Reasoning (ICML 2026)** and
  **Large Language Models over Networks.** Route by data sensitivity and connectivity, not
  only by model availability.

## Requirements

- Chrome 139 or later on desktop, with
  `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` enabled, for full protection
  and photo input. Check with `await LanguageModel.availability()` in DevTools.
- In other browsers Veil still works in a clearly labelled reduced-protection mode
  (pattern-based redaction plus manual review; photos off).
- Node.js 20 or later to build.

## Setup

1. Create a Firebase project. In the console open **AI Logic**, click **Get started** and
   choose the **Gemini Developer API**. Register a web app.
2. Install and configure:

   ```bash
   npm install
   cp .env.example .env    # then paste your Firebase web app config into .env
   npm run dev
   ```

3. Open the app on `localhost`. On the first model call the browser console prints an
   **App Check debug token**. Register it in the Firebase console under
   **App Check → Apps → Manage debug tokens**.
4. Click **Set up private mode** to download Gemini Nano (one time, several minutes).
5. Open `#/routing` and click **Run all four** to confirm each mode runs where expected.

For a hosted deployment, set `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` (or
`VITE_RECAPTCHA_V3_SITE_KEY`) in `.env`, then:

```bash
npm run build
npx firebase-tools deploy --only hosting
```

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Type-check and build to `dist/` |
| `npm test` | Run the unit tests |
| `npm run lint` | Lint |

## Tests

Everything in `src/privacy` is plain code with unit tests: overlapping spans, repeated
values, the redact/rehydrate round trip, the leak guard blocking planted values, chunk
limits, and end-to-end redaction of the three sample documents. The model is replaced by a
fake in unit tests only; the shipped app contains no mocked AI.

## Limits, stated plainly

- **Redaction is not perfect.** Gemini Nano can miss a name or an address. That is why regex
  runs first, why you review the redacted text before sending, and why the leak guard exists.
  The leak guard can only block values that were detected or that you added.
- **Regex-only mode misses unlabelled names and addresses.** The app says so and asks you to
  confirm.
- **Photo transcription is beta.** A small on-device model can misread a photographed page.
  Paste and PDF are the main paths.
- **On-device limits.** Gemini Nano accepts text and JPEG/PNG images up to 9,216 tokens and
  supports a limited set of output languages. Translation to Hindi or Tamil runs on-device
  only if the browser's model supports the language; otherwise the (already redacted) text
  is translated in the cloud, and the badge shows that.
- **Dates and amounts stay visible by default** (except dates of birth), because the cloud
  needs them to explain deadlines and costs. You can hide any of them.
- **Scanned PDFs** have no text layer; open a photo or screenshot of the page instead.
- Veil keeps nothing: the document, the registry and the ledger live in memory and are gone
  when you close the tab.

## License

Apache-2.0. See [LICENSE](LICENSE).
