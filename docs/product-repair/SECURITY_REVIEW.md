# Independent tracked-source and asset inspection

Inspected commit: `1e565a42396564959bb7461be7d82b40a10a7ef9`. Scope was the current tracked tree: **353 files, 348 UTF-8 text files and five PNG assets, 10,261,239 bytes**. No private instance, credentials store, service account, provider endpoint or Git history was inspected. No credential was tested, rotated, or reproduced; no history was rewritten.

No actual credential, private key, or real access-capability URL was identified. This is a bounded heuristic scan with manual source review and visual asset inspection, not a guarantee that the tree contains no secret. The sanitized machine-readable [scan evidence](evidence/review-security-scan.json) retains category, location, classification, asset hashes, and metadata structure without matched text.

## Text findings

The scanner enumerated `git ls-files -z`, decoded text, and searched for private-key headers, common provider-token formats, full capability URLs, phone/email literals, UUID literals, credential assignments, and historical personal-roster vocabulary. Matches were inspected in their source context; merely matching a token pattern did not establish a credential.

| Category | Candidate locations | Disposition |
| --- | ---: | --- |
| Private-key headers | 0 | None identified. |
| Provider-token format | 1 | Deliberately synthetic credential in build isolation test. |
| Capability URL | 17 | Synthetic tests and examples; no operational capability identified. |
| Credential assignment | 15 | Test inputs, explicit placeholders, source types/comparisons and guidance. |
| Phone number | 33 | Synthetic fixtures/examples and historical evidence. |
| Email address | 13 | Synthetic fixtures and one public vendor contact. |
| UUID literal | 1 | Two supplied reference-asset filenames in historical `docs/SOURCES.md`; not bot identities or credentials. |
| Personal-roster term | 2 | Forbidden-vocabulary checker and one inactive source comment. |

Manual classifications needing explanation:

- `bridge/scripts/check-instructions.ts:14` contains a regression pattern rejecting former roster names, not an active roster.
- `bridge/src/setup-verification.ts:24,34` contains a type declaration and type comparison, not a stored credential literal.
- `live-mini/live-task-cards/.env.example:5` is an explicit replacement placeholder.
- `live-mini/live-task-cards/docs/SOURCES.md:11` records supplied reference filenames. The reference is historical, not proof of asset rights.
- `photon-skills/spectrum/providers/imessage.md:60` contains a public vendor contact; the address is omitted here.
- **Advisory:** `bridge/src/types.ts:113` retains an obsolete role nickname in a source comment. It has no runtime effect and is not an operating instruction. Active instructions/registry pass the independent consistency checks. No implementation file was edited by this review.

Ignore rules were independently exercised without relying on global Git excludes, including tracked-file detection and preservation of distributable examples. Ignore rules do not remove a tracked file or erase historical versions.

## Binary and metadata inspection

All five shipped PNG files were opened and visually inspected. Chunk CRCs validate, each file ends at IEND with zero trailing bytes, and only IHDR, sRGB, eXIf, IDAT, and IEND chunks occur. Each EXIF payload is 68 bytes containing only the ExifIFD pointer, ColorSpace, PixelXDimension, and PixelYDimension. No GPS, owner, camera, comment, date, or other personal metadata was found in the decoded tags.

| Asset, relative to `live-mini/live-task-cards/` | Size / dimensions | Visual observation |
| --- | --- | --- |
| `public/assets/hands.png` | 237,469 bytes; 750 × 469 | Abstract blurred reaching hands; no private text visible. |
| `public/assets/study.png` | 2,240,148 bytes; 1536 × 768 | Blurred library scene; no private conversation text visible. |
| `references/01-dot-grid.png` | 1,848,169 bytes; 1254 × 1254 | Generic research-progress reference card. |
| `references/02-segments.png` | 1,890,726 bytes; 1254 × 1254 | Generic repository-repair reference card. |
| `references/03-stages.png` | 1,962,673 bytes; 1254 × 1254 | Generic task-order progress reference card. |

Exact SHA-256 hashes and parsed tags are in the scan evidence. No binary was changed. Visual/metadata inspection does not establish ownership or licensing; asset rights and Marketplace distribution requirements remain explicitly unverified under deferred REL-01.

## Boundary

This scan covers the tested source commit, before the review report/evidence files were added. New reports contain only synthetic test evidence, source paths, status codes and public runtime facts. Deployment credentials, native bot identities, hosted state, customer content, and physical-device output remain outside this review. The separate snapshot-export correctness defect and its independently verified fix are recorded in [RESULTS.md](RESULTS.md); they do not change the credential scan outcome.

Supplemental inspection at `c550d051453db80c3f338dbee19e5f9674b46782` covered 21 changed/new text files, including the snapshot fix, maintenance acceptance additions and report evidence; no binary changed and no additional operational secret was identified. See [delta scan](evidence/review-security-delta.json). The source commit and later reporting delta remain distinguished.
