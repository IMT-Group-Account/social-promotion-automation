# Platform content formatting

```text
Original Campaign Content
  -> Content Formatter
     -> LinkedIn formatter
     -> Instagram formatter
     -> Facebook formatter
     -> Threads formatter
     -> X formatter
  -> platformContents
  -> publishing adapter
```

`posts.content` remains the immutable editorial source. `FormatterService.formatAll(post)` returns this contract before any publishing API is called:

```json
{
  "original": {
    "message": "Help children affected by flooding...",
    "url": "https://example.com/campaign/123"
  },
  "platformContents": {
    "linkedin": { "text": "..." },
    "instagram": { "caption": "...", "hashtags": [] },
    "facebook": { "message": "..." },
    "threads": { "text": "..." },
    "x": { "text": "..." }
  }
}
```

The initial formatters are deterministic and do not make AI or network calls. The `PlatformContentGenerationPort` is the future AI boundary: an approved provider can generate the same `PlatformContents` structure without altering publishing jobs or adapters. Any AI provider must remain server-side, redact secrets and sensitive data from prompts/logs, validate output lengths and URLs, and preserve a review/approval step before publication.

Adapters receive the selected formatted body plus the original media and URL. Facebook and LinkedIn retain the URL as their API-level link/article attachment; Instagram includes it in the caption; Threads and X append it in their adapters. This avoids duplicate URLs while retaining platform-specific presentation.
