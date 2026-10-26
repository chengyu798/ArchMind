# Local token counter data

Only tokenizer data is included; no model weights or remote Python are executed.

- Source: https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash
- Revision: `60d8d70770c6776ff598c94bb586a859a38244f1`
- tokenizer.json SHA-256: `8f9f37ca37fdc4f5fd36d5cf4d3b0e8392edb4e894fd10cc0d70b4957c8633cf`
- License: MIT; see LICENSE.

Input budgeting tokenizes a local serialization of messages and tool schemas.
It is an estimate because provider chat templates and the model behind an API
alias may differ. A safety reserve is enforced, and provider-reported usage
remains authoritative for accounting. This data is never downloaded at runtime.
