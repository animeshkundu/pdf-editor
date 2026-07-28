// @vitest-environment jsdom

import commentData from '../lib/text/comment-data';
import type { EngineTypes } from '../lib/engine/port';

const comments: readonly EngineTypes['AnnotationInfo'][] = [
  {
    id: 10,
    name: 'parent',
    pageIndex: 0,
    type: 'Text',
    rect: [10, 10, 30, 30],
    contents: 'Parent comment',
    author: 'Reviewer',
    subject: 'Review',
    color: [1, 1, 0],
    opacity: 1,
    borderWidth: 0,
    borderStyle: 'Solid',
    lineEndingStyles: ['None', 'None'],
    icon: 'Comment',
    state: 'Accepted',
    replyToId: null,
    flags: 4,
  },
  {
    id: 11,
    name: 'reply',
    pageIndex: 0,
    type: 'Text',
    rect: [40, 10, 60, 30],
    contents: 'Reply comment',
    author: 'Reviewer',
    subject: 'Reply',
    color: [1, 1, 0],
    opacity: 1,
    borderWidth: 0,
    borderStyle: 'Solid',
    lineEndingStyles: ['None', 'None'],
    icon: 'Comment',
    state: 'Completed',
    replyToId: 10,
    flags: 4,
  },
  {
    id: 12,
    name: 'shape',
    pageIndex: 0,
    type: 'Square',
    rect: [70, 10, 90, 30],
    contents: '',
    author: '',
    subject: '',
    color: [1, 0, 0],
    opacity: 1,
    borderWidth: 2,
    borderStyle: 'Solid',
    lineEndingStyles: ['None', 'None'],
    icon: '',
    state: 'None',
    replyToId: null,
    flags: 4,
  },
];

describe('CMNT-009/CMNT-010 comment interchange', () => {
  for (const format of ['xfdf', 'fdf'] as const) {
    it(`previews omissions and round-trips safe ${format.toUpperCase()} comment data`, () => {
      const exported = commentData.exportComments(format, comments);
      expect(exported).toMatchObject({ preserved: 2, omitted: 1 });
      const imported = commentData.importComments(format, exported.value, 1);
      expect(imported.omitted).toBe(0);
      expect(imported.inputs).toMatchObject([
        {
          type: 'Text',
          contents: 'Parent comment',
          state: 'Accepted',
          clientId: 'comment-10',
        },
        {
          type: 'Text',
          contents: 'Reply comment',
          state: 'Completed',
          clientId: 'comment-11',
          replyToClientId: 'comment-10',
        },
      ]);
    });
  }

  it('rejects action-bearing imports before producing mutation input', () => {
    expect(() =>
      commentData.importComments(
        'xfdf',
        '<xfdf><annots><text page="0" rect="0,0,1,1"><script>bad</script></text></annots></xfdf>',
        1,
      ),
    ).toThrow('action, script, or external reference');
  });
});
