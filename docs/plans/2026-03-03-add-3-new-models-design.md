# Design: Add 3 New Cloudflare Workers AI Models

**Date:** 2026-03-03

## Summary

Add 3 new text generation models from the Cloudflare Workers AI catalog to Ask Ozzy, all at the Professional tier. This brings the total from 10 to 13 models.

## New Models

| Model | ID | Params | Context | Pricing (in/out per M tokens) |
|-------|----|--------|---------|-------------------------------|
| GLM 4.7 Flash | `@cf/zai-org/glm-4.7-flash` | ~9B | 131,072 | $0.06 / $0.40 |
| DeepSeek R1 Distill | `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b` | 32B | 80,000 | $0.50 / $4.88 |
| Qwen 2.5 Coder | `@cf/qwen/qwen2.5-coder-32b-instruct` | 32B | 32,768 | $0.66 / $1.00 |

## Tier Placement

All 3 models go to **Professional** tier:
- Free: 3 models (unchanged)
- Professional: 6 -> 9 models
- Enterprise: 10 -> 13 models (all)

## Changes

### 1. `src/index.ts` — Tier arrays
- Add 3 model IDs to `PRO_TIER_MODELS`

### 2. `src/index.ts` — Model catalog API
- Add 3 entries to the models list with `requiredTier: "professional"`
- Descriptions:
  - GLM 4.7 Flash: "Fast multilingual model -- 131K context, tool calling, 100+ languages"
  - DeepSeek R1 Distill: "DeepSeek reasoning model -- outperforms o1-mini, strong at math and logic"
  - Qwen 2.5 Coder: "Code-specialised model -- optimised for programming, debugging, and code generation"

### 3. `src/index.ts` — Feature text
- Professional features: "6 AI models" -> "9 AI models"
- Enterprise features: "All 10 AI models" -> "All 13 AI models"

### 4. `docs/08-ai-features.md`
- Add 3 rows to the model table
- Update total count and free tier text
