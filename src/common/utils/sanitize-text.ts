// Strips line-break-equivalent characters that would let a member's free-form
// text (injury notes, goal titles) break out of its single line inside the LLM
// prompt and inject new instructions. Keeps regular interior spaces intact.
// Covers: CR/LF/TAB/VT/FF, NEL (U+0085), Unicode line separator (U+2028), and
// Unicode paragraph separator (U+2029) — all are interpreted as line breaks by
// at least one major rendering/tokenization path.
const LINE_BREAK_EQUIVALENTS = /[\r\n\t\v\f\u0085\u2028\u2029]/g;
// C0 controls (excluding tab/LF/VT/FF/CR which LINE_BREAK_EQUIVALENTS handles)
// plus DEL, plus C1 controls (U+0080-U+009F, excluding U+0085/NEL already
// covered above). These would otherwise flow into admin dashboards verbatim.
// eslint-disable-next-line no-control-regex -- stripping control chars is the purpose of this util
const CONTROL_CHARS = /[\x00-\x08\x0E-\x1F\x7F\x80-\x84\x86-\x9F]/g;
// Invisible / formatting characters that enable homoglyph attacks, RTL/LTR
// override smuggling (e.g. U+202E flipping admin-rendered text), zero-width
// glyph stuffing, and BOM injection. We strip rather than space-replace because
// these chars carry no legitimate typographic meaning in goal titles or notes.
// Covers: Arabic letter mark (U+061C), Mongolian vowel separator (U+180E),
// zero-width space/non-joiner/joiner/LRM/RLM (U+200B-U+200F), LRE/RLE/PDF/LRO/
// RLO (U+202A-U+202E), word joiner through invisible separator (U+2060-U+2064),
// LRI/RLI/FSI/PDI (U+2066-U+2069), and BOM/ZWNBSP (U+FEFF).
const INVISIBLE_CHARS =
  /[\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;
// Strips HTML/XML-ish tags so member-supplied titles/notes cannot smuggle
// <script>, <img onerror=>, or other markup into admin dashboards (self-to-staff
// XSS). Also strips the surrounding tag's content for pair tags like <script>
// and <style> — otherwise "<script>alert(1)</script>" would render its payload
// as plain text. Non-pair/unknown tags are simply removed without touching
// surrounding content.
const SCRIPT_STYLE_BLOCKS = /<(script|style)[\s\S]*?<\/\1>/gi;
const ANY_HTML_TAG = /<\/?[a-zA-Z][^>]*?>/g;

export const sanitizeText = (s: string): string =>
  s
    .replace(SCRIPT_STYLE_BLOCKS, '')
    .replace(ANY_HTML_TAG, '')
    .replace(LINE_BREAK_EQUIVALENTS, ' ')
    .replace(CONTROL_CHARS, '')
    .replace(INVISIBLE_CHARS, '')
    .trim();
