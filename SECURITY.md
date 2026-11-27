# Security Policy

## Threat Model

Detect the PII is a **100% client-side application**. All processing happens inside the user's browser. There is no server, no database, and no network transmission of user data.

### What we protect against

| Threat | Mitigation |
|---|---|
| **Data exfiltration** | Strict CSP (`default-src 'self'; connect-src 'self'`) blocks all outbound network calls |
| **XSS via pasted content** | All user text rendered via React JSX text nodes — never `innerHTML` or `dangerouslySetInnerHTML` |
| **XSS via uploaded filenames** | File names displayed as text nodes, not HTML |
| **ReDoS (regex denial of service)** | All detection regexes are non-backtracking and linear-time; custom user RegExp patterns are tested before saving |
| **Path traversal / SSRF** | No server-side code exists; all file parsing uses browser `File.text()` / `File.arrayBuffer()` APIs |
| **Prototype pollution** | No `eval`, no `Function()`, no dynamic property assignment from user input |
| **Clickjacking** | `X-Frame-Options: DENY` header enforced in `nginx.conf` and `vercel.json` |
| **MIME sniffing** | `X-Content-Type-Options: nosniff` enforced in all deployment configs |
| **Referrer leakage** | `Referrer-Policy: no-referrer` header set |
| **Permission abuse** | `Permissions-Policy: camera=(), microphone=(), geolocation=()` header set |
| **Dependency supply chain** | Zero runtime CDN dependencies; all third-party assets (`pdfjs-dist`, `tesseract.js`, fonts) are self-hosted in `public/` |
| **Non-root container** | Docker image runs as unprivileged `nginx` user on port 8080 |

## Content Security Policy

```
default-src 'self';
connect-src 'self';
worker-src 'self' blob:;
script-src 'self' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline';
font-src 'self';
img-src 'self' data:;
```

`'wasm-unsafe-eval'` is required for Tesseract.js and PDF.js WASM modules running as self-hosted workers.

## Responsible Disclosure

If you discover a security vulnerability, please open a GitHub Issue with the label `security`. Do not include sensitive information in public issues.

## Dependency Auditing

```bash
npm audit          # Check for known vulnerabilities
npm audit fix      # Apply non-breaking fixes
```

All production dependencies are pinned in `package-lock.json`.
