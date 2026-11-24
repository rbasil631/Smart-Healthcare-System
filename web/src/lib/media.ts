/**
 * Background photographs. They are loaded from the Unsplash CDN (Unsplash
 * licence: free to use, hotlinking is how Unsplash asks to be used). Every
 * place that shows one also paints a gradient underneath, so the interface
 * still looks finished offline or if a photo fails to load.
 *
 * To use your own photos instead, drop them in web/public/img/ and point the
 * URLs below at "/static/img/<file>".
 */
const unsplash = (id: string, w = 1920) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=75`

export const SLIDES = [
  {
    src: unsplash("1631217868264-e5b90bb7e133"),
    caption: "Care that follows every visit",
  },
  {
    src: unsplash("1584515933487-779824d29309"),
    caption: "Built on routine clinical values",
  },
  {
    src: unsplash("1530026405186-ed1f139313f8"),
    caption: "Focused on the heart",
  },
  {
    src: unsplash("1631815588090-d4bfec5b1ccb"),
    caption: "Explained, not a black box",
  },
] as const

/** Faint photo behind the page headers inside the app. */
export const BANNER = unsplash("1519494026892-80bbd2d6fd0d", 1600)

export const AMU_LOGO = "/static/img/amu-logo.png"
