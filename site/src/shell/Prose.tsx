/**
 * A sentence from the registry, with the library's names in it set as code.
 *
 * The registry writes those names in backticks, as Markdown would, so the
 * sentence reads the same in the source as on the page; this is all of
 * Markdown the site needs, and not a parser for the rest of it.
 */
export function Prose({ text }: { text: string }) {
  // Splitting on the backticks leaves the code at every odd place
  return <>{text.split('`').map((piece, at) => (at % 2 === 1 ? <code key={at}>{piece}</code> : piece))}</>
}
