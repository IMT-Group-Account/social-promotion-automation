# Kakao Channel inbound and consultation flow

```text
Campaign/Post or direct campaign link
  -> tracked backend entry URL
  -> Kakao Channel 1:1 chat URL
  -> customer consultation
  -> trusted chatbot/counselor integration bridge
  -> kakao_channel_consultations
```

Kakao Channel is not a `social_publish_jobs` platform. Facebook, Instagram, Threads, LinkedIn, and X can be selected as independent publishing targets, while Kakao Channel is a customer-inbound destination and consultation conversion funnel.

## Routes

- Authenticated owner: `POST /api/kakao-channel/channels` registers a managed Channel public ID and its `https://pf.kakao.com/.../chat` consultation URL.
- Authenticated owner: `POST /api/kakao-channel/entries` creates a one-time tracking URL for a campaign/source.
- Public visitor: `GET /api/kakao-channel/entry/:trackingCode` records the first opening and redirects to the registered Channel chat URL.
- Integration bridge only: `POST /api/kakao-channel/consultations/events` records an opaque consultation reference and lifecycle status using `X-Kakao-Channel-Integration-Key`.
- Authenticated owner: `GET /api/kakao-channel/channels/:channelId/funnel` returns issued entry, open, started-consultation, and resolved-consultation counts.

The integration endpoint is an internal contract for a chatbot, 상담톡, or counselor bridge after that system has completed provider-specific verification. It is not represented as a generic Kakao webhook and does not authorize automatic open-chat posting.

## Privacy and operation

Only an opaque external conversation reference is persisted. Do not store customer message bodies, Kakao user IDs, phone numbers, or access tokens in these funnel tables. `KAKAO_CHANNEL_INTEGRATION_KEY` is server-only. Set it in the integration service and backend secret stores, never in browser code.

Before a live launch, connect a qualifying business Channel to the Kakao app, complete any required business/channel review and consent settings, configure the chatbot or 상담톡 bridge, apply migration `007`, and test a real redirect plus consultation event. No live Kakao API request or message is performed by this implementation.
