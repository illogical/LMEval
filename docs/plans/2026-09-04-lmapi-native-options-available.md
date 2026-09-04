# Notice: LMApi sampling-parameter support update (2026-09-04)

**Status:** LMApi handoff complete — no further LMApi implementation is required for LMEval A1.
**Source:** `LMApi/docs/plans/2026-09-04-sampling-parameter-support.md`, written in response to
LMEval's own handoff doc of the same date. Recorded here because that doc points back at this
path expecting a notice to exist.

## What changed in LMApi

`seed` is now accepted by `ChatCompletionSchema` (`LMApi/src/routes/chatCompletionRoutes.ts:34`)
and forwarded through to Ollama's `/v1/chat/completions` compatibility endpoint, which already
supported it. This is the exact endpoint `PromptfooAdapter.buildLmapiProvider()` calls via
`/api/chat/completions/any` and `/api/chat/completions/server`.

**Action taken:** `ExecutionService.resolveInferenceAndProvenance()`'s `transportProvenance.seedHonored`
flipped from `false` to `true` (was shipped `false` in A1 earlier the same day, before this LMApi
change landed). No other LMEval code changes — `seed` was already threaded through
`buildLmapiProvider()`'s `chatReq` as inert-but-present plumbing per A1, so it now takes effect
automatically.

## Ollama compatibility constraints and workarounds

Ollama's OpenAI-compatible `/v1/chat/completions` endpoint supports the A1 fields LMEval sends:
`temperature`, `max_tokens`, and `seed`. It also supports `top_p`, and LMApi already accepts and
forwards that field, but `top_p` is outside A1's current inference contract. See Ollama's
[OpenAI compatibility reference](https://github.com/ollama/ollama/blob/main/docs/api/openai-compatibility.mdx).

Request-level `top_k` and `num_ctx` are not supported on Ollama's OpenAI-compatible path. They do
work through Ollama's native `options` object, which LMApi already exposes on `/api/generate` via
`params.options` (`QueueService.runRequest`), but LMEval does not call that endpoint and has no
current consumer for either setting. This is an Ollama compatibility boundary, not unfinished work
from the LMApi handoff.

The supported workaround for a fixed evaluation configuration is to create a purpose-built Ollama
model alias from a Modelfile that pins `PARAMETER num_ctx` and/or `PARAMETER top_k`, then select that
model name in LMEval. The alias and the effective Modelfile configuration must be recorded in
evaluation provenance: changing the Modelfile changes the configuration being measured even if the
base model is unchanged. Both parameters are documented in Ollama's
[Modelfile reference](https://github.com/ollama/ollama/blob/main/docs/modelfile.mdx).

If LMEval later needs per-run `top_k` or `num_ctx`, LMApi could translate the OpenAI-shaped request
to Ollama's native `/api/chat` request and populate `options`. That creates a second transport path
whose message, tool, response, and parameter behavior must be kept equivalent and recorded, so it
remains deferred until a real LMEval requirement justifies it. An unrestricted `options` escape
hatch on the OpenAI-compatible route is not assumed to work because Ollama's compatibility endpoint
does not consume those native options.

## Verification

Covered by `server/services/__tests__/ExecutionService.inference.test.ts`, which now asserts
`seedHonored: true`. A live smoke test (send a `seed` value through a real evaluation, confirm
reproducible output across repeated identical calls on the same model/configuration) is still owed
as runtime verification debt in Track E. It does not leave the LMApi implementation handoff open.
