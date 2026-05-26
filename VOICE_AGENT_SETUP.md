# Apple Watch Shortcut Voice Agent

This setup gives you the practical path now:

- Apple Watch shortcut launches a URL on your iPhone.
- The iPhone browser page starts a live OpenAI voice session.
- The session is grounded in one dataset you registered earlier.

This does **not** make the conversation run natively inside the watch by itself. For direct watch microphone and speaker handling without handing off to the phone browser, you would need either:

- a watchOS app, or
- a phone-call / SIP bridge to a Realtime voice agent

## Files

- `api/voice-agent-dataset.js`: private dataset registration endpoint
- `api/voice-agent-token.js`: creates a grounded Realtime client secret
- `voice-agent.html`: browser voice client

## Required environment variables

- `OPENAI_API_KEY`
- `BLOB_READ_WRITE_TOKEN`
- `VOICE_AGENT_ADMIN_KEY`

Optional:

- `VOICE_AGENT_MODEL` (defaults to `gpt-realtime`)
- `VOICE_AGENT_VOICE` (defaults to `marin`)

## 1. Register a dataset

Use a private admin key to upload a concise knowledge pack. Keep it short enough to fit comfortably into a prompt.

```bash
curl -X POST "https://your-domain.example/api/voice-agent-dataset" \
  -H "Content-Type: application/json" \
  -H "x-voice-agent-admin-key: YOUR_ADMIN_KEY" \
  -d '{
    "datasetId": "sales-q2-brief",
    "title": "Sales Q2 Brief",
    "summary": "Quarterly sales dataset covering revenue, win rate, and pipeline movement by segment.",
    "facts": [
      "Enterprise revenue increased 14 percent quarter over quarter.",
      "SMB win rate fell from 29 percent to 24 percent.",
      "West region contributed the largest absolute growth."
    ],
    "qa": [
      {
        "question": "What changed most in the quarter?",
        "answer": "Enterprise growth and SMB conversion weakness were the two most notable changes."
      }
    ],
    "notes": [
      "If asked for causes not present in the dataset, say the dataset does not establish causality."
    ],
    "agentInstructions": "Be crisp, explain metrics in plain English, and stay inside the dataset."
  }'
```

## 2. Test on the phone

Open:

```text
https://your-domain.example/voice-agent.html?dataset=sales-q2-brief
```

If the dataset exists and the env vars are configured, the page should start a Realtime WebRTC voice session.

## 3. Create the Apple shortcut

On iPhone:

1. Open the Shortcuts app.
2. Create a new shortcut.
3. Add an `Open URLs` action.
4. Use your page URL, for example:

```text
https://your-domain.example/voice-agent.html?dataset=sales-q2-brief
```

5. Name it something easy to say, such as `Talk to Sales Brief`.
6. In shortcut details, enable `Show on Apple Watch`.

From there you can launch it from:

- the Shortcuts app on Apple Watch
- Siri on Apple Watch
- a Shortcuts complication / widget

Apple’s current docs also show shortcut access on Apple Watch Ultra models via the Action button entry points, but the implemented flow here still opens the conversation on the phone browser rather than making the watch itself the realtime client.

## 4. When you need true watch-native voice

Use one of these instead:

- `watchOS app + App Intents`: best if you want the watch itself to own mic, speaker, and session UX
- `Shortcut -> call number -> SIP bridge -> OpenAI Realtime`: best if you want a call-style experience from the watch without building a watch app
