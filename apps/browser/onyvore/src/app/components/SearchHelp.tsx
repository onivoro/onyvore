interface Operator {
  syntax: string;
  meaning: string;
}

/**
 * The operator reference, shown inline in the sidebar.
 *
 * A syntax nobody discovers is a syntax nobody uses, and a sidebar has no room
 * for prose — so this is the documentation, kept one click from the input.
 */
const OPERATORS: Operator[] = [
  { syntax: 'two words', meaning: 'both must match' },
  { syntax: '"exact phrase"', meaning: 'words, in order' },
  { syntax: '-word', meaning: 'exclude' },
  { syntax: 'title:', meaning: 'match the title' },
  { syntax: 'path:', meaning: 'match the path' },
  { syntax: 'in:folder/', meaning: 'inside a folder' },
  { syntax: 'links:note', meaning: 'notes linking there' },
  { syntax: 'related:note', meaning: 'notes similar to it' },
  { syntax: 'is:orphan', meaning: 'nothing links to it' },
];

export function SearchHelp() {
  return (
    <dl className="ony-searchhelp">
      {OPERATORS.map(({ syntax, meaning }) => (
        <div key={syntax} className="ony-searchhelp__row">
          <dt className="ony-searchhelp__syntax">{syntax}</dt>
          <dd className="ony-searchhelp__meaning">{meaning}</dd>
        </div>
      ))}
    </dl>
  );
}
