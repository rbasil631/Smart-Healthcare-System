# Images

| File | Used for |
|---|---|
| `amu-logo.png` | The Aligarh Muslim University seal on the sign-in page, the app header and the footer. If it is missing, an "AMU" badge is shown instead. |

## Background photographs

The sign-in slideshow and the page-header banners use free photographs from
Unsplash (Unsplash licence), loaded from the Unsplash CDN. The URLs live in
`web/src/lib/media.ts`. A gradient is always painted underneath, so the pages
still look finished offline.

To use your own photos instead (for example, to run fully offline), put them
in this folder and change the URLs in `media.ts` to `/static/img/<file>`, then
run `npm run build`.
