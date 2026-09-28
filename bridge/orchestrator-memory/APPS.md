# Static apps and Live Mini task cards

Ordinary static App Sheet payloads use `{kind:"app",spaceId,url}`. Supported other-host live URLs may include `live:true`; app_update adds targetMessageId and requires original context and the full retained provider session. No missing session/ambiguous outcome authorizes a new send.

Task-progress cards are a separate lifecycle. Only the [canonical VM helper](../../live-mini/runtime/README.md) may register original task/card context, claim host presentation and enqueue the single initial live card. Raw app/app_update submissions of registered or configured-host task-card URLs are rejected. Front Door owns final response; the one existing runtime owns Spectrum.

A later permitted task input retains the existing private context/card and exact signed URL. Obtain current task-revision authority through the result continuation/resume-task flow for new writes; read-only recovery may inspect and settle the existing presentation after expiry. Do not retain an expired parent claim for new mutations.

Ordinary progress replaces host JSON at the exact same URL. No new bubble, Spectrum edit, refresh query, redeploy or new worker is needed. Terminal content is truthful; an unknown initial presentation retains its slot until exact outcome reconciliation. Host page visibility is not provider/device evidence.

Live Mini is optional and follows the initial requested scope; a full-feature setup request already authorizes included Live Mini setup. Vercel access alone is insufficient; reuse existing resources/keys. Missing live capability falls back to useful text/static content without pretending a task card was delivered. Spectrum Apps guidance is human-facing only; no machine test can infer installation from user silence. Optional personal loader changes require an explicit owner request.

See [Live Mini](../../live-mini/README.md), [apps nudge](../../skills/spectrum-imessage-apps-nudge/SKILL.md), and the [operating contract](../../docs/product-repair/OPERATING_CONTRACT.md).
