// Kept as its own module graph, separate from app.js, so the version footer
// still renders even if app.js's Supabase/CDN imports fail to load - the
// whole point of the footer is to confirm a deploy went out, including when
// something else is broken.
import { renderVersion } from "./version.js";

renderVersion(document.querySelectorAll(".version-tag"));
