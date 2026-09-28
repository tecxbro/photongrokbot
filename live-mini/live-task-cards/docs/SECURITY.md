# Security and operating limits

This is a single-account/setup publishing host. Its publisher token grants trusted host write authority; shared-VM workers are not separate Unix security principals. Route integration through the canonical task/destination/presentation checks in the [operating contract](../../../docs/product-repair/OPERATING_CONTRACT.md).

A full view URL is a narrowly scoped read capability, not proof of user identity. Holders can read its minimal card state, and URLs may appear in browser/host logs. Never put secrets, private transcript bodies or sensitive research into broadly shareable progress content. Keep publisher/view/Blob or Redis credentials private and distinct; rotating view secrets invalidates old URLs and is not routine recovery.

Pages/view JSON use no-store, no-referrer, noindex and restrictive resource policies. Text is escaped; display schemas accept no arbitrary HTML/CSS/script/actions. Opening a card does not run, buy, approve or cancel anything. Browser refresh is not a reasoning-model wake.

Production uses durable Blob or Redis with conditional/atomic updates. ETags remain opaque and missing/corrupt state fails closed. Preview has a separate namespace. Local file storage is development-only; preserve verified lock ownership and never remove registry state to clear a conflict. Backups require the same private handling as original state.

Default history is bounded to 30 days/100 archived records. Active/waiting/unknown assignments stay retained. Initial presentation uncertainty preserves occupancy and exact operation identity; no exactly-once external-delivery promise or automatic unsend is claimed. Local acceptance, provider acceptance and physical display remain distinct.

Personal loader changes require explicit owner-bound authorization, never an image alone or a model-provided permission boolean. Original photos/owner refs remain private; only validated numeric display assets reach authorized read links. Existing host schema/request/registry limits still apply; documented caps are not a free-hosting guarantee.
