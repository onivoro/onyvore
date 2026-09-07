import { SearchService } from './search.service';
import { SearchIndexService } from './search-index.service';
import { LinkGraphService } from './link-graph.service';
import { MetadataService } from './metadata.service';
import type { Edge } from '@onivoro/isomorphic-onyvore';

const NB = '/notebooks/test';

function build() {
  const linkGraph = new LinkGraphService();
  const searchIndex = new SearchIndexService(linkGraph);
  const metadata = new MetadataService();
  const svc = new SearchService(searchIndex, linkGraph, metadata);
  return { svc, searchIndex, linkGraph, metadata };
}

async function addNote(
  ctx: ReturnType<typeof build>,
  relativePath: string,
  title: string,
  content: string,
): Promise<void> {
  await ctx.searchIndex.addDocument(NB, relativePath, title, content);
  ctx.metadata.setFile(NB, relativePath, 1);
  ctx.linkGraph.registerFile(NB, relativePath);
}

/** The notebook the search plan's findings were reproduced against. */
async function notebook() {
  const ctx = build();
  await addNote(ctx, 'hotsauce.md', 'hotsauce', 'A fermented pepper condiment with vinegar and salt.');
  await addNote(ctx, 'recipes.md', 'recipes', 'My hotsauce recipe. Also running notes on brunch.');
  await addNote(ctx, 'work/overview.md', 'work overview', 'Quarterly planning and roadmap.');
  await addNote(ctx, 'personal/overview.md', 'personal overview', 'Life admin and errands.');
  await addNote(ctx, 'work/retro.md', 'work retro', 'What went well. Cold proof of the concept.');
  return ctx;
}

const paths = (r: { hits: Array<{ relativePath: string }> }) =>
  r.hits.map((h) => h.relativePath);

describe('SearchService', () => {
  describe('S1 — title and path matches are kept', () => {
    it('should return a note matched by its own filename', async () => {
      const { svc } = await notebook();
      // The regression: hotsauce.md never says "hotsauce" in its body.
      expect(paths(await svc.search(NB, 'hotsauce'))).toContain('hotsauce.md');
    });

    it('should rank the filename match above a passing mention', async () => {
      const { svc } = await notebook();
      expect(paths(await svc.search(NB, 'hotsauce'))[0]).toBe('hotsauce.md');
    });

    it('should report where the match happened', async () => {
      const { svc } = await notebook();
      const hit = (await svc.search(NB, 'hotsauce')).hits.find(
        (h) => h.relativePath === 'hotsauce.md',
      );
      expect(hit?.matchedIn).toContain('title');
      expect(hit?.matchedIn).not.toContain('content');
    });

    it('should show the opening line when there is no content snippet', async () => {
      const { svc } = await notebook();
      const hit = (await svc.search(NB, 'hotsauce')).hits.find(
        (h) => h.relativePath === 'hotsauce.md',
      );
      expect(hit?.snippets).toEqual([]);
      expect(hit?.preview).toContain('fermented pepper');
    });

    it('should find a note by its folder', async () => {
      const { svc } = await notebook();
      expect(paths(await svc.search(NB, 'personal'))).toContain('personal/overview.md');
    });
  });

  describe('S2 — typo tolerance reaches the user', () => {
    it('should find a note through a single-character typo', async () => {
      const { svc } = await notebook();
      expect(paths(await svc.search(NB, 'hotsauze'))).toContain('hotsauce.md');
    });

    it('should mark a tolerance-only hit as approximate', async () => {
      const { svc } = await notebook();
      const hit = (await svc.search(NB, 'hotsauze')).hits.find(
        (h) => h.relativePath === 'hotsauce.md',
      );
      expect(hit?.approximate).toBe(true);
    });
  });

  describe('S3 — highlights follow the engine', () => {
    it('should not snippet a term found mid-word', async () => {
      const { svc } = await notebook();
      // "run" prefixes "running" but sits inside "brunch"; only the first counts.
      const hit = (await svc.search(NB, 'run')).hits.find(
        (h) => h.relativePath === 'recipes.md',
      );
      expect(hit).toBeDefined();
      expect(hit!.snippets.join(' ')).toContain('running');
    });

    it('should not match a term that only appears mid-word', async () => {
      const { svc } = await notebook();
      // "unch" appears inside "brunch" and nowhere at a word start.
      expect(paths(await svc.search(NB, 'unch'))).not.toContain('recipes.md');
    });

    it('should match by prefix', async () => {
      const { svc } = await notebook();
      expect(paths(await svc.search(NB, 'ferment'))).toContain('hotsauce.md');
    });
  });

  describe('S4 — more words narrow the search', () => {
    it('should require every term', async () => {
      const { svc } = await notebook();
      const results = await svc.search(NB, 'pepper vinegar');
      expect(paths(results)).toEqual(['hotsauce.md']);
      expect(results.widened).toBe(false);
    });

    it('should prefer the all-terms match over single-term ones', async () => {
      const ctx = await notebook();
      await addNote(ctx, 'both.md', 'both', 'pepper and roadmap together');

      const results = await ctx.svc.search(NB, 'pepper roadmap');
      expect(paths(results)).toEqual(['both.md']);
      expect(results.widened).toBe(false);
    });

    it('should widen and say so when nothing matches every term', async () => {
      const { svc } = await notebook();
      // No note has both, so the search widens rather than returning nothing.
      const results = await svc.search(NB, 'pepper roadmap');
      expect(results.widened).toBe(true);
      expect(paths(results).sort()).toEqual(['hotsauce.md', 'work/overview.md']);
    });
  });

  describe('S5 — file extensions are not searchable words', () => {
    it('should not match every note for "md"', async () => {
      const { svc } = await notebook();
      expect(paths(await svc.search(NB, 'md'))).toEqual([]);
    });

    it('should still match directory names', async () => {
      const { svc } = await notebook();
      expect(paths(await svc.search(NB, 'work')).sort()).toEqual([
        'work/overview.md',
        'work/retro.md',
      ]);
    });
  });

  describe('phrases', () => {
    it('should require the words to be adjacent', async () => {
      const { svc } = await notebook();
      expect(paths(await svc.search(NB, '"cold proof"'))).toEqual(['work/retro.md']);
    });

    it('should reject the words apart', async () => {
      const { svc } = await notebook();
      expect(paths(await svc.search(NB, '"proof cold"'))).toEqual([]);
    });
  });

  describe('exclusion', () => {
    it('should drop notes containing the excluded term', async () => {
      const { svc } = await notebook();
      const withBoth = paths(await svc.search(NB, 'overview'));
      expect(withBoth.sort()).toEqual(['personal/overview.md', 'work/overview.md']);

      expect(paths(await svc.search(NB, 'overview -errands'))).toEqual([
        'work/overview.md',
      ]);
    });
  });

  describe('field scoping', () => {
    it('should match title: against the title only', async () => {
      const { svc } = await notebook();
      // "hotsauce" is in recipes.md's body but not its title.
      expect(paths(await svc.search(NB, 'title:hotsauce'))).toEqual(['hotsauce.md']);
    });

    it('should match path: against the path only', async () => {
      const { svc } = await notebook();
      expect(paths(await svc.search(NB, 'path:personal'))).toEqual([
        'personal/overview.md',
      ]);
    });

    it('should scope in: to a folder', async () => {
      const { svc } = await notebook();
      expect(paths(await svc.search(NB, 'in:work/ overview'))).toEqual([
        'work/overview.md',
      ]);
    });

    it('should not let in: match a folder by prefix', async () => {
      const ctx = build();
      await addNote(ctx, 'work/a.md', 'a', 'alpha');
      await addNote(ctx, 'workshop/b.md', 'b', 'alpha');

      expect(paths(await ctx.svc.search(NB, 'in:work alpha'))).toEqual(['work/a.md']);
    });
  });

  describe('graph operators', () => {
    function link(source: string, target: string): Edge {
      return { source, target, type: 'explicit', noun: target, count: 100 };
    }

    it('should find notes linking to a note', async () => {
      const ctx = await notebook();
      ctx.linkGraph.replaceOutboundEdgesForFile(NB, 'recipes.md', 'explicit', [
        link('recipes.md', 'hotsauce.md'),
      ]);

      expect(paths(await ctx.svc.search(NB, 'links:hotsauce'))).toEqual(['recipes.md']);
    });

    it('should resolve the note reference like a wikilink', async () => {
      const ctx = await notebook();
      ctx.linkGraph.replaceOutboundEdgesForFile(NB, 'recipes.md', 'explicit', [
        link('recipes.md', 'work/overview.md'),
      ]);

      // Path-qualified and bare basename both resolve, as [[...]] would.
      expect(paths(await ctx.svc.search(NB, 'links:work/overview'))).toEqual([
        'recipes.md',
      ]);
    });

    it('should return nothing when the referenced note does not exist', async () => {
      const ctx = await notebook();
      expect(paths(await ctx.svc.search(NB, 'links:nonexistent'))).toEqual([]);
    });

    it('should find related notes', async () => {
      const ctx = await notebook();
      ctx.linkGraph.replaceSymmetricEdgesForFile(NB, 'hotsauce.md', 'similar', [
        { source: 'hotsauce.md', target: 'recipes.md', type: 'similar', noun: 'x', count: 40 },
        { source: 'recipes.md', target: 'hotsauce.md', type: 'similar', noun: 'x', count: 40 },
      ]);

      expect(paths(await ctx.svc.search(NB, 'related:hotsauce'))).toEqual(['recipes.md']);
    });

    it('should find orphans, ignoring similarity edges', async () => {
      const ctx = await notebook();
      ctx.linkGraph.replaceOutboundEdgesForFile(NB, 'recipes.md', 'explicit', [
        link('recipes.md', 'hotsauce.md'),
      ]);

      const orphans = paths(await ctx.svc.search(NB, 'is:orphan'));
      expect(orphans).not.toContain('recipes.md');
      expect(orphans).not.toContain('hotsauce.md');
      expect(orphans).toContain('work/overview.md');
    });

    it('should combine a filter-only query with a folder scope', async () => {
      const ctx = await notebook();
      expect(paths(await ctx.svc.search(NB, 'is:orphan in:work/')).sort()).toEqual([
        'work/overview.md',
        'work/retro.md',
      ]);
    });
  });

  describe('graph-boosted ranking', () => {
    it('should rank a well-connected note above an isolated one', async () => {
      const ctx = build();
      await addNote(ctx, 'popular.md', 'popular', 'shared topic text');
      await addNote(ctx, 'lonely.md', 'lonely', 'shared topic text');
      ctx.linkGraph.replaceInboundEdgesForFile(NB, 'popular.md', 'explicit', [
        { source: 'a.md', target: 'popular.md', type: 'explicit', noun: 'p', count: 100 },
        { source: 'b.md', target: 'popular.md', type: 'explicit', noun: 'p', count: 100 },
      ]);

      expect(paths(await ctx.svc.search(NB, 'shared'))[0]).toBe('popular.md');
    });
  });

  describe('empty and malformed queries', () => {
    it('should return nothing for an empty query', async () => {
      const { svc } = await notebook();
      expect(paths(await svc.search(NB, '   '))).toEqual([]);
    });

    it('should treat an unknown operator as literal text', async () => {
      const ctx = build();
      await addNote(ctx, 'note.md', 'note', 'the ratio is foo:bar exactly');

      expect(paths(await ctx.svc.search(NB, 'foo:bar'))).toEqual(['note.md']);
    });

    it('should tolerate an unterminated quote', async () => {
      const { svc } = await notebook();
      expect(paths(await svc.search(NB, '"cold proof'))).toEqual(['work/retro.md']);
    });

    it('should return nothing for a notebook that was never indexed', async () => {
      const { svc } = build();
      expect(paths(await svc.search('/unknown', 'anything'))).toEqual([]);
    });
  });
});
