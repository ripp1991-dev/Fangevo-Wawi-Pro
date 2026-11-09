import { describe, expect, it } from 'vitest';
import { toPrefixQuery } from './search.service';

describe('toPrefixQuery', () => {
  it('baut eine sichere Präfixsuche ohne Sonderzeichen', () => {
    expect(toPrefixQuery('Muster GmbH')).toBe('muster:* & gmbh:*');
    expect(toPrefixQuery("a' | b:* & !c")).toBe('a:* & b:* & c:*');
    expect(toPrefixQuery('  ')).toBeNull();
    expect(toPrefixQuery('Müller-Lüdenscheidt')).toBe('müller:* & lüdenscheidt:*');
  });
});
